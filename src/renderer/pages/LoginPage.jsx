import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Terminal, Wifi, WifiOff, Eye, EyeOff, ArrowRight, Settings, Key } from 'lucide-react'
import { useAuthStore } from '../store'
import { OidcService } from '../services/oidcService'
import styles from './LoginPage.module.css'

export default function LoginPage() {
  const navigate = useNavigate()
  const { oidcConfig, setTokens } = useAuthStore()

  const [tab, setTab] = useState('password') // 'password' | 'browser'
  const [form, setForm] = useState({ username: '', password: '' })
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('idle') // idle | connecting | success | error

  const hasConfig = !!oidcConfig?.issuerUri

  // ── Password Grant ─────────────────────────────────────────────────────────
  const handlePasswordLogin = async () => {
    if (!hasConfig) { setError('Chưa cấu hình OIDC. Vào Settings để cấu hình.'); return }
    if (!form.username || !form.password) { setError('Vui lòng nhập đầy đủ thông tin'); return }

    setLoading(true)
    setError('')
    setStatus('connecting')

    try {
      const svc = new OidcService(oidcConfig)
      const tokens = await svc.loginWithPassword(form.username, form.password)
      setTokens(tokens)
      setStatus('success')
      setTimeout(() => navigate('/'), 600)
    } catch (e) {
      setStatus('error')
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Browser Auth Code Flow ─────────────────────────────────────────────────
  const handleBrowserLogin = async () => {
    if (!hasConfig) { setError('Chưa cấu hình OIDC.'); return }
    if (!window.electronAPI) { setError('Chỉ hỗ trợ trong Electron app'); return }

    setLoading(true)
    setError('')
    setStatus('connecting')

    try {
      const redirectUri = 'http://localhost:8989/callback'
      const serverResult = await window.electronAPI.startCallbackServer(8989)
      if (!serverResult.ok) throw new Error('Không thể khởi động callback server: ' + serverResult.error)

      const state = Math.random().toString(36).substring(2)
      const svc = new OidcService(oidcConfig)
      const authUrl = await svc.buildAuthorizationUrl(state, redirectUri)
      await window.electronAPI.openBrowser(authUrl)

      // Wait for callback
      const callbackData = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout sau 5 phút')), 300_000)
        window.electronAPI.onOidcCallback((data) => {
          clearTimeout(timeout)
          resolve(data)
        })
      })

      window.electronAPI.removeOidcCallback()
      await window.electronAPI.stopCallbackServer()

      if (callbackData.error) throw new Error(callbackData.error)
      if (!callbackData.code) throw new Error('Không nhận được authorization code')

      const tokens = await svc.exchangeCode(callbackData.code, redirectUri)
      setTokens(tokens)
      setStatus('success')
      setTimeout(() => navigate('/'), 600)
    } catch (e) {
      setStatus('error')
      setError(e.message)
      window.electronAPI?.removeOidcCallback()
      window.electronAPI?.stopCallbackServer()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.root}>
      {/* Animated grid background */}
      <div className={styles.grid} />

      {/* Scan line effect */}
      <div className={styles.scanline} />

      {/* Corner decorations */}
      <div className={styles.cornerTL} />
      <div className={styles.cornerBR} />

      <motion.div
        className={styles.card}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.logo}>
            <Terminal size={22} color="var(--accent-blue)" />
          </div>
          <div>
            <h1 className={styles.title}>Microservices Manager</h1>
            <p className={styles.subtitle}>
              K8s + OIDC via{' '}
              <span className={styles.issuerBadge}>
                {hasConfig ? oidcConfig.issuerUri : 'Chưa cấu hình'}
              </span>
            </p>
          </div>
          <button className={styles.settingsBtn} onClick={() => navigate('/oidc-config')} title="OIDC Settings">
            <Settings size={16} />
          </button>
        </div>

        {/* Status bar */}
        <div className={styles.statusBar}>
          <span className={`status-dot ${hasConfig ? 'active' : 'error'}`} />
          <span className={styles.statusText}>
            {hasConfig
              ? `OIDC: ${oidcConfig.issuerUri}`
              : 'OIDC chưa được cấu hình'}
          </span>
          {hasConfig && (
            <span className={styles.configuredBadge}>CONFIGURED</span>
          )}
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          {[
            { id: 'password', label: 'Password Grant', icon: Key },
            { id: 'browser', label: 'Browser Flow', icon: Wifi },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`${styles.tab} ${tab === id ? styles.tabActive : ''}`}
              onClick={() => setTab(id)}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        {/* Form content */}
        <div className={styles.formBody}>
          <AnimatePresence mode="wait">
            {tab === 'password' ? (
              <motion.div
                key="password"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.15 }}
              >
                <div className={styles.field}>
                  <label className={styles.label}>USERNAME / EMAIL</label>
                  <input
                    className={styles.input}
                    placeholder="admin@example.com"
                    value={form.username}
                    onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && handlePasswordLogin()}
                    autoFocus
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>PASSWORD</label>
                  <div className={styles.inputWrap}>
                    <input
                      className={styles.input}
                      type={showPwd ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={form.password}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && handlePasswordLogin()}
                    />
                    <button className={styles.eyeBtn} onClick={() => setShowPwd(v => !v)}>
                      {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {error && (
                    <motion.div
                      className={styles.error}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      ⚠ {error}
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  className={styles.submitBtn}
                  onClick={handlePasswordLogin}
                  disabled={loading || !hasConfig}
                >
                  {loading ? (
                    <span className={styles.spinner} />
                  ) : status === 'success' ? (
                    '✓ Thành công'
                  ) : (
                    <>
                      Đăng nhập
                      <ArrowRight size={15} />
                    </>
                  )}
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="browser"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.15 }}
              >
                <div className={styles.browserInfo}>
                  <Wifi size={28} color="var(--accent-blue)" style={{ marginBottom: 12 }} />
                  <p>Sẽ mở browser để xác thực qua</p>
                  <p className={styles.mono} style={{ color: 'var(--accent-cyan)', marginTop: 4 }}>
                    Authorization Code Flow + PKCE
                  </p>
                  <p style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                    Callback: <code>http://localhost:8989/callback</code>
                  </p>
                </div>

                <AnimatePresence>
                  {error && (
                    <motion.div
                      className={styles.error}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      ⚠ {error}
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  className={styles.submitBtn}
                  onClick={handleBrowserLogin}
                  disabled={loading || !hasConfig}
                >
                  {loading ? (
                    <>
                      <span className={styles.spinner} />
                      Chờ xác thực...
                    </>
                  ) : (
                    <>
                      Mở Browser
                      <ArrowRight size={15} />
                    </>
                  )}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer hint */}
        <div className={styles.footer}>
          <span className={styles.footerText}>
            auth-service: POST /oauth2/token · RS256 JWT · RBAC Claims
          </span>
        </div>
      </motion.div>
    </div>
  )
}
