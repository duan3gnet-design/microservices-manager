import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, CheckCircle, RefreshCw, Server, Key, Globe } from 'lucide-react'
import { useAuthStore, useK8sStore } from '../store'
import { OidcService } from '../services/oidcService'
import styles from './OidcConfigPage.module.css'

const DEFAULT_CONFIG = {
  issuerUri: 'http://localhost:8081',
  clientId: '',
  clientSecret: '',
  k8sApiServer: 'https://localhost:6443',
}

export default function OidcConfigPage() {
  const navigate = useNavigate()
  const { oidcConfig, setOidcConfig } = useAuthStore()
  const { addCluster, setActiveCluster } = useK8sStore()

  const [form, setForm] = useState({ ...DEFAULT_CONFIG, ...(oidcConfig || {}) })
  const [clusterName, setClusterName] = useState(oidcConfig?.clusterName || 'local-k8s')
  const [discovery, setDiscovery] = useState(null)
  const [testStatus, setTestStatus] = useState('idle') // idle | loading | ok | error
  const [testError, setTestError] = useState('')
  const [saved, setSaved] = useState(false)

  const update = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }))

  const testConnection = async () => {
    setTestStatus('loading')
    setTestError('')
    setDiscovery(null)
    try {
      const svc = new OidcService({ issuerUri: form.issuerUri })
      const doc = await svc.fetchDiscovery()
      setDiscovery(doc)
      setTestStatus('ok')
    } catch (e) {
      setTestStatus('error')
      setTestError(e.message)
    }
  }

  const handleSave = () => {
    const config = { ...form, clusterName }
    setOidcConfig(config)

    // Đồng thời lưu cluster config
    const cluster = {
      name: clusterName,
      apiServer: form.k8sApiServer,
      oidcIssuer: form.issuerUri,
    }
    addCluster(cluster)
    setActiveCluster(cluster)

    setSaved(true)
    setTimeout(() => navigate('/login'), 1000)
  }

  return (
    <div className={styles.root}>
      <motion.div
        className={styles.container}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {/* Header */}
        <div className={styles.header}>
          <button className={styles.backBtn} onClick={() => navigate(-1)}>
            <ArrowLeft size={14} />
          </button>
          <h1 className={styles.title}>OIDC + K8s Configuration</h1>
        </div>

        <div className={styles.grid}>
          {/* Left: OIDC Settings */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <Key size={14} color="var(--accent-blue)" />
              <span>OIDC Provider (auth-service)</span>
            </div>

            <Field label="ISSUER URI" hint="URL public của auth-service">
              <input
                className={styles.input}
                value={form.issuerUri}
                onChange={update('issuerUri')}
                placeholder="http://localhost:8081"
              />
            </Field>

            <Field label="CLIENT ID" hint="Optional – để trống nếu dùng password grant">
              <input
                className={styles.input}
                value={form.clientId}
                onChange={update('clientId')}
                placeholder="k8s-desktop"
              />
            </Field>

            <Field label="CLIENT SECRET" hint="Optional – chỉ cần với authorization_code flow">
              <input
                className={styles.input}
                type="password"
                value={form.clientSecret}
                onChange={update('clientSecret')}
                placeholder="••••••••"
              />
            </Field>

            {/* Test connection button */}
            <button
              className={`${styles.testBtn} ${testStatus === 'ok' ? styles.testOk : testStatus === 'error' ? styles.testError : ''}`}
              onClick={testConnection}
              disabled={testStatus === 'loading'}
            >
              {testStatus === 'loading' ? (
                <><span className={styles.spinner} /> Đang kiểm tra...</>
              ) : testStatus === 'ok' ? (
                <><CheckCircle size={13} /> Discovery thành công</>
              ) : (
                <><RefreshCw size={13} /> Kiểm tra kết nối</>
              )}
            </button>

            {testError && (
              <div className={styles.errorBox}>⚠ {testError}</div>
            )}
          </section>

          {/* Right: K8s + Discovery */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <Server size={14} color="var(--accent-cyan)" />
              <span>Kubernetes Cluster</span>
            </div>

            <Field label="CLUSTER NAME">
              <input
                className={styles.input}
                value={clusterName}
                onChange={e => setClusterName(e.target.value)}
                placeholder="local-k8s"
              />
            </Field>

            <Field label="K8S API SERVER" hint="URL của Kubernetes API server">
              <input
                className={styles.input}
                value={form.k8sApiServer}
                onChange={update('k8sApiServer')}
                placeholder="https://localhost:6443"
              />
            </Field>

            {/* Discovery doc result */}
            {discovery && (
              <motion.div
                className={styles.discoveryBox}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className={styles.discoveryTitle}>
                  <Globe size={12} />
                  Discovery Document
                </div>
                {[
                  ['issuer', discovery.issuer],
                  ['token_endpoint', discovery.token_endpoint?.replace(form.issuerUri, '…')],
                  ['jwks_uri', discovery.jwks_uri?.replace(form.issuerUri, '…')],
                  ['grant_types', discovery.grant_types_supported?.join(', ')],
                  ['id_token_alg', discovery.id_token_signing_alg_values_supported?.join(', ')],
                ].map(([k, v]) => v && (
                  <div key={k} className={styles.discoveryRow}>
                    <span className={styles.discoveryKey}>{k}</span>
                    <span className={styles.discoveryVal}>{v}</span>
                  </div>
                ))}
              </motion.div>
            )}

            {/* K8s guide hint */}
            <div className={styles.hintBox}>
              <p className={styles.hintTitle}>K8s API Server flags</p>
              <pre className={styles.hintCode}>{`--oidc-issuer-url=${form.issuerUri || '<issuer>'}
--oidc-client-id=kubernetes
--oidc-username-claim=sub
--oidc-groups-claim=roles
--oidc-groups-prefix=oidc_
--oidc-ca-file=/etc/kubernetes/pki/oidc_root_ca.crt`}</pre>
            </div>
          </section>
        </div>

        {/* Save */}
        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={() => navigate(-1)}>
            Huỷ
          </button>
          <button
            className={`${styles.saveBtn} ${saved ? styles.saveDone : ''}`}
            onClick={handleSave}
          >
            {saved ? '✓ Đã lưu' : 'Lưu cấu hình'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.8px', color: 'var(--text-muted)' }}>
          {label}
        </label>
        {hint && <span style={{ fontSize: 10, color: 'var(--text-muted)', opacity: 0.7 }}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}
