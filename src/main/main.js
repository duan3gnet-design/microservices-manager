const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const http = require('http')
const https = require('https')
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// ── OIDC: open browser for authorization code flow ──────────────────────────
ipcMain.handle('oidc:open-browser', async (_, url) => {
  await shell.openExternal(url)
  return { ok: true }
})

// ── OIDC: local callback server for authorization code ──────────────────────
let callbackServer = null

ipcMain.handle('oidc:start-callback-server', async (_, port = 8989) => {
  return new Promise((resolve) => {
    if (callbackServer) {
      callbackServer.close()
      callbackServer = null
    }
    callbackServer = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`)
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`
        <!DOCTYPE html><html><body style="font-family:monospace;background:#0a0e1a;color:#4a9eff;padding:2rem;">
        <h2>${error ? '❌ Lỗi xác thực' : '✅ Xác thực thành công'}</h2>
        <p>${error || 'Bạn có thể đóng tab này.'}</p>
        <script>window.close()</script>
        </body></html>
      `)

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

// ── HTTP proxy for k8s API calls (bypass CORS + SSL) ────────────────────────
ipcMain.handle('k8s:fetch', async (_, { url, method = 'GET', headers = {}, body }) => {
  return new Promise((resolve) => {
    // Dùng flag để tránh resolve() nhiều lần khi cả timeout lẫn error cùng fire
    let settled = false
    const done = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    try {
      const parsed = new URL(url)
      const isHttps = parsed.protocol === 'https:'
      const lib = isHttps ? https : http

      // Chuẩn bị body buffer trước để tính Content-Length chính xác.
      // Bug cũ: req.write(string) không tự set Content-Length → một số server
      // (k8s API, nginx) treo chờ thêm data → req.on('error') fire với message rỗng.
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
        rejectUnauthorized: false, // cho phép self-signed cert (minikube, kind)
        timeout: 30_000,           // socket idle timeout
      }

      const req = lib.request(options, (res) => {
        // Dùng Buffer chunks để tránh encoding issue với binary response
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString('utf8')
          done({ status: res.statusCode, data, headers: res.headers })
        })
        res.on('error', (e) => {
          done({ status: 0, error: `Response stream error: ${e.message || e.code || 'unknown'}` })
        })
      })

      // req.on('error') bắt: ECONNREFUSED, ENOTFOUND, ETIMEDOUT, CERT_*…
      // e.message của ECONNREFUSED thường là "connect ECONNREFUSED 127.0.0.1:6443"
      // → không bao giờ rỗng nữa vì ta fallback sang e.code
      req.on('error', (e) => {
        const msg = e.message || e.code || `Network error (${e.syscall || 'unknown'})`
        done({ status: 0, error: msg })
      })

      // timeout event chỉ đặt socket vào trạng thái timed-out,
      // cần destroy() thủ công để trigger req.on('error')
      req.on('timeout', () => {
        req.destroy(new Error('Request timed out after 30s'))
      })

      // Ghi body SAU KHI đã bind hết event listeners để tránh race condition
      if (bodyBuffer) req.write(bodyBuffer)
      req.end()

    } catch (e) {
      // Lỗi đồng bộ (URL parse, v.v.)
      done({ status: 0, error: e.message || String(e) })
    }
  })
})
