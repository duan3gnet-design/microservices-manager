import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldCheck, Plus, Trash2, ChevronDown, ChevronRight,
  Download, Copy, Check, RefreshCw, AlertCircle,
  Globe, Server, Hash, Clock, Key, Lock,
  Shield, Award, Layers, FileKey, X,
} from 'lucide-react'
import styles from './CertPage.module.css'

// ── Constants ─────────────────────────────────────────────────────────────────
const KEY_USAGE_OPTIONS = [
  { value: 'digitalSignature',  label: 'Digital Signature' },
  { value: 'keyEncipherment',   label: 'Key Encipherment' },
  { value: 'contentCommitment', label: 'Content Commitment' },
  { value: 'dataEncipherment',  label: 'Data Encipherment' },
  { value: 'keyAgreement',      label: 'Key Agreement' },
  { value: 'cRLSign',           label: 'CRL Sign' },
]
const EXT_KEY_USAGE_OPTIONS = [
  { value: 'serverAuth',        label: 'Server Authentication (TLS)' },
  { value: 'clientAuth',        label: 'Client Authentication (mTLS)' },
  { value: 'codeSigning',       label: 'Code Signing' },
  { value: 'emailProtection',   label: 'Email Protection (S/MIME)' },
]

const LEAF_PRESETS = {
  'K8s API Server': {
    commonName: 'kubernetes', organization: 'Kubernetes',
    subjectAltNames: [
      { type: 'dns', value: 'kubernetes' },
      { type: 'dns', value: 'kubernetes.default' },
      { type: 'dns', value: 'kubernetes.default.svc' },
      { type: 'dns', value: 'kubernetes.default.svc.cluster.local' },
      { type: 'ip',  value: '10.96.0.1' },
      { type: 'ip',  value: '127.0.0.1' },
    ],
    keyUsage: ['digitalSignature', 'keyEncipherment'],
    extKeyUsage: ['serverAuth'], validityDays: 3650, keySize: 2048,
  },
  'OIDC / auth-service': {
    commonName: 'auth-service', organization: 'RBAC Gateway',
    subjectAltNames: [
      { type: 'dns', value: 'auth-service' },
      { type: 'dns', value: 'auth-service.default.svc.cluster.local' },
      { type: 'ip',  value: '127.0.0.1' },
    ],
    keyUsage: ['digitalSignature', 'keyEncipherment'],
    extKeyUsage: ['serverAuth'], validityDays: 365, keySize: 2048,
  },
  'mTLS Client': {
    commonName: 'client', organization: '',
    subjectAltNames: [],
    keyUsage: ['digitalSignature'], extKeyUsage: ['clientAuth'],
    validityDays: 365, keySize: 2048,
  },
  'Localhost Dev': {
    commonName: 'localhost', organization: 'Dev',
    subjectAltNames: [
      { type: 'dns', value: 'localhost' },
      { type: 'dns', value: '*.localhost' },
      { type: 'ip',  value: '127.0.0.1' },
    ],
    keyUsage: ['digitalSignature', 'keyEncipherment'],
    extKeyUsage: ['serverAuth'], validityDays: 825, keySize: 2048,
  },
}

const DEFAULT_CA_FORM = {
  commonName: 'My Root CA', organization: '', organizationalUnit: '',
  country: 'VN', state: '', locality: '',
  validityDays: 3650, keySize: 4096,
}

const DEFAULT_LEAF_FORM = {
  commonName: 'localhost', organization: '', organizationalUnit: '',
  country: 'VN', state: '', locality: '',
  validityDays: 365, keySize: 2048,
  subjectAltNames: [
    { type: 'dns', value: 'localhost' },
    { type: 'ip',  value: '127.0.0.1' },
  ],
  keyUsage: ['digitalSignature', 'keyEncipherment'],
  extKeyUsage: ['serverAuth'],
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function CertPage() {
  // mode: 'self-signed' | 'root-ca' | 'leaf'
  const [mode, setMode] = useState('root-ca')

  // CA store: [{ id, label, cert, key, fingerprint, notAfter }]
  const [caStore, setCaStore] = useState([])
  const [selectedCaId, setSelectedCaId] = useState(null)

  const [caForm,   setCaForm]   = useState(DEFAULT_CA_FORM)
  const [leafForm, setLeafForm] = useState(DEFAULT_LEAF_FORM)
  const [ssForm,   setSsForm]   = useState(DEFAULT_LEAF_FORM)

  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [result,   setResult]   = useState(null)
  const [activePreset, setActivePreset] = useState(null)
  const [activeTab,    setActiveTab]    = useState('cert')
  const [copied,   setCopied]   = useState(null)
  const [saving,   setSaving]   = useState(null)
  const [expanded, setExpanded] = useState({ subject: true, san: true, usage: false, advanced: false })

  // ── Helpers ────────────────────────────────────────────────────────────────
  const toggleSection = k => setExpanded(s => ({ ...s, [k]: !s[k] }))

  const formSetters = {
    'root-ca':     (k) => (e) => setCaForm(f   => ({ ...f, [k]: e.target.value })),
    'leaf':        (k) => (e) => setLeafForm(f => ({ ...f, [k]: e.target.value })),
    'self-signed': (k) => (e) => setSsForm(f   => ({ ...f, [k]: e.target.value })),
  }
  const set = formSetters[mode]

  const form = mode === 'root-ca' ? caForm : mode === 'leaf' ? leafForm : ssForm

  const toggleCheckbox = (field, value) => {
    const setter = mode === 'root-ca' ? setCaForm : mode === 'leaf' ? setLeafForm : setSsForm
    setter(f => ({
      ...f,
      [field]: f[field]?.includes(value) ? f[field].filter(v => v !== value) : [...(f[field] || []), value],
    }))
  }

  const addSan = () => {
    const setter = mode === 'leaf' ? setLeafForm : setSsForm
    setter(f => ({ ...f, subjectAltNames: [...(f.subjectAltNames || []), { type: 'dns', value: '' }] }))
  }
  const removeSan = i => {
    const setter = mode === 'leaf' ? setLeafForm : setSsForm
    setter(f => ({ ...f, subjectAltNames: f.subjectAltNames.filter((_, idx) => idx !== i) }))
  }
  const updateSan = (i, field, val) => {
    const setter = mode === 'leaf' ? setLeafForm : setSsForm
    setter(f => ({ ...f, subjectAltNames: f.subjectAltNames.map((s, idx) => idx === i ? { ...s, [field]: val } : s) }))
  }

  const applyPreset = name => {
    const p = LEAF_PRESETS[name]
    const setter = mode === 'leaf' ? setLeafForm : setSsForm
    setter(f => ({ ...DEFAULT_LEAF_FORM, ...f, ...p }))
    setActivePreset(name); setResult(null); setError('')
  }

  // ── Generate ────────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!window.electronAPI) { setError('Chỉ chạy trong Electron app'); return }
    if (!form.commonName?.trim()) { setError('Common Name không được để trống'); return }

    if (mode === 'leaf') {
      const ca = caStore.find(c => c.id === selectedCaId)
      if (!ca) { setError('Chọn Root CA để ký leaf certificate'); return }
    }

    setLoading(true); setError(''); setResult(null)

    try {
      let res
      if (mode === 'root-ca') {
        res = await window.electronAPI.generateCA({
          ...caForm, validityDays: Number(caForm.validityDays), keySize: Number(caForm.keySize),
        })
        if (!res.ok) throw new Error(res.error)
        // Lưu CA vào store
        const newCa = {
          id: Date.now().toString(),
          label: caForm.commonName,
          cert: res.cert,
          key: res.key,
          fingerprint: res.fingerprint,
          notAfter: res.notAfter,
          serial: res.serial,
        }
        setCaStore(s => [...s, newCa])
        setSelectedCaId(newCa.id)
        setMode('leaf')   // Tự switch sang leaf sau khi tạo CA
      } else if (mode === 'leaf') {
        const ca = caStore.find(c => c.id === selectedCaId)
        res = await window.electronAPI.signLeaf({
          ...leafForm, validityDays: Number(leafForm.validityDays), keySize: Number(leafForm.keySize),
          caCert: ca.cert, caKey: ca.key,
        })
        if (!res.ok) throw new Error(res.error)
      } else {
        res = await window.electronAPI.generateCert({
          ...ssForm, validityDays: Number(ssForm.validityDays), keySize: Number(ssForm.keySize),
        })
        if (!res.ok) throw new Error(res.error)
      }
      setResult(res)
      setActiveTab('cert')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Copy / Save ────────────────────────────────────────────────────────────
  const copyText = async (text, key) => {
    await navigator.clipboard.writeText(text)
    setCopied(key); setTimeout(() => setCopied(null), 2000)
  }

  const saveFile = async (type) => {
    if (!result || saving) return
    setSaving(type)
    const content = type === 'chain' ? result.chain
                  : type === 'cert'  ? result.cert
                  : result.key
    const cn = (form.commonName || 'cert').replace(/[^a-z0-9.-]/gi, '_')
    const defaultName = type === 'key' ? `${cn}.key` : type === 'chain' ? `${cn}-chain.pem` : `${cn}.crt`
    try {
      const res = await window.electronAPI.saveCertFile({ defaultName, content })
      if (!res.ok && !res.canceled) setError(`Lưu file thất bại: ${res.error}`)
    } finally { setSaving(null) }
  }

  const fmtDate = d => { try { return new Date(d).toLocaleString('vi-VN') } catch { return d || '—' } }
  const selectedCa = caStore.find(c => c.id === selectedCaId)
  const validityWarning = Number(form.validityDays) > 825 && mode !== 'root-ca'
    ? 'Browsers không tin tưởng cert > 825 ngày.'
    : null

  // Tab list cho result panel
  const resultTabs = [
    { id: 'cert',  label: 'Certificate' },
    { id: 'key',   label: 'Private Key' },
    ...(result?.chain ? [{ id: 'chain', label: 'Chain (cert+CA)' }] : []),
  ]

  return (
    <div className={styles.root}>

      {/* ── Col 1: CA Store ─────────────────────────────────────────────── */}
      <div className={styles.caStorePanel}>
        <div className={styles.panelHeader}>
          <Award size={14} color="var(--accent-purple)" />
          <span>CA Store</span>
          <span className={styles.caCount}>{caStore.length}</span>
        </div>

        <div className={styles.caStoreBody}>
          {caStore.length === 0 ? (
            <div className={styles.caStoreEmpty}>
              <Shield size={24} color="var(--text-muted)" style={{ opacity: 0.3 }} />
              <p>Chưa có Root CA</p>
              <p className={styles.caStoreHint}>Tạo Root CA để ký leaf certificates</p>
            </div>
          ) : (
            caStore.map(ca => (
              <div
                key={ca.id}
                className={`${styles.caCard} ${selectedCaId === ca.id ? styles.caCardSelected : ''}`}
                onClick={() => { setSelectedCaId(ca.id); setMode('leaf') }}
              >
                <div className={styles.caCardHeader}>
                  <Award size={12} color="var(--accent-purple)" />
                  <span className={styles.caCardLabel}>{ca.label}</span>
                  <button
                    className={styles.caDeleteBtn}
                    title="Xoá CA"
                    onClick={e => {
                      e.stopPropagation()
                      setCaStore(s => s.filter(c => c.id !== ca.id))
                      if (selectedCaId === ca.id) setSelectedCaId(null)
                    }}
                  >
                    <X size={10} />
                  </button>
                </div>
                <div className={styles.caCardFp}>
                  {ca.fingerprint?.slice(0, 23)}…
                </div>
                <div className={styles.caCardExpiry}>
                  Hết hạn: {fmtDate(ca.notAfter)}
                </div>
                <div className={styles.caCardActions}>
                  <button className={styles.caActionBtn}
                    onClick={e => { e.stopPropagation(); copyText(ca.cert, `ca-cert-${ca.id}`) }}
                    title="Copy cert">
                    {copied === `ca-cert-${ca.id}` ? <Check size={10} /> : <Copy size={10} />}
                    cert
                  </button>
                  <button className={styles.caActionBtn}
                    onClick={e => { e.stopPropagation(); copyText(ca.key, `ca-key-${ca.id}`) }}
                    title="Copy key">
                    {copied === `ca-key-${ca.id}` ? <Check size={10} /> : <Copy size={10} />}
                    key
                  </button>
                  <button className={styles.caActionBtn}
                    onClick={e => {
                      e.stopPropagation()
                      window.electronAPI?.saveCertFile({ defaultName: `${ca.label.replace(/\s+/g, '_')}-ca.crt`, content: ca.cert })
                    }}
                    title="Save cert">
                    <Download size={10} /> .crt
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Nút tạo Root CA mới */}
        <div className={styles.caStoreFooter}>
          <button
            className={`${styles.modeTabBtn} ${mode === 'root-ca' ? styles.modeTabActive : ''}`}
            onClick={() => { setMode('root-ca'); setResult(null); setError('') }}
          >
            <Plus size={12} /> New Root CA
          </button>
        </div>
      </div>

      {/* ── Col 2: Form ─────────────────────────────────────────────────── */}
      <div className={styles.formPanel}>

        {/* Mode tabs */}
        <div className={styles.modeTabs}>
          {[
            { id: 'root-ca',     label: 'Root CA',          icon: Award },
            { id: 'leaf',        label: 'Leaf Certificate',  icon: FileKey },
            { id: 'self-signed', label: 'Self-Signed',       icon: ShieldCheck },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`${styles.modeTab} ${mode === id ? styles.modeTabSelected : ''}`}
              onClick={() => { setMode(id); setResult(null); setError('') }}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>

        <div className={styles.formBody}>
          {/* CA selector — chỉ hiện khi mode = leaf */}
          {mode === 'leaf' && (
            <div className={styles.caSelectorBox}>
              <div className={styles.caSelectorLabel}>
                <Award size={12} color="var(--accent-purple)" />
                <span>Signing CA</span>
              </div>
              {caStore.length === 0 ? (
                <div className={styles.caSelectorEmpty}>
                  Chưa có CA — tạo Root CA trước
                </div>
              ) : (
                <select
                  className={styles.caSelect}
                  value={selectedCaId || ''}
                  onChange={e => setSelectedCaId(e.target.value)}
                >
                  <option value="">-- Chọn Root CA --</option>
                  {caStore.map(ca => (
                    <option key={ca.id} value={ca.id}>{ca.label}</option>
                  ))}
                </select>
              )}
              {selectedCa && (
                <div className={styles.caSelectedInfo}>
                  <span className={styles.caSelectedFp}>{selectedCa.fingerprint?.slice(0, 32)}…</span>
                </div>
              )}
            </div>
          )}

          {/* Presets — chỉ khi leaf / self-signed */}
          {mode !== 'root-ca' && (
            <div className={styles.presetBar}>
              <span className={styles.presetLabel}>Preset:</span>
              {Object.keys(LEAF_PRESETS).map(name => (
                <button
                  key={name}
                  className={`${styles.presetBtn} ${activePreset === name ? styles.presetActive : ''}`}
                  onClick={() => applyPreset(name)}
                >{name}</button>
              ))}
            </div>
          )}

          {/* Subject */}
          <Section title="Subject / DN" icon={<Globe size={12} />}
            open={expanded.subject} onToggle={() => toggleSection('subject')}>
            <div className={styles.fieldGrid}>
              <Field label="COMMON NAME *" span={2}>
                <input className={styles.input} value={form.commonName || ''}
                  onChange={set('commonName')} placeholder={mode === 'root-ca' ? 'My Root CA' : 'localhost'} />
              </Field>
              <Field label="ORGANIZATION">
                <input className={styles.input} value={form.organization || ''}
                  onChange={set('organization')} placeholder="My Org" />
              </Field>
              <Field label="ORG UNIT">
                <input className={styles.input} value={form.organizationalUnit || ''}
                  onChange={set('organizationalUnit')} placeholder="Engineering" />
              </Field>
              <Field label="COUNTRY">
                <input className={styles.input} value={form.country || ''}
                  onChange={set('country')} placeholder="VN" maxLength={2} />
              </Field>
              <Field label="STATE">
                <input className={styles.input} value={form.state || ''}
                  onChange={set('state')} placeholder="Ha Noi" />
              </Field>
              <Field label="LOCALITY">
                <input className={styles.input} value={form.locality || ''}
                  onChange={set('locality')} placeholder="Ha Noi" />
              </Field>
            </div>
          </Section>

          {/* SAN — ẩn cho Root CA */}
          {mode !== 'root-ca' && (
            <Section title="Subject Alternative Names" icon={<Server size={12} />}
              open={expanded.san} onToggle={() => toggleSection('san')}
              action={<button className={styles.addBtn} onClick={addSan}><Plus size={11} /> Add</button>}
            >
              {(form.subjectAltNames || []).length === 0 && (
                <div className={styles.emptySan}>Chưa có SAN — cert sẽ không hợp lệ với modern browsers</div>
              )}
              {(form.subjectAltNames || []).map((san, i) => (
                <div key={i} className={styles.sanRow}>
                  <select className={styles.sanTypeSelect} value={san.type}
                    onChange={e => updateSan(i, 'type', e.target.value)}>
                    <option value="dns">DNS</option>
                    <option value="ip">IP</option>
                    <option value="email">Email</option>
                  </select>
                  <input className={styles.sanInput} value={san.value}
                    onChange={e => updateSan(i, 'value', e.target.value)}
                    placeholder={san.type === 'ip' ? '192.168.1.1' : 'example.com'} />
                  <button className={styles.removeSanBtn} onClick={() => removeSan(i)}>
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </Section>
          )}

          {/* Key Usage — ẩn cho Root CA (fixed) */}
          {mode !== 'root-ca' && (
            <Section title="Key Usage & Extended Key Usage" icon={<Key size={12} />}
              open={expanded.usage} onToggle={() => toggleSection('usage')}>
              <div className={styles.usageGrid}>
                <div>
                  <div className={styles.usageGroupLabel}>Key Usage</div>
                  {KEY_USAGE_OPTIONS.map(({ value, label }) => (
                    <label key={value} className={styles.checkRow}>
                      <input type="checkbox" className={styles.checkbox}
                        checked={(form.keyUsage || []).includes(value)}
                        onChange={() => toggleCheckbox('keyUsage', value)} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <div>
                  <div className={styles.usageGroupLabel}>Extended Key Usage</div>
                  {EXT_KEY_USAGE_OPTIONS.map(({ value, label }) => (
                    <label key={value} className={styles.checkRow}>
                      <input type="checkbox" className={styles.checkbox}
                        checked={(form.extKeyUsage || []).includes(value)}
                        onChange={() => toggleCheckbox('extKeyUsage', value)} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </Section>
          )}

          {/* Advanced */}
          <Section title="Advanced" icon={<Lock size={12} />}
            open={expanded.advanced} onToggle={() => toggleSection('advanced')}>
            <div className={styles.fieldGrid}>
              <Field label="VALIDITY (ngày)">
                <input className={styles.input} type="number"
                  value={form.validityDays} onChange={set('validityDays')} min={1} max={36500} />
                {validityWarning && (
                  <div className={styles.fieldHint} style={{ color: 'var(--accent-amber)' }}>
                    ⚠ {validityWarning}
                  </div>
                )}
              </Field>
              <Field label="RSA KEY SIZE">
                <select className={styles.input} value={form.keySize} onChange={set('keySize')}>
                  <option value={2048}>2048 bit</option>
                  <option value={4096}>4096 bit {mode === 'root-ca' ? '(recommended for CA)' : '(slower)'}</option>
                </select>
              </Field>
            </div>
          </Section>
        </div>

        <AnimatePresence>
          {error && (
            <motion.div className={styles.errorBanner}
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
              <AlertCircle size={13} /> {error}
            </motion.div>
          )}
        </AnimatePresence>

        <div className={styles.formFooter}>
          <button className={`${styles.generateBtn} ${mode === 'root-ca' ? styles.generateBtnCA : ''}`}
            onClick={handleGenerate} disabled={loading}>
            {loading
              ? <><span className={styles.spinner} /> Generating…</>
              : mode === 'root-ca'
              ? <><Award size={14} /> Generate Root CA</>
              : mode === 'leaf'
              ? <><FileKey size={14} /> Sign Leaf Certificate</>
              : <><ShieldCheck size={14} /> Generate Certificate</>
            }
          </button>
        </div>
      </div>

      {/* ── Col 3: Result ───────────────────────────────────────────────── */}
      <div className={styles.resultPanel}>
        <div className={styles.panelHeader}>
          <Hash size={14} color="var(--accent-green)" />
          <span>Result</span>
          {result && (
            <span className={styles.okBadge}>
              {mode === 'root-ca' ? '✓ Root CA' : mode === 'leaf' ? '✓ Leaf Cert' : '✓ Self-Signed'}
            </span>
          )}
        </div>

        {!result ? (
          <div className={styles.emptyResult}>
            <ShieldCheck size={36} color="var(--text-muted)" style={{ opacity: 0.2 }} />
            <p>Certificate sẽ hiển thị ở đây</p>
            {mode === 'leaf' && !selectedCa && (
              <p className={styles.emptyHint} style={{ color: 'var(--accent-amber)' }}>
                ⚠ Chọn Root CA từ CA Store trước
              </p>
            )}
          </div>
        ) : (
          <motion.div className={styles.resultContent}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>

            {/* Chain badge nếu là leaf */}
            {result.chain && (
              <div className={styles.chainBadge}>
                <Layers size={12} /> Signed by <strong>{selectedCa?.label}</strong>
              </div>
            )}

            {/* Meta */}
            <div className={styles.metaGrid}>
              <MetaRow icon={<Hash size={11} />}  label="Serial"     value={result.serial} mono />
              <MetaRow icon={<Clock size={11} />} label="Not Before" value={fmtDate(result.notBefore)} />
              <MetaRow icon={<Clock size={11} />} label="Not After"  value={fmtDate(result.notAfter)} />
              <MetaRow icon={<Key size={11} />}   label="Algorithm"  value={`RSA-${form.keySize} / SHA-256`} mono />
              {result.issuer && result.issuer !== result.subject && (
                <MetaRow icon={<Award size={11} />} label="Issuer" value={result.issuer} mono />
              )}
              {result.subjectAltName && (
                <MetaRow icon={<Globe size={11} />} label="SAN" value={result.subjectAltName} mono />
              )}
            </div>

            {/* Fingerprint */}
            <div className={styles.fingerprintBox}>
              <div className={styles.fingerprintLabel}>
                SHA-256 Fingerprint
                <button className={styles.copyIconBtn}
                  onClick={() => copyText(result.fingerprint, 'fp')}>
                  {copied === 'fp' ? <Check size={11} /> : <Copy size={11} />}
                </button>
              </div>
              <div className={styles.fingerprintValue}>{result.fingerprint}</div>
            </div>

            {/* PEM tabs */}
            <div className={styles.tabBar}>
              {resultTabs.map(t => (
                <button key={t.id}
                  className={`${styles.tab} ${activeTab === t.id ? styles.tabActive : ''}`}
                  onClick={() => setActiveTab(t.id)}>
                  {t.label}
                </button>
              ))}
              <div className={styles.tabActions}>
                <button className={styles.actionBtn}
                  onClick={() => copyText(
                    activeTab === 'key' ? result.key : activeTab === 'chain' ? result.chain : result.cert,
                    activeTab
                  )}>
                  {copied === activeTab ? <><Check size={12} /> Đã copy</> : <><Copy size={12} /> Copy</>}
                </button>
                <button className={styles.actionBtn}
                  onClick={() => saveFile(activeTab)} disabled={saving === activeTab}>
                  {saving === activeTab
                    ? <><span className={styles.spinnerSm} /> Saving…</>
                    : <><Download size={12} /> Save</>
                  }
                </button>
              </div>
            </div>

            <div className={styles.pemBox}>
              <pre className={styles.pemText}>
                {activeTab === 'key'   ? result.key
                 : activeTab === 'chain' ? result.chain
                 : result.cert}
              </pre>
            </div>

            {/* Save all */}
            <div className={styles.saveBothRow}>
              <button className={styles.saveBothBtn}
                onClick={async () => {
                  await saveFile('cert')
                  await saveFile('key')
                  if (result.chain) await saveFile('chain')
                }}
                disabled={!!saving}>
                <Download size={13} /> Lưu tất cả file
              </button>
              <button className={styles.regenerateBtn}
                onClick={() => { setResult(null); setError('') }}>
                <RefreshCw size={13} /> Reset
              </button>
            </div>

            {/* K8s hint */}
            <div className={styles.usageHint}>
              <div className={styles.usageHintTitle}>kubectl — tạo TLS Secret</div>
              <pre className={styles.usageHintCode}>{(() => {
                const cn = (form.commonName || 'cert').replace(/[^a-z0-9.-]/gi, '_')
                const certFile = result.chain ? `${cn}-chain.pem` : `${cn}.crt`
                return `kubectl create secret tls ${cn.toLowerCase().replace(/_/g, '-')}-tls \\
  --cert=${certFile} \\
  --key=${cn}.key`
              })()}</pre>
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
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className={styles.sectionBody}>
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
