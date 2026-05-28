import { useState } from 'react'
import { motion } from 'framer-motion'
import { X, Copy, Check, RefreshCw, Clock, Shield, Key, ChevronDown, ChevronRight } from 'lucide-react'
import { useAuthStore } from '../store'
import { useTokenInfo } from '../hooks/useAuth'
import { OidcService } from '../services/oidcService'
import styles from './TokenInfoPanel.module.css'

/**
 * Slide-in panel hiển thị thông tin chi tiết về OIDC tokens:
 * - Access token (decoded header + payload)
 * - ID token claims
 * - Refresh token
 * - Thời gian còn lại
 * - Nút refresh thủ công
 */
export default function TokenInfoPanel({ onClose }) {
  const { tokens, oidcConfig, setTokens, logout } = useAuthStore()
  const info = useTokenInfo()

  const [copied, setCopied] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const [expandedSections, setExpandedSections] = useState({
    accessHeader: false,
    accessPayload: true,
    idToken: false,
    raw: false,
  })

  const toggleSection = (key) =>
    setExpandedSections(s => ({ ...s, [key]: !s[key] }))

  const copyToClipboard = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    } catch { /* ignore */ }
  }

  const handleRefresh = async () => {
    if (!tokens?.refresh_token || !oidcConfig?.issuerUri) return
    setRefreshing(true)
    setRefreshError('')
    try {
      const svc = new OidcService(oidcConfig)
      const newTokens = await svc.refreshToken(tokens.refresh_token)
      setTokens(newTokens)
    } catch (e) {
      setRefreshError(e.message)
    } finally {
      setRefreshing(false)
    }
  }

  const expiryColor =
    info.isExpired ? 'var(--accent-red)'
    : info.expiresIn < 300 ? 'var(--accent-amber)'
    : 'var(--accent-green)'

  return (
    <motion.div
      className={styles.panel}
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 400, damping: 38 }}
    >
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Shield size={14} color="var(--accent-blue)" />
          <span className={styles.title}>Token Inspector</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose}><X size={14} /></button>
      </div>

      {/* Expiry bar */}
      <div className={styles.expiryBar}>
        <Clock size={12} color={expiryColor} />
        <span className={styles.expiryLabel}>Access token</span>
        <span className={styles.expiryValue} style={{ color: expiryColor }}>
          {info.isExpired ? '⚠ Đã hết hạn' : info.expiresInHuman ? `còn ${info.expiresInHuman}` : '—'}
        </span>
        <button
          className={styles.refreshBtn}
          onClick={handleRefresh}
          disabled={refreshing || !tokens?.refresh_token}
          title="Refresh token"
        >
          <RefreshCw size={12} className={refreshing ? styles.spin : ''} />
        </button>
      </div>

      {refreshError && (
        <div className={styles.errorBanner}>⚠ {refreshError}</div>
      )}

      {/* Scrollable content */}
      <div className={styles.body}>

        {/* ── Access Token ── */}
        <Section
          title="ACCESS TOKEN"
          icon={<Key size={12} />}
          badge={info.accessDecoded?.header?.alg || 'RS256'}
          badgeColor="var(--accent-blue)"
          actions={
            info.accessToken && (
              <CopyBtn
                text={info.accessToken}
                copied={copied === 'access'}
                onClick={() => copyToClipboard(info.accessToken, 'access')}
              />
            )
          }
        >
          {/* Header */}
          <Collapsible
            label="Header"
            open={expandedSections.accessHeader}
            onToggle={() => toggleSection('accessHeader')}
          >
            <JsonView data={info.accessDecoded?.header} />
          </Collapsible>

          {/* Payload */}
          <Collapsible
            label="Payload"
            open={expandedSections.accessPayload}
            onToggle={() => toggleSection('accessPayload')}
          >
            <ClaimsView
              payload={info.accessDecoded?.payload}
              highlight={['roles', 'permissions', 'sub', 'iss']}
            />
          </Collapsible>
        </Section>

        {/* ── ID Token ── */}
        {info.idToken && (
          <Section
            title="ID TOKEN (OIDC)"
            icon={<Shield size={12} />}
            badge="id_token"
            badgeColor="var(--accent-purple)"
            actions={
              <CopyBtn
                text={info.idToken}
                copied={copied === 'id'}
                onClick={() => copyToClipboard(info.idToken, 'id')}
              />
            }
          >
            <Collapsible
              label="Claims"
              open={expandedSections.idToken}
              onToggle={() => toggleSection('idToken')}
            >
              <ClaimsView
                payload={info.idDecoded?.payload}
                highlight={['sub', 'email', 'aud', 'iss', 'roles']}
              />
            </Collapsible>
          </Section>
        )}

        {/* ── Refresh Token ── */}
        <Section
          title="REFRESH TOKEN"
          icon={<RefreshCw size={12} />}
          badge={tokens?.refresh_token ? 'present' : 'absent'}
          badgeColor={tokens?.refresh_token ? 'var(--accent-green)' : 'var(--text-muted)'}
          actions={
            tokens?.refresh_token && (
              <CopyBtn
                text={tokens.refresh_token}
                copied={copied === 'refresh'}
                onClick={() => copyToClipboard(tokens.refresh_token, 'refresh')}
              />
            )
          }
        >
          {tokens?.refresh_token ? (
            <div className={styles.tokenRaw}>
              {tokens.refresh_token.slice(0, 40)}…
            </div>
          ) : (
            <div className={styles.absent}>Không có refresh token</div>
          )}
        </Section>

        {/* ── Raw tokens ── */}
        <Section
          title="RAW TOKENS"
          icon={null}
          badge="kubectl"
          badgeColor="var(--accent-cyan)"
        >
          <Collapsible
            label="kubectl --token=..."
            open={expandedSections.raw}
            onToggle={() => toggleSection('raw')}
          >
            <div className={styles.rawBox}>
              <div className={styles.rawLabel}>Access token (dùng cho kubectl)</div>
              <div className={styles.rawToken}>
                {info.accessToken
                  ? `${info.accessToken.slice(0, 60)}…`
                  : '—'}
              </div>
              {info.accessToken && (
                <button
                  className={styles.copyFullBtn}
                  onClick={() => copyToClipboard(
                    `kubectl --token="${info.accessToken}" get pods`,
                    'kubectl'
                  )}
                >
                  {copied === 'kubectl' ? <><Check size={11} /> Đã copy</> : <><Copy size={11} /> Copy lệnh kubectl</>}
                </button>
              )}
            </div>
          </Collapsible>
        </Section>

      </div>

      {/* Footer */}
      <div className={styles.footer}>
        <span className={styles.issuer}>
          {oidcConfig?.issuerUri || 'No issuer'}
        </span>
        <button className={styles.logoutLink} onClick={() => { logout(); onClose() }}>
          Đăng xuất
        </button>
      </div>
    </motion.div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, icon, badge, badgeColor, actions, children }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div className={styles.sectionTitle}>
          {icon}
          <span>{title}</span>
        </div>
        <div className={styles.sectionRight}>
          {badge && (
            <span className={styles.badge} style={{ color: badgeColor, borderColor: badgeColor + '40' }}>
              {badge}
            </span>
          )}
          {actions}
        </div>
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </div>
  )
}

function Collapsible({ label, open, onToggle, children }) {
  return (
    <div className={styles.collapsible}>
      <button className={styles.collapsibleTrigger} onClick={onToggle}>
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span>{label}</span>
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.15 }}
          className={styles.collapsibleBody}
        >
          {children}
        </motion.div>
      )}
    </div>
  )
}

function ClaimsView({ payload, highlight = [] }) {
  if (!payload) return <div className={styles.absent}>—</div>

  const HUMAN = {
    sub: 'Subject',
    iss: 'Issuer',
    aud: 'Audience',
    exp: 'Expires',
    iat: 'Issued at',
    email: 'Email',
    name: 'Name',
    roles: 'Roles',
    permissions: 'Permissions',
    kid: 'Key ID',
  }

  const fmt = (key, val) => {
    if ((key === 'exp' || key === 'iat') && typeof val === 'number') {
      return new Date(val * 1000).toLocaleString('vi-VN')
    }
    if (Array.isArray(val)) return val.join(', ') || '(empty)'
    if (typeof val === 'object') return JSON.stringify(val)
    return String(val)
  }

  return (
    <div className={styles.claims}>
      {Object.entries(payload).map(([k, v]) => (
        <div key={k} className={`${styles.claimRow} ${highlight.includes(k) ? styles.claimHighlight : ''}`}>
          <span className={styles.claimKey}>{HUMAN[k] || k}</span>
          <span className={styles.claimVal}>{fmt(k, v)}</span>
        </div>
      ))}
    </div>
  )
}

function JsonView({ data }) {
  if (!data) return null
  return (
    <pre className={styles.json}>
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

function CopyBtn({ text, copied, onClick }) {
  return (
    <button className={styles.copyBtn} onClick={onClick} title="Copy token">
      {copied ? <Check size={12} color="var(--accent-green)" /> : <Copy size={12} />}
    </button>
  )
}
