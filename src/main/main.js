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
    width: 1400, height: 900, minWidth: 1100, minHeight: 700,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0a0e1a', symbolColor: '#4a9eff', height: 36 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, webSecurity: false,
    },
    backgroundColor: '#0a0e1a', show: false,
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

// ── OIDC ─────────────────────────────────────────────────────────────────────
ipcMain.handle('oidc:open-browser', async (_, url) => {
  await shell.openExternal(url); return { ok: true }
})

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
      if (mainWindow) { mainWindow.webContents.send('oidc:callback', { code, error }); mainWindow.focus() }
    })
    callbackServer.listen(port, () => resolve({ port, ok: true }))
    callbackServer.on('error', (err) => resolve({ ok: false, error: err.message }))
  })
})
ipcMain.handle('oidc:stop-callback-server', () => {
  if (callbackServer) { callbackServer.close(); callbackServer = null }
  return { ok: true }
})

// ── K8s API proxy ─────────────────────────────────────────────────────────────
ipcMain.handle('k8s:fetch', async (_, { url, method = 'GET', headers = {}, body }) => {
  return new Promise((resolve) => {
    let settled = false
    const done = (r) => { if (settled) return; settled = true; resolve(r) }
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
        method: method.toUpperCase(), headers,
        rejectUnauthorized: false, timeout: 30_000,
      }
      const req = lib.request(options, (res) => {
        const chunks = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => done({ status: res.statusCode, data: Buffer.concat(chunks).toString('utf8'), headers: res.headers }))
        res.on('error', e => done({ status: 0, error: `Response error: ${e.message || e.code}` }))
      })
      req.on('error', e => done({ status: 0, error: e.message || e.code || `Network error (${e.syscall})` }))
      req.on('timeout', () => req.destroy(new Error('Request timed out after 30s')))
      if (bodyBuffer) req.write(bodyBuffer)
      req.end()
    } catch (e) { done({ status: 0, error: e.message || String(e) }) }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// ASN.1 / X.509 helpers  (dùng chung cho cả CA và leaf)
// ═════════════════════════════════════════════════════════════════════════════
function makeAsn1() {
  const encLen = (len) => {
    if (len < 128) return Buffer.from([len])
    const b = []; let l = len
    while (l > 0) { b.unshift(l & 0xff); l >>= 8 }
    return Buffer.from([0x80 | b.length, ...b])
  }
  const tlv = (tag, value) => {
    const v = Buffer.isBuffer(value) ? value : Buffer.from(value)
    return Buffer.concat([Buffer.from([tag]), encLen(v.length), v])
  }
  const seq     = (...items) => tlv(0x30, Buffer.concat(items.map(i => Buffer.isBuffer(i) ? i : Buffer.from(i))))
  const set_    = (...items) => tlv(0x31, Buffer.concat(items.map(i => Buffer.isBuffer(i) ? i : Buffer.from(i))))
  const oid     = (dot) => {
    const p = dot.split('.').map(Number)
    const b = [40 * p[0] + p[1]]
    for (let i = 2; i < p.length; i++) {
      let n = p[i]; const x = []
      x.unshift(n & 0x7f); n >>= 7
      while (n > 0) { x.unshift((n & 0x7f) | 0x80); n >>= 7 }
      b.push(...x)
    }
    return tlv(0x06, Buffer.from(b))
  }
  const utf8str  = (s) => tlv(0x0c, Buffer.from(s, 'utf8'))
  const printstr = (s) => tlv(0x13, Buffer.from(s, 'ascii'))
  const bitstr   = (buf, unused = 0) => tlv(0x03, Buffer.concat([Buffer.from([unused]), buf]))
  const octetstr = (buf) => tlv(0x04, buf)
  const bool_    = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]))
  const integer  = (n) => {
    if (typeof n === 'number') {
      const b = []; let v = n
      do { b.unshift(v & 0xff); v >>= 8 } while (v > 0)
      if (b[0] & 0x80) b.unshift(0)
      return tlv(0x02, Buffer.from(b))
    }
    return tlv(0x02, n) // Buffer
  }
  const utctime = (d) => {
    const pad = n => String(n).padStart(2, '0')
    const s = `${String(d.getUTCFullYear()).slice(2)}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
    return tlv(0x17, Buffer.from(s, 'ascii'))
  }
  const ctxTag  = (n, buf) => tlv(0xa0 + n, buf)
  const nullVal = Buffer.from([0x05, 0x00])
  const algId   = (algOid) => seq(oid(algOid), nullVal)

  const OID = {
    sha256WithRSA: '1.2.840.113549.1.1.11',
    CN: '2.5.4.3', O: '2.5.4.10', OU: '2.5.4.11',
    C: '2.5.4.6', ST: '2.5.4.8', L: '2.5.4.7',
    SKI: '2.5.29.14', AKI: '2.5.29.35',
    keyUsage: '2.5.29.15', SAN: '2.5.29.17',
    basicConstraints: '2.5.29.19', extKeyUsage: '2.5.29.37',
    serverAuth: '1.3.6.1.5.5.7.3.1', clientAuth: '1.3.6.1.5.5.7.3.2',
    codeSigning: '1.3.6.1.5.5.7.3.3', emailProtection: '1.3.6.1.5.5.7.3.4',
  }

  const rdnAttr = (attrOid, val) => val
    ? set_(seq(oid(attrOid), attrOid === OID.C ? printstr(val) : utf8str(val)))
    : null

  const buildName = (s) => seq(...[
    rdnAttr(OID.C, s.country), rdnAttr(OID.ST, s.state), rdnAttr(OID.L, s.locality),
    rdnAttr(OID.O, s.organization), rdnAttr(OID.OU, s.organizationalUnit),
    rdnAttr(OID.CN, s.commonName),
  ].filter(Boolean))

  return { seq, set_, oid, utf8str, printstr, bitstr, octetstr, bool_, integer, utctime, ctxTag, nullVal, algId, OID, buildName }
}

/**
 * Build và ký một X.509 certificate.
 *
 * @param {object} opts
 *   subject        – { commonName, organization, organizationalUnit, country, state, locality }
 *   publicKey      – PEM public key của cert cần tạo
 *   signingKey     – PEM private key dùng để ký (CA key hoặc chính nó nếu self-signed)
 *   issuerName     – object giống subject, dùng cho issuer field (bằng subject nếu self-signed)
 *   issuerCertPem  – PEM cert của CA (để lấy SKI làm AKI); null nếu self-signed
 *   validityDays
 *   isCA           – true → basicConstraints CA:true, keyUsage bao gồm keyCertSign
 *   subjectAltNames, keyUsage, extKeyUsage
 */
function buildCert({
  subject, publicKey, signingKey,
  issuerName = null, issuerCertPem = null,
  validityDays = 365, isCA = false,
  subjectAltNames = [], keyUsage = [], extKeyUsage = [],
}) {
  const A = makeAsn1()
  const { seq, oid, bitstr, octetstr, bool_, integer, utctime, ctxTag, algId, OID, buildName } = A

  const pubDer = Buffer.from(publicKey.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), 'base64')

  const serial = crypto.randomBytes(16)
  serial[0] &= 0x7f
  if (serial[0] === 0) serial[0] = 0x01

  const now = new Date()
  const notBefore = new Date(now)
  const notAfter  = new Date(now)
  notAfter.setDate(notAfter.getDate() + validityDays)

  // Subject / Issuer names
  const subjectDN = buildName(subject)
  const issuerDN  = issuerName ? buildName(issuerName) : subjectDN

  // Key Usage
  const KU_BITS = {
    digitalSignature: 0,   // Bit 0: MSB của byte đầu tiên
    contentCommitment: 1,  // Bit 1
    keyEncipherment: 2,    // Bit 2
    dataEncipherment: 3,   // Bit 3
    keyAgreement: 4,       // Bit 4
    keyCertSign: 5,        // Bit 5
    cRLSign: 6,            // Bit 6
    encipherOnly: 7,       // Bit 7
  }

  const effectiveKU = isCA
    ? [...new Set([...keyUsage, 'keyCertSign', 'cRLSign'])]
    : keyUsage

  // Khởi tạo 1 byte dữ liệu trống (8 bits)
  let kuByte = 0
  let maxBit = 0

  for (const ku of effectiveKU) {
    if (KU_BITS[ku] !== undefined) {
      const bitPos = KU_BITS[ku]
      kuByte |= (0x80 >> bitPos) // Dịch bit từ trái sang phải theo chuẩn ASN.1 MSB
      if (bitPos > maxBit) maxBit = bitPos
    }
  }

  // Tính số lượng bit không sử dụng ở cuối byte (Unused bits)
  // Tiêu chuẩn BIT STRING yêu cầu khai báo số lượng bit thừa này
  const unusedBits = 8 - (maxBit + 1)

  // Đóng gói ĐÚNG CHUẨN: Bọc trực tiếp bitstr vào trong octetstr, KHÔNG DÙNG seq() ở đây
  const kuExt = seq(
    oid(OID.keyUsage), 
    bool_(true),
    octetstr(bitstr(Buffer.from([kuByte]), unusedBits)) // Bỏ hàm seq() bọc quanh bitstr
  )

  // Extended Key Usage
  const EKU_MAP = {
    serverAuth: OID.serverAuth, clientAuth: OID.clientAuth,
    codeSigning: OID.codeSigning, emailProtection: OID.emailProtection,
  }
  const ekuItems = (extKeyUsage || []).filter(e => EKU_MAP[e]).map(e => oid(EKU_MAP[e]))
  const ekuExt = ekuItems.length > 0
    ? seq(oid(OID.extKeyUsage), octetstr(seq(...ekuItems)))
    : null

  // Subject Alternative Names
  const SAN_TAG = { dns: 0x82, ip: 0x87, email: 0x81 }
  const sanItems = (subjectAltNames || []).map(({ type, value }) => {
    const tag = SAN_TAG[type] || SAN_TAG.dns
    if (type === 'ip' && /^\d+\.\d+\.\d+\.\d+$/.test(value))
      return A.tlv ? A.tlv(tag, Buffer.from(value.split('.').map(Number)))
                   : Buffer.concat([Buffer.from([tag, 4]), Buffer.from(value.split('.').map(Number))])
    // fallback: build TLV manually
    const v = Buffer.from(value, 'ascii')
    const lenBuf = v.length < 128 ? Buffer.from([v.length]) : (() => {
      const b = []; let l = v.length
      while (l > 0) { b.unshift(l & 0xff); l >>= 8 }
      return Buffer.from([0x80 | b.length, ...b])
    })()
    return Buffer.concat([Buffer.from([tag]), lenBuf, v])
  })
  const sanExt = sanItems.length > 0
    ? seq(oid(OID.SAN), octetstr(seq(...sanItems)))
    : null

  // Basic Constraints
  const bcExt = seq(oid(OID.basicConstraints), bool_(true),
    isCA
      ? octetstr(seq(bool_(true)))          // CA: true (no pathlen)
      : octetstr(seq(bool_(false)))         // CA: false
  )

  // Subject Key Identifier (SHA-1 of subjectPublicKey)
  const ski = crypto.createHash('sha1').update(pubDer).digest()
  const skiExt = seq(oid(OID.SKI), octetstr(octetstr(ski)))

  // Authority Key Identifier — từ SKI của CA cert (nếu có)
  let akiExt = null
  if (issuerCertPem) {
    try {
      const issuerObj = new crypto.X509Certificate(issuerCertPem)
      // Parse AKI từ extensions nếu có; fallback: lấy SKI của issuer cert
      const issuerPubDer = Buffer.from(
        issuerObj.publicKey.export({ type: 'spki', format: 'pem' })
          .replace(/-----[^-]+-----/g, '').replace(/\s/g, ''),
        'base64'
      )
      const issuerSki = crypto.createHash('sha1').update(issuerPubDer).digest()
      // AKI = SEQUENCE { [0] IMPLICIT OCTET STRING (keyIdentifier) }
      const akiContent = seq(Buffer.concat([Buffer.from([0x80, issuerSki.length]), issuerSki]))
      akiExt = seq(oid(OID.AKI), octetstr(akiContent))
    } catch { /* skip AKI nếu parse lỗi */ }
  }

  const extensions = ctxTag(3, seq(...[kuExt, ekuExt, sanExt, bcExt, skiExt, akiExt].filter(Boolean)))

  const tbs = seq(
    ctxTag(0, integer(2)),                    // version: v3
    integer(serial),                           // serialNumber
    algId(OID.sha256WithRSA),                 // signature algorithm
    issuerDN,                                  // issuer
    seq(utctime(notBefore), utctime(notAfter)), // validity
    subjectDN,                                 // subject
    Buffer.from(pubDer),                       // subjectPublicKeyInfo
    extensions
  )

  const signer = crypto.createSign('sha256')
  signer.update(tbs); signer.end()
  const signature = signer.sign(signingKey)

  const certDer = seq(tbs, algId(OID.sha256WithRSA), bitstr(signature))
  const b64 = certDer.toString('base64')
  return `-----BEGIN CERTIFICATE-----\n${b64.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`
}

function certResult(certPem, keyPem) {
  const obj = new crypto.X509Certificate(certPem)
  return {
    ok: true,
    cert: certPem,
    key: keyPem,
    fingerprint: obj.fingerprint256,
    serial: obj.serialNumber,
    subject: obj.subject,
    issuer: obj.issuer,
    notBefore: obj.validFrom,
    notAfter: obj.validTo,
    subjectAltName: obj.subjectAltName || '',
  }
}

// ── IPC: Generate Root CA ─────────────────────────────────────────────────────
ipcMain.handle('cert:generate-ca', async (_, opts) => {
  try {
    const {
      commonName = 'My Root CA',
      organization = '', organizationalUnit = '',
      country = 'VN', state = '', locality = '',
      validityDays = 3650, keySize = 4096,
    } = opts

    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: keySize,
      publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })

    const subject = { commonName, organization, organizationalUnit, country, state, locality }

    const certPem = buildCert({
      subject, publicKey, signingKey: privateKey,
      issuerName: subject, issuerCertPem: null,
      validityDays: parseInt(validityDays, 10),
      isCA: true,
      subjectAltNames: [],
      keyUsage: ['keyCertSign', 'cRLSign', 'digitalSignature'],
      extKeyUsage: [],
    })

    return certResult(certPem, privateKey)
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ── IPC: Generate Leaf Certificate (ký bởi CA) ────────────────────────────────
ipcMain.handle('cert:sign-leaf', async (_, opts) => {
  try {
    const {
      // Leaf subject
      commonName, organization = '', organizationalUnit = '',
      country = 'VN', state = '', locality = '',
      validityDays = 365, keySize = 2048,
      subjectAltNames = [], keyUsage = [], extKeyUsage = [],
      // CA info (PEM strings)
      caCert, caKey,
    } = opts

    if (!caCert || !caKey) throw new Error('Thiếu CA certificate hoặc CA private key')
    if (!commonName?.trim()) throw new Error('Common Name không được để trống')

    // Parse issuer DN từ CA cert
    const caObj = new crypto.X509Certificate(caCert)
    // Parse subject fields từ string "CN=..., O=..., C=..."
    const parseSubjectStr = (str) => {
      const result = {}
      str.split('\n').forEach(line => {
        const [k, ...rest] = line.split('=')
        const v = rest.join('=').trim()
        if (k === 'CN') result.commonName = v
        else if (k === 'O') result.organization = v
        else if (k === 'OU') result.organizationalUnit = v
        else if (k === 'C') result.country = v
        else if (k === 'ST') result.state = v
        else if (k === 'L') result.locality = v
      })
      return result
    }
    const issuerName = parseSubjectStr(caObj.subject)

    // Generate leaf key pair
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: keySize,
      publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })

    const subject = { commonName, organization, organizationalUnit, country, state, locality }

    const certPem = buildCert({
      subject, publicKey,
      signingKey: caKey,
      issuerName,
      issuerCertPem: caCert,
      validityDays: parseInt(validityDays, 10),
      isCA: false,
      subjectAltNames,
      keyUsage: keyUsage.length > 0 ? keyUsage : ['digitalSignature', 'keyEncipherment'],
      extKeyUsage: extKeyUsage.length > 0 ? extKeyUsage : ['serverAuth'],
    })

    return {
      ...certResult(certPem, privateKey),
      // Trả thêm chain = leaf cert + CA cert (dùng cho nginx / k8s tls secret)
      chain: certPem + caCert,
    }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ── IPC: Generate self-signed (giữ nguyên backward compat) ────────────────────
ipcMain.handle('cert:generate', async (_, opts) => {
  try {
    const {
      commonName = 'localhost', organization = '', organizationalUnit = '',
      country = 'VN', state = '', locality = '',
      validityDays = 365, keySize = 2048,
      subjectAltNames = [], keyUsage = [], extKeyUsage = [],
    } = opts

    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: keySize,
      publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })

    const subject = { commonName, organization, organizationalUnit, country, state, locality }
    const certPem = buildCert({
      subject, publicKey, signingKey: privateKey,
      issuerName: subject, issuerCertPem: null,
      validityDays: parseInt(validityDays, 10), isCA: false,
      subjectAltNames,
      keyUsage: keyUsage.length ? keyUsage : ['digitalSignature', 'keyEncipherment'],
      extKeyUsage: extKeyUsage.length ? extKeyUsage : ['serverAuth'],
    })

    return certResult(certPem, privateKey)
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ── Cert: save file ───────────────────────────────────────────────────────────
ipcMain.handle('cert:save-file', async (_, { defaultName, content }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [{ name: 'PEM Files', extensions: ['pem', 'crt', 'key'] }, { name: 'All Files', extensions: ['*'] }],
  })
  if (result.canceled || !result.filePath) return { ok: false, canceled: true }
  try { fs.writeFileSync(result.filePath, content, 'utf8'); return { ok: true, filePath: result.filePath } }
  catch (e) { return { ok: false, error: e.message } }
})

// ── File: open text ───────────────────────────────────────────────────────────
ipcMain.handle('file:open-text', async (_, opts = {}) => {
  const { title = 'Chọn file', filters = [
    { name: 'PEM / Cert / Key', extensions: ['pem', 'crt', 'key', 'cer', 'ca-bundle'] },
    { name: 'All Files', extensions: ['*'] },
  ]} = opts
  const result = await dialog.showOpenDialog(mainWindow, { title, properties: ['openFile'], filters })
  if (result.canceled || !result.filePaths?.length) return { ok: false, canceled: true }
  const filePath = result.filePaths[0]
  try {
    const stat = fs.statSync(filePath)
    if (stat.size > 2 * 1024 * 1024) return { ok: false, error: 'File quá lớn (giới hạn 2 MB)' }
    const content = fs.readFileSync(filePath, 'utf8')
    return { ok: true, content, fileName: path.basename(filePath), filePath }
  } catch (e) { return { ok: false, error: e.message } }
})
