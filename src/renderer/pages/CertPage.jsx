import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldCheck, Plus, Trash2, ChevronDown, ChevronRight,
  Download, Copy, Check, RefreshCw, AlertCircle,
  Globe, Server, Mail, Hash, Clock, Key, Lock,
} from 'lucide-react'
import styles from './CertPage.module.css'

// ── Defaults ──────────────────────────────────────────────────────────────────
const DEFAULT_FORM = {
  commonName: 'localhost',
  organization: '',
  organizationalUnit: '',
  country: 'VN',
  state: '',
  locality: '',
  validityDays: 365,
  keySize: 2048,
  subjectAltNames: [
    { type: 'dns', value: 'localhost' },
    { type: 'ip', value: '127.0.0.1' },
  ],
  keyUsage: ['digitalSignature', 'keyEncipherment'],
  extKeyUsage: ['serverAuth'],
}

const KEY_USAGE_OPTIONS = [
  { value: 'digitalSignature', label: 'Digital Signature' },
  { value: 'keyEncipherment', label: 'Key Encipherment' },
  { value: 'contentCommitment', label: 'Content Commitment' },
  { value: 'dataEncipherment', label: 'Data Encipherment' },
  { value: 'keyAgreement', label: 'Key Agreement' },
  { value: 'keyCertSign', label: 'Key Cert Sign (CA)' },
  { value: 'cRLSign', label: 'CRL Sign' },
]

const EXT_KEY_USAGE_OPTIONS = [
  { value: 'serverAuth', label: 'Server Authentication (TLS)' },
  { value: 'clientAuth', label: 'Client Authentication (mTLS)' },
  { value: 'codeSigning', label: 'Code Signing' },
  { value: 'emailProtection', label: 'Email Protection (S/MIME)' },
]

const PRESETS = {
  'K8s API Server': {
    commonName: 'kubernetes',
    organization: 'Kubernetes',
    subjectAltNames: [
      { type: 'dns', value: 'kubernetes' },
      { type: 'dns', value: 'kubernetes.default' },
      { type: 'dns', value: 'kubernetes.default.svc' },
      { type: 'dns', value: 'kubernetes.default.svc.cluster.local' },
      { type: 'ip', value: '10.96.0.1' },
      { type: 'ip', value: '127.0.0.1' },
    ],
    keyUsage: ['digitalSignature', 'keyEncipherment'],
    extKeyUsage: ['serverAuth'],
    validityDays: 3650,
    keySize: 2048,
  },
  'OIDC / auth-service': {
    commonName: 'auth-service',
    organization: 'RBAC Gateway',
    subjectAltNames: [
      { type: 'dns', value: 'auth-service' },
      { type: 'dns', value: 'auth-service.default.svc.cluster.local' },
      { type: 'ip', value: '127.0.0.1' },
    ],
    keyUsage: ['digitalSignature', 'keyEncipherment'],
    extKeyUsage: ['serverAuth'],
    validityDays: 365,
    keySize: 2048,
  },
  'mTLS Client': {
    commonName: 'client',
    organization: '',
    subjectAltNames: [],
    keyUsage: ['digitalSignature'],
    extKeyUsage: ['clientAuth'],
    validityDays: 365,
    keySize: 2048,
  },
  'Localhost Dev': {
    commonName: 'localhost',
    organization: 'Dev',
    subjectAltNames: [
      { type: 'dns', value: 'localhost' },
      { type: 'dns', value: '*.localhost' },
      { type: 'ip', value: '127.0.0.1' },
      { type: 'ip', value: '::1' },
    ],
    keyUsage: ['digitalSignature', 'keyEncipherment'],
    extKeyUsage: ['serverAuth'],
    validityDays: 825,
    keySize: 2048,
  },
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function CertPage() {
  const [form, setForm] = useState(DEFAULT_FORM)
  const [result, setResult] = useState(null)   // { ok, cert, key, fingerprint, ... }
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [activePreset, setActivePreset] = useState(null)
  const [expanded, setExpanded] = useState({ subject: true, san: true, usage: false, advanced: false })
  const [copied, setCopied] = useState(null)   // 'cert' | 'key' | 'fingerprint'
  const [activeTab, setActiveTab] = useState('cert') // 'cert' | 'key'
  const [saving, setSaving] = useState(null)   // 'cert' | 'key' | null

  // ── Form helpers ────────────────────────────────────────────────────────────
  const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }))

  const toggleSection = (key) => setExpanded(s => ({ ...s, [key]: !s[key] }))

  const toggleCheckbox = (field, value) => {
    setForm(f => ({
      ...f,
      [field]: f[field].includes(value)
        ? f[field].filter(v => v !== value)
        : [...f[field], value],
    }))
  }

  const addSan = () => setForm(f => ({
    ...f,
    subjectAltNames: [...f.subjectAltNames, { type: 'dns', value: '' }],
  }))

  const removeSan = (i) => setForm(f => ({
    ...f,
    subjectAltNames: f.subjectAltNames.filter((_, idx) => idx !== i),
  }))

  const updateSan = (i, field, val) => setForm(f => ({
    ...f,
    subjectAltNames: f.subjectAltNames.map((s, idx) =>
      idx === i ? { ...s, [field]: val } : s
    ),
  }))

  const applyPreset = (name) => {
    const preset = PRESETS[name]
    setForm(f => ({ ...DEFAULT_FORM, ...f, ...preset }))
    setActivePreset(name)
    setResult(null)
    setError('')
  }

  // ── Generate ────────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!form.commonName.trim()) { setError('Common Name không được để trống'); return }
    if (!window.electronAPI?.generateCert) { setError('Tính năng này chỉ hoạt động trong Electron app'); return }

    setLoading(true)
    setError('')
    setResult(null)

    try {
      const res = await window.electronAPI.generateCert({
        ...form,
        validityDays: Number(form.validityDays),
        keySize: Number(form.keySize),
      })
      if (!res.ok) throw new Error(res.error)
      setResult(res)
      setActiveTab('cert')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Copy / Save ──────────────────────────────────────────────────────────────
  const copyText = async (text, key) => {
    await navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  const saveFile = async (type) => {
    if (!result || saving) return
    setSaving(type)
    const content = type === 'cert' ? result.cert : result.key
    const cn = (form.commonName || 'cert').replace(/[^a-z0-9.-]/gi, '_')
    const defaultName = type === 'cert' ? `${cn}.crt` : `${cn}.key`
    try {
      const res = await window.electronAPI.saveCertFile({ defaultName, content })
      if (!res.ok && !res.canceled) setError(`Lưu file thất bại: ${res.error}`)
    } finally {
      setSaving(null)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  const fmtDate = (d) => {
    if (!d) return '—'
    try { return new Date(d).toLocaleString('vi-VN') } catch { return d }
  }

  const validityWarning = Number(form.validityDays) > 825
    ? 'Browsers không tin tưởng cert > 825 ngày. Dùng cho internal/k8s thì OK.'
    : null

  return (
    <div className={styles.root}>
      {/* Left: Form */}
      <div className={styles.formPanel}>
        <div className={styles.panelHeader}>
          <ShieldCheck size={15} color="var(--accent-blue)" />
          <span>Generate Self-Signed Certificate</span>
        </div>

        <div className={styles.formBody}>
          {/* Presets */}
          <div className={styles.presetBar}>
            <span className={styles.presetLabel}>Preset:</span>
            {Object.keys(PRESETS).map(name => (
              <button
                key={name}
                className={`${styles.presetBtn} ${activePreset === name ? styles.presetActive : ''}`}
                onClick={() => applyPreset(name)}
              >
                {name}
              </button>
            ))}
          </div>

          {/* Subject */}
          <Section
            title="Subject / DN"
            icon={<Globe size={12} />}
            open={expanded.subject}
            onToggle={() => toggleSection('subject')}
          >
            <div className={styles.fieldGrid}>
              <Field label="COMMON NAME *" span={2}>
                <input className={styles.input} value={form.commonName}
                  onChange={set('commonName')} placeholder="localhost" />
              </Field>
              <Field label="ORGANIZATION">
                <input className={styles.input} value={form.organization}
                  onChange={set('organization')} placeholder="My Org" />
              </Field>
              <Field label="ORG UNIT">
                <input className={styles.input} value={form.organizationalUnit}
                  onChange={set('organizationalUnit')} placeholder="Engineering" />
              </Field>
              <Field label="COUNTRY (2 ký tự)">
                <input className={styles.input} value={form.country}
                  onChange={set('country')} placeholder="VN" maxLength={2} />
              </Field>
              <Field label="STATE / PROVINCE">
                <input className={styles.input} value={form.state}
                  onChange={set('state')} placeholder="Ha Noi" />
              </Field>
              <Field label="LOCALITY / CITY">
                <input className={styles.input} value={form.locality}
                  onChange={set('locality')} placeholder="Ha Noi" />
              </Field>
            </div>
          </Section>

          {/* SAN */}
          <Section
            title="Subject Alternative Names"
            icon={<Server size={12} />}
            open={expanded.san}
            onToggle={() => toggleSection('san')}
            action={
              <button className={styles.addBtn} onClick={addSan}>
                <Plus size={11} /> Add
              </button>
            }
          >
            {form.subjectAltNames.length === 0 && (
              <div className={styles.emptySan}>
                Chưa có SAN — cert sẽ không hợp lệ với modern browsers
              </div>
            )}
            {form.subjectAltNames.map((san, i) => (
              <div key={i} className={styles.sanRow}>
                <select
                  className={styles.sanTypeSelect}
                  value={san.type}
                  onChange={e => updateSan(i, 'type', e.target.value)}
                >
                  <option value="dns">DNS</option>
                  <option value="ip">IP</option>
                  <option value="email">Email</option>
                </select>
                <input
                  className={styles.sanInput}
                  value={san.value}
                  onChange={e => updateSan(i, 'value', e.target.value)}
                  placeholder={san.type === 'ip' ? '192.168.1.1' : san.type === 'email' ? 'user@example.com' : 'example.com'}
                />
                <button className={styles.removeSanBtn} onClick={() => removeSan(i)}>
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </Section>

          {/* Key Usage */}
          <Section
            title="Key Usage & Extended Key Usage"
            icon={<Key size={12} />}
            open={expanded.usage}
            onToggle={() => toggleSection('usage')}
          >
            <div className={styles.usageGrid}>
              <div>
                <div className={styles.usageGroupLabel}>Key Usage</div>
                {KEY_USAGE_OPTIONS.map(({ value, label }) => (
                  <label key={value} className={styles.checkRow}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={form.keyUsage.includes(value)}
                      onChange={() => toggleCheckbox('keyUsage', value)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <div>
                <div className={styles.usageGroupLabel}>Extended Key Usage</div>
                {EXT_KEY_USAGE_OPTIONS.map(({ value, label }) => (
                  <label key={value} className={styles.checkRow}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={form.extKeyUsage.includes(value)}
                      onChange={() => toggleCheckbox('extKeyUsage', value)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </Section>

          {/* Advanced */}
          <Section
            title="Advanced"
            icon={<Lock size={12} />}
            open={expanded.advanced}
            onToggle={() => toggleSection('advanced')}
          >
            <div className={styles.fieldGrid}>
              <Field label="VALIDITY (ngày)">
                <input
                  className={styles.input} type="number"
                  value={form.validityDays}
                  onChange={set('validityDays')}
                  min={1} max={36500}
                />
                {validityWarning && (
                  <div className={styles.fieldHint} style={{ color: 'var(--accent-amber)' }}>
                    ⚠ {validityWarning}
                  </div>
                )}
              </Field>
              <Field label="RSA KEY SIZE">
                <select className={styles.input} value={form.keySize} onChange={set('keySize')}>
                  <option value={2048}>2048 bit (recommended)</option>
                  <option value={4096}>4096 bit (slower)</option>
                </select>
              </Field>
            </div>
          </Section>
        </div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div className={styles.errorBanner}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <AlertCircle size={13} /> {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Generate button */}
        <div className={styles.formFooter}>
          <button className={styles.generateBtn} onClick={handleGenerate} disabled={loading}>
            {loading
              ? <><span className={styles.spinner} /> Generating…</>
              : <><ShieldCheck size={14} /> Generate Certificate</>
            }
          </button>
        </div>
      </div>

      {/* Right: Result */}
      <div className={styles.resultPanel}>
        <div className={styles.panelHeader}>
          <Hash size={15} color="var(--accent-green)" />
          <span>Result</span>
          {result && <span className={styles.okBadge}>✓ Generated</span>}
        </div>

        {!result ? (
          <div className={styles.emptyResult}>
            <ShieldCheck size={36} color="var(--text-muted)" style={{ opacity: 0.3 }} />
            <p>Certificate sẽ hiển thị ở đây</p>
            <p className={styles.emptyHint}>Điền form bên trái và nhấn Generate</p>
          </div>
        ) : (
          <motion.div
            className={styles.resultContent}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
          >
            {/* Meta info */}
            <div className={styles.metaGrid}>
              <MetaRow icon={<Hash size={11} />} label="Serial" value={result.serial} mono />
              <MetaRow icon={<Clock size={11} />} label="Not Before" value={fmtDate(result.notBefore)} />
              <MetaRow icon={<Clock size={11} />} label="Not After" value={fmtDate(result.notAfter)} />
              <MetaRow icon={<Key size={11} />} label="Algorithm" value={`RSA-${form.keySize} / SHA-256`} mono />
              {result.subjectAltName && (
                <MetaRow icon={<Globe size={11} />} label="SAN" value={result.subjectAltName} mono />
              )}
            </div>

            {/* Fingerprint */}
            <div className={styles.fingerprintBox}>
              <div className={styles.fingerprintLabel}>
                SHA-256 Fingerprint
                <button
                  className={styles.copyIconBtn}
                  onClick={() => copyText(result.fingerprint, 'fingerprint')}
                >
                  {copied === 'fingerprint' ? <Check size={11} /> : <Copy size={11} />}
                </button>
              </div>
              <div className={styles.fingerprintValue}>{result.fingerprint}</div>
            </div>

            {/* Tabs: cert / key */}
            <div className={styles.tabBar}>
              {[
                { id: 'cert', label: 'Certificate (.crt)' },
                { id: 'key', label: 'Private Key (.key)' },
              ].map(t => (
                <button
                  key={t.id}
                  className={`${styles.tab} ${activeTab === t.id ? styles.tabActive : ''}`}
                  onClick={() => setActiveTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
              <div className={styles.tabActions}>
                <button
                  className={styles.actionBtn}
                  onClick={() => copyText(activeTab === 'cert' ? result.cert : result.key, activeTab)}
                >
                  {copied === activeTab ? <><Check size={12} /> Đã copy</> : <><Copy size={12} /> Copy</>}
                </button>
                <button
                  className={styles.actionBtn}
                  onClick={() => saveFile(activeTab)}
                  disabled={saving === activeTab}
                >
                  {saving === activeTab
                    ? <><span className={styles.spinnerSm} /> Saving…</>
                    : <><Download size={12} /> Save file</>
                  }
                </button>
              </div>
            </div>

            {/* PEM content */}
            <div className={styles.pemBox}>
              <pre className={styles.pemText}>
                {activeTab === 'cert' ? result.cert : result.key}
              </pre>
            </div>

            {/* Save both */}
            <div className={styles.saveBothRow}>
              <button
                className={styles.saveBothBtn}
                onClick={async () => { await saveFile('cert'); await saveFile('key') }}
                disabled={!!saving}
              >
                <Download size={13} /> Lưu cả 2 file (.crt + .key)
              </button>
              <button
                className={styles.regenerateBtn}
                onClick={() => { setResult(null); setError('') }}
              >
                <RefreshCw size={13} /> Generate lại
              </button>
            </div>

            {/* K8s usage hint */}
            <div className={styles.usageHint}>
              <div className={styles.usageHintTitle}>Sử dụng với Kubernetes</div>
              <pre className={styles.usageHintCode}>{`# Tạo TLS secret
kubectl create secret tls ${(form.commonName || 'tls-cert').replace(/[^a-z0-9-]/gi, '-').toLowerCase()}-tls \\
  --cert=${(form.commonName || 'cert').replace(/[^a-z0-9.-]/gi, '_')}.crt \\
  --key=${(form.commonName || 'cert').replace(/[^a-z0-9.-]/gi, '_')}.key \\
  --namespace=default`}</pre>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Section({ title, icon, open, onToggle, action, children }) {
  return (
    <div className={styles.section}>
      <button className={styles.sectionTrigger} onClick={onToggle}>
        <span className={styles.sectionLeft}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {icon}
          <span className={styles.sectionTitle}>{title}</span>
        </span>
        {action && <span onClick={e => e.stopPropagation()}>{action}</span>}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className={styles.sectionBody}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Field({ label, span, children }) {
  return (
    <div className={styles.field} style={span ? { gridColumn: `span ${span}` } : {}}>
      <label className={styles.fieldLabel}>{label}</label>
      {children}
    </div>
  )
}

function MetaRow({ icon, label, value, mono }) {
  return (
    <div className={styles.metaRow}>
      <span className={styles.metaIcon}>{icon}</span>
      <span className={styles.metaLabel}>{label}</span>
      <span className={`${styles.metaValue} ${mono ? styles.metaMono : ''}`}>{value || '—'}</span>
    </div>
  )
}
