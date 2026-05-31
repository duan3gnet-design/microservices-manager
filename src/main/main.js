const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('path')
const http = require('http')
const https = require('https')
const crypto = require('crypto')
const fs = require('fs')
const { URL } = require('url')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0e1a',
      symbolColor: '#4a9eff',
      height: 36,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
    backgroundColor: '#0a0e1a',
    show: false,
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => mainWindow.show())
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

// ── OIDC: open browser ───────────────────────────────────────────────────────
ipcMain.handle('oidc:open-browser', async (_, url) => {
  await shell.openExternal(url)
  return { ok: true }
})

// ── OIDC: callback server ────────────────────────────────────────────────────
let callbackServer = null

ipcMain.handle('oidc:start-callback-server', async (_, port = 8989) => {
  return new Promise((resolve) => {
    if (callbackServer) { callbackServer.close(); callbackServer = null }
    callbackServer = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`)
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<!DOCTYPE html><html><body style="font-family:monospace;background:#0a0e1a;color:#4a9eff;padding:2rem;">
        <h2>${error ? '❌ Lỗi xác thực' : '✅ Xác thực thành công'}</h2>
        <p>${error || 'Bạn có thể đóng tab này.'}</p>
        <script>window.close()</script></body></html>`)
      if (mainWindow) {
        mainWindow.webContents.send('oidc:callback', { code, error })
        mainWindow.focus()
      }
    })
    callbackServer.listen(port, () => resolve({ port, ok: true }))
    callbackServer.on('error', (err) => resolve({ ok: false, error: err.message }))
  })
})

ipcMain.handle('oidc:stop-callback-server', () => {
  if (callbackServer) { callbackServer.close(); callbackServer = null }
  return { ok: true }
})

// ── K8s API proxy ────────────────────────────────────────────────────────────
ipcMain.handle('k8s:fetch', async (_, { url, method = 'GET', headers = {}, body }) => {
  return new Promise((resolve) => {
    let settled = false
    const done = (result) => { if (settled) return; settled = true; resolve(result) }

    try {
      const parsed = new URL(url)
      const isHttps = parsed.protocol === 'https:'
      const lib = isHttps ? https : http

      let bodyBuffer = null
      if (body) {
        const raw = typeof body === 'string' ? body : JSON.stringify(body)
        bodyBuffer = Buffer.from(raw, 'utf8')
        headers = { ...headers, 'Content-Length': bodyBuffer.byteLength }
      }

      const options = {
        hostname: parsed.hostname,
        port: parsed.port ? parseInt(parsed.port, 10) : isHttps ? 443 : 80,
        path: parsed.pathname + parsed.search,
        method: method.toUpperCase(),
        headers,
        rejectUnauthorized: false,
        timeout: 30_000,
      }

      const req = lib.request(options, (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => done({ status: res.statusCode, data: Buffer.concat(chunks).toString('utf8'), headers: res.headers }))
        res.on('error', (e) => done({ status: 0, error: `Response error: ${e.message || e.code || 'unknown'}` }))
      })

      req.on('error', (e) => done({ status: 0, error: e.message || e.code || `Network error (${e.syscall || 'unknown'})` }))
      req.on('timeout', () => req.destroy(new Error('Request timed out after 30s')))
      if (bodyBuffer) req.write(bodyBuffer)
      req.end()
    } catch (e) {
      done({ status: 0, error: e.message || String(e) })
    }
  })
})

// ── Certificate generation ───────────────────────────────────────────────────
ipcMain.handle('cert:generate', async (_, opts) => {
  try {
    const {
      commonName = 'localhost',
      organization = '',
      organizationalUnit = '',
      country = 'VN',
      state = '',
      locality = '',
      validityDays = 365,
      keySize = 2048,
      subjectAltNames = [],
      keyUsage = ['digitalSignature', 'keyEncipherment'],
      extKeyUsage = ['serverAuth'],
    } = opts

    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: keySize,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })

    const cert = buildSelfSignedCert({
      privateKey, publicKey,
      subject: { commonName, organization, organizationalUnit, country, state, locality },
      validityDays: parseInt(validityDays, 10),
      subjectAltNames, keyUsage, extKeyUsage,
    })

    const certObj = new crypto.X509Certificate(cert)
    return {
      ok: true,
      cert, key: privateKey,
      fingerprint: certObj.fingerprint256,
      serial: certObj.serialNumber,
      subject: certObj.subject,
      notBefore: certObj.validFrom,
      notAfter: certObj.validTo,
      subjectAltName: certObj.subjectAltName || '',
    }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

function buildSelfSignedCert({ privateKey, publicKey, subject, validityDays, subjectAltNames, keyUsage, extKeyUsage }) {
  const encLen = (len) => {
    if (len < 128) return Buffer.from([len])
    const bytes = []; let l = len
    while (l > 0) { bytes.unshift(l & 0xff); l >>= 8 }
    return Buffer.from([0x80 | bytes.length, ...bytes])
  }
  const tlv = (tag, value) => {
    const v = Buffer.isBuffer(value) ? value : Buffer.from(value)
    return Buffer.concat([Buffer.from([tag]), encLen(v.length), v])
  }
  const seq = (...items) => tlv(0x30, Buffer.concat(items.map(i => Buffer.isBuffer(i) ? i : Buffer.from(i))))
  const set_ = (...items) => tlv(0x31, Buffer.concat(items.map(i => Buffer.isBuffer(i) ? i : Buffer.from(i))))
  const oid = (dotted) => {
    const parts = dotted.split('.').map(Number)
    const bytes = [40 * parts[0] + parts[1]]
    for (let i = 2; i < parts.length; i++) {
      let n = parts[i]; const b = []
      b.unshift(n & 0x7f); n >>= 7
      while (n > 0) { b.unshift((n & 0x7f) | 0x80); n >>= 7 }
      bytes.push(...b)
    }
    return tlv(0x06, Buffer.from(bytes))
  }
  const utf8str = (s) => tlv(0x0c, Buffer.from(s, 'utf8'))
  const printstr = (s) => tlv(0x13, Buffer.from(s, 'ascii'))
  const bitstr = (buf, unusedBits = 0) => tlv(0x03, Buffer.concat([Buffer.from([unusedBits]), buf]))
  const octetstr = (buf) => tlv(0x04, buf)
  const integer = (n) => {
    if (typeof n === 'number') {
      const b = []; let v = n
      do { b.unshift(v & 0xff); v >>= 8 } while (v > 0)
      if (b[0] & 0x80) b.unshift(0)
      return tlv(0x02, Buffer.from(b))
    }
    return tlv(0x02, n)
  }
  const bool_ = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]))
  const utctime = (d) => {
    const pad = (n) => String(n).padStart(2, '0')
    const s = `${String(d.getUTCFullYear()).slice(2)}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
    return tlv(0x17, Buffer.from(s, 'ascii'))
  }
  const ctxTag = (n, buf) => tlv(0xa0 + n, buf)
  const nullVal = Buffer.from([0x05, 0x00])
  const algId = (algOid) => seq(oid(algOid), nullVal)
  const OID = {
    sha256WithRSAEncryption: '1.2.840.113549.1.1.11',
    CN: '2.5.4.3', O: '2.5.4.10', OU: '2.5.4.11',
    C: '2.5.4.6', ST: '2.5.4.8', L: '2.5.4.7',
    subjectKeyIdentifier: '2.5.29.14', keyUsage: '2.5.29.15',
    subjectAltName: '2.5.29.17', basicConstraints: '2.5.29.19',
    extKeyUsage: '2.5.29.37',
    serverAuth: '1.3.6.1.5.5.7.3.1', clientAuth: '1.3.6.1.5.5.7.3.2',
    codeSigning: '1.3.6.1.5.5.7.3.3', emailProtection: '1.3.6.1.5.5.7.3.4',
  }
  const rdnAttr = (attrOid, val) => val
    ? set_(seq(oid(attrOid), (attrOid === OID.C) ? printstr(val) : utf8str(val)))
    : null
  const buildName = (s) => seq(...[
    rdnAttr(OID.C, s.country), rdnAttr(OID.ST, s.state), rdnAttr(OID.L, s.locality),
    rdnAttr(OID.O, s.organization), rdnAttr(OID.OU, s.organizationalUnit),
    rdnAttr(OID.CN, s.commonName),
  ].filter(Boolean))

  const pubKeyDer = Buffer.from(publicKey.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), 'base64')
  const serialBytes = crypto.randomBytes(16)
  serialBytes[0] &= 0x7f
  if (serialBytes[0] === 0) serialBytes[0] = 0x01

  const now = new Date()
  const notBefore = new Date(now)
  const notAfter = new Date(now)
  notAfter.setDate(notAfter.getDate() + validityDays)

  const KEY_USAGE_BITS = {
    digitalSignature: 7, contentCommitment: 6, keyEncipherment: 5,
    dataEncipherment: 4, keyAgreement: 3, keyCertSign: 2, cRLSign: 1,
  }
  let kuBits = 0
  for (const ku of (keyUsage || [])) {
    if (KEY_USAGE_BITS[ku] !== undefined) kuBits |= (1 << KEY_USAGE_BITS[ku])
  }
  const kuExt = seq(oid(OID.keyUsage), bool_(true), octetstr(seq(bitstr(Buffer.from([(kuBits >> 1) & 0xff]), 1))))
  const EKU_OID = { serverAuth: OID.serverAuth, clientAuth: OID.clientAuth, codeSigning: OID.codeSigning, emailProtection: OID.emailProtection }
  const ekuItems = (extKeyUsage || []).filter(e => EKU_OID[e]).map(e => oid(EKU_OID[e]))
  const ekuExt = ekuItems.length > 0 ? seq(oid(OID.extKeyUsage), octetstr(seq(...ekuItems))) : null
  const SAN_TAG = { dns: 0x82, ip: 0x87, email: 0x81 }
  const sanItems = (subjectAltNames || []).map(({ type, value }) => {
    const tag = SAN_TAG[type] || SAN_TAG.dns
    if (type === 'ip' && value.split('.').length === 4)
      return tlv(tag, Buffer.from(value.split('.').map(Number)))
    return tlv(tag, Buffer.from(value, 'ascii'))
  })
  const sanExt = sanItems.length > 0 ? seq(oid(OID.subjectAltName), octetstr(seq(...sanItems))) : null
  const bcExt = seq(oid(OID.basicConstraints), bool_(true), octetstr(seq(bool_(false))))
  const ski = crypto.createHash('sha1').update(pubKeyDer).digest()
  const skiExt = seq(oid(OID.subjectKeyIdentifier), octetstr(octetstr(ski)))
  const extensions = ctxTag(3, seq(...[kuExt, ekuExt, sanExt, bcExt, skiExt].filter(Boolean)))
  const subjectName = buildName(subject)
  const tbs = seq(
    ctxTag(0, integer(2)), integer(serialBytes),
    algId(OID.sha256WithRSAEncryption),
    subjectName, seq(utctime(notBefore), utctime(notAfter)), subjectName,
    Buffer.from(pubKeyDer), extensions
  )
  const signer = crypto.createSign('sha256')
  signer.update(tbs); signer.end()
  const signature = signer.sign(privateKey)
  const certDer = seq(tbs, algId(OID.sha256WithRSAEncryption), bitstr(signature))
  const b64 = certDer.toString('base64')
  const lines = b64.match(/.{1,64}/g).join('\n')
  return `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----\n`
}

// ── Cert: save file dialog ───────────────────────────────────────────────────
ipcMain.handle('cert:save-file', async (_, { defaultName, content }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [
      { name: 'PEM Files', extensions: ['pem', 'crt', 'key'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  if (result.canceled || !result.filePath) return { ok: false, canceled: true }
  try {
    fs.writeFileSync(result.filePath, content, 'utf8')
    return { ok: true, filePath: result.filePath }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ── File: open text file (dùng cho TLS secret — đọc .crt / .key / .pem) ────
ipcMain.handle('file:open-text', async (_, opts = {}) => {
  const {
    title = 'Chọn file',
    filters = [
      { name: 'PEM / Cert / Key', extensions: ['pem', 'crt', 'key', 'cer', 'ca-bundle'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  } = opts

  const result = await dialog.showOpenDialog(mainWindow, {
    title,
    properties: ['openFile'],
    filters,
  })

  if (result.canceled || !result.filePaths?.length) {
    return { ok: false, canceled: true }
  }

  const filePath = result.filePaths[0]
  try {
    const stat = fs.statSync(filePath)
    if (stat.size > 2 * 1024 * 1024) {
      return { ok: false, error: 'File quá lớn (giới hạn 2 MB)' }
    }
    const content = fs.readFileSync(filePath, 'utf8')
    const fileName = path.basename(filePath)
    return { ok: true, content, fileName, filePath }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})
