import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  KeyRound, Plus, Trash2, Search, RefreshCw, Eye, EyeOff,
  Copy, Check, AlertCircle, Edit3, X, Save,
  Lock, Unlock, Tag, FileKey, Database, Cloud, FolderOpen,
} from 'lucide-react'
import { useK8sStore } from '../store'
import { useK8sService } from '../hooks/useAuth'
import styles from './SecretPage.module.css'

// ── Secret type metadata ───────────────────────────────────────────────────────
const SECRET_TYPES = {
  'Opaque':                              { icon: Lock,    color: 'var(--accent-blue)',   label: 'Opaque' },
  'kubernetes.io/tls':                   { icon: FileKey,  color: 'var(--accent-green)',  label: 'TLS' },
  'kubernetes.io/dockerconfigjson':      { icon: Cloud,    color: 'var(--accent-cyan)',   label: 'Docker' },
  'kubernetes.io/service-account-token': { icon: Tag,      color: 'var(--accent-purple)', label: 'SA Token' },
  'kubernetes.io/basic-auth':            { icon: Lock,    color: 'var(--accent-amber)',  label: 'Basic Auth' },
  'kubernetes.io/ssh-auth':              { icon: KeyRound, color: 'var(--accent-amber)',  label: 'SSH' },
  'bootstrap.kubernetes.io/token':       { icon: Database, color: 'var(--text-muted)',    label: 'Bootstrap' },
}

const TYPE_OPTIONS = [
  'Opaque',
  'kubernetes.io/tls',
  'kubernetes.io/dockerconfigjson',
  'kubernetes.io/basic-auth',
  'kubernetes.io/ssh-auth',
]

// Keys cho phép chọn file — PEM/text content
const FILE_PICKABLE_KEYS = new Set([
  'tls.crt', 'tls.key', 'ca.crt', 'ca.key',
  'ssh-privatekey', 'ssh-publickey',
  'cert', 'key', 'certificate', 'private-key',
])

// Detect xem key có nên hiện nút chọn file không
// → true nếu là TLS type, hoặc key nằm trong FILE_PICKABLE_KEYS
function isFilePickable(key, secretType) {
  if (secretType === 'kubernetes.io/tls') return true
  if (secretType === 'kubernetes.io/ssh-auth') return true
  return FILE_PICKABLE_KEYS.has(key?.trim().toLowerCase())
}

const TLS_FIELDS      = [{ key: 'tls.crt', hint: 'Certificate PEM' }, { key: 'tls.key', hint: 'Private Key PEM' }]
const BASIC_AUTH_FIELDS = [{ key: 'username', hint: '' }, { key: 'password', hint: '' }]
const SSH_AUTH_FIELDS = [{ key: 'ssh-privatekey', hint: 'PEM private key' }]
const DOCKER_FIELDS   = [{ key: '.dockerconfigjson', hint: 'JSON config' }]

function getPresetFields(type) {
  if (type === 'kubernetes.io/tls') return TLS_FIELDS
  if (type === 'kubernetes.io/basic-auth') return BASIC_AUTH_FIELDS
  if (type === 'kubernetes.io/ssh-auth') return SSH_AUTH_FIELDS
  if (type === 'kubernetes.io/dockerconfigjson') return DOCKER_FIELDS
  return []
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function SecretPage() {
  const getService = useK8sService()
  const { selectedNamespace } = useK8sStore()

  const [secrets, setSecrets] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [drawer, setDrawer] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const fetchSecrets = useCallback(async () => {
    const svc = getService()
    if (!svc) { setError('Chưa kết nối cluster'); return }
    setLoading(true); setError('')
    try { setSecrets(await svc.getSecrets(selectedNamespace)) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [getService, selectedNamespace])

  useEffect(() => { fetchSecrets() }, [fetchSecrets])

  const handleDelete = async (name) => {
    const svc = getService()
    if (!svc) return
    setDeleteLoading(true)
    try {
      await svc.deleteSecret(name, selectedNamespace)
      await fetchSecrets()
      setDeleteTarget(null)
    } catch (e) { setError(e.message) }
    finally { setDeleteLoading(false) }
  }

  const filtered = secrets.filter(s => {
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase())
    const matchType = filterType === 'all' || s.type === filterType
    return matchSearch && matchType
  })

  const typeCounts = secrets.reduce((acc, s) => {
    acc[s.type] = (acc[s.type] || 0) + 1; return acc
  }, {})

  return (
    <div className={styles.root}>
      {/* Header */}
      <div className={styles.pageHeader}>
        <div className={styles.pageTitle}>
          <KeyRound size={16} color="var(--accent-blue)" />
          <span>Secrets</span>
          {secrets.length > 0 && <span className={styles.countBadge}>{secrets.length}</span>}
          <span className={styles.nsBadge}>{selectedNamespace}</span>
        </div>
        <div className={styles.headerActions}>
          <select className={styles.typeFilter} value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="all">All types</option>
            {Object.keys(typeCounts).map(t => (
              <option key={t} value={t}>{SECRET_TYPES[t]?.label || t} ({typeCounts[t]})</option>
            ))}
          </select>
          <div className={styles.searchWrap}>
            <Search size={12} />
            <input className={styles.search} placeholder="Tìm secret..."
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className={styles.iconBtn} onClick={fetchSecrets} disabled={loading} title="Refresh">
            <RefreshCw size={14} className={loading ? styles.spin : ''} />
          </button>
          <button className={styles.primaryBtn} onClick={() => setDrawer({ mode: 'create' })}>
            <Plus size={13} /> Tạo mới
          </button>
        </div>
      </div>

      <AnimatePresence>
        {error && (
          <motion.div className={styles.errorBanner}
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <AlertCircle size={13} /> {error}
          </motion.div>
        )}
      </AnimatePresence>

      <div className={styles.content}>
        {loading && secrets.length === 0 ? (
          <div className={styles.loadingState}>
            <div className={styles.loadingSpinner} />
            <span>Đang tải secrets...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.emptyState}>
            <KeyRound size={32} color="var(--text-muted)" style={{ opacity: 0.3 }} />
            <span>{search ? 'Không tìm thấy secret nào' : `Namespace "${selectedNamespace}" chưa có secret`}</span>
          </div>
        ) : (
          <div className={styles.table}>
            <div className={styles.tableHead}>
              <span style={{ flex: 3 }}>NAME</span>
              <span style={{ flex: 2 }}>TYPE</span>
              <span style={{ flex: 1, textAlign: 'center' }}>KEYS</span>
              <span style={{ flex: 2 }}>CREATED</span>
              <span style={{ width: 80 }}></span>
            </div>
            <AnimatePresence initial={false}>
              {filtered.map((s, i) => (
                <SecretRow key={s.name} secret={s} index={i}
                  onView={() => setDrawer({ mode: 'view', secret: s })}
                  onEdit={() => setDrawer({ mode: 'edit', secret: s })}
                  onDelete={() => setDeleteTarget(s.name)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <AnimatePresence>
        {drawer && (
          <SecretDrawer
            mode={drawer.mode} secret={drawer.secret}
            namespace={selectedNamespace} getService={getService}
            onClose={() => setDrawer(null)}
            onSaved={() => { setDrawer(null); fetchSecrets() }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteTarget && (
          <motion.div className={styles.overlay}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className={styles.dialog}
              initial={{ scale: 0.95, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 8 }}>
              <h3 className={styles.dialogTitle}>Xoá secret?</h3>
              <p className={styles.dialogBody}>
                Secret <code className={styles.nameCode}>{deleteTarget}</code> sẽ bị xoá vĩnh viễn.
                Các Pod đang mount secret này có thể bị ảnh hưởng.
              </p>
              <div className={styles.dialogActions}>
                <button className={styles.cancelBtn} onClick={() => setDeleteTarget(null)}>Huỷ</button>
                <button className={styles.deleteBtn} onClick={() => handleDelete(deleteTarget)} disabled={deleteLoading}>
                  {deleteLoading ? <span className={styles.spinner} /> : 'Xác nhận xoá'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── SecretRow ──────────────────────────────────────────────────────────────────
function SecretRow({ secret, index, onView, onEdit, onDelete }) {
  const typeMeta = SECRET_TYPES[secret.type] || { icon: Lock, color: 'var(--text-muted)', label: secret.type }
  const Icon = typeMeta.icon
  return (
    <motion.div className={styles.tableRow}
      initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index * 0.025, 0.3) }}
      onClick={onView}
    >
      <span style={{ flex: 3 }} className={styles.secretName}>{secret.name}</span>
      <span style={{ flex: 2 }}>
        <span className={styles.typeBadge} style={{ color: typeMeta.color, borderColor: typeMeta.color + '30' }}>
          <Icon size={11} />{typeMeta.label}
        </span>
      </span>
      <span style={{ flex: 1, textAlign: 'center' }}>
        <span className={styles.keyCount}>{secret.dataKeys?.length ?? 0}</span>
      </span>
      <span style={{ flex: 2 }} className={styles.dateCell}>
        {secret.createdAt ? new Date(secret.createdAt).toLocaleString('vi-VN') : '—'}
      </span>
      <span style={{ width: 80 }} className={styles.rowActions}>
        <button className={styles.actionIconBtn} title="Chỉnh sửa"
          onClick={e => { e.stopPropagation(); onEdit() }}><Edit3 size={12} /></button>
        <button className={`${styles.actionIconBtn} ${styles.deleteIconBtn}`} title="Xoá"
          onClick={e => { e.stopPropagation(); onDelete() }}><Trash2 size={12} /></button>
      </span>
    </motion.div>
  )
}

// ── SecretDrawer ───────────────────────────────────────────────────────────────
function SecretDrawer({ mode: initialMode, secret, namespace, getService, onClose, onSaved }) {
  const [mode, setMode] = useState(initialMode)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [name, setName] = useState(secret?.name || '')
  const [type, setType] = useState(secret?.type || 'Opaque')
  const [entries, setEntries] = useState(() => {
    if (!secret?.data) return [{ key: '', value: '', revealed: false, fileName: null }]
    return Object.entries(secret.data).map(([k, v]) => ({
      key: k, value: safeBase64Decode(v), revealed: false, fileName: null,
    }))
  })
  const [labels, setLabels] = useState(
    Object.entries(secret?.metadata?.labels || {})
      .filter(([k]) => !k.startsWith('kubernetes.io'))
      .map(([k, v]) => ({ key: k, value: v }))
  )

  const isView = mode === 'view'
  const isEdit = mode === 'edit'
  const isCreate = mode === 'create'
  const canEdit = isEdit || isCreate

  const handleTypeChange = (newType) => {
    setType(newType)
    const preset = getPresetFields(newType)
    setEntries(
      preset.length > 0
        ? preset.map(f => ({ key: f.key, value: '', revealed: false, fileName: null }))
        : [{ key: '', value: '', revealed: false, fileName: null }]
    )
  }

  const addEntry = () =>
    setEntries(e => [...e, { key: '', value: '', revealed: false, fileName: null }])
  const removeEntry = (i) =>
    setEntries(e => e.filter((_, idx) => idx !== i))
  const updateEntry = (i, field, val) =>
    setEntries(e => e.map((item, idx) => idx === i ? { ...item, [field]: val } : item))
  const toggleReveal = (i) =>
    setEntries(e => e.map((item, idx) => idx === i ? { ...item, revealed: !item.revealed } : item))

  // ── Chọn file ────────────────────────────────────────────────────────────────
  const handlePickFile = async (i, entryKey) => {
    if (!window.electronAPI?.openTextFile) return

    // Gợi ý filter phù hợp với key
    const isCert = entryKey?.includes('.crt') || entryKey?.includes('cert') || entryKey?.includes('ca')
    const isKey  = entryKey?.includes('.key') || entryKey?.includes('key')

    const filters = isCert
      ? [{ name: 'Certificate', extensions: ['crt', 'pem', 'cer', 'ca-bundle'] }, { name: 'All Files', extensions: ['*'] }]
      : isKey
      ? [{ name: 'Private Key', extensions: ['key', 'pem'] }, { name: 'All Files', extensions: ['*'] }]
      : [{ name: 'PEM / Cert / Key', extensions: ['pem', 'crt', 'key', 'cer'] }, { name: 'All Files', extensions: ['*'] }]

    const title = isCert ? 'Chọn Certificate file' : isKey ? 'Chọn Private Key file' : 'Chọn file'

    const result = await window.electronAPI.openTextFile({ title, filters })
    if (!result.ok || result.canceled) return
    if (result.error) { setError(result.error); return }

    setEntries(e => e.map((item, idx) =>
      idx === i ? { ...item, value: result.content, fileName: result.fileName } : item
    ))
  }

  const [copied, setCopied] = useState(null)
  const copyValue = async (val, key) => {
    await navigator.clipboard.writeText(val)
    setCopied(key); setTimeout(() => setCopied(null), 2000)
  }

  const handleSave = async () => {
    if (!name.trim()) { setError('Name không được để trống'); return }
    const svc = getService()
    if (!svc) { setError('Chưa kết nối cluster'); return }

    const validEntries = entries.filter(e => e.key.trim())
    if (validEntries.length === 0) { setError('Cần ít nhất 1 key-value entry'); return }

    const data = {}
    for (const { key, value } of validEntries) {
      data[key.trim()] = btoa(unescape(encodeURIComponent(value)))
    }

    const extraLabels = labels.filter(l => l.key.trim())
      .reduce((acc, l) => ({ ...acc, [l.key]: l.value }), {})

    const manifest = {
      apiVersion: 'v1', kind: 'Secret',
      metadata: {
        name: name.trim(), namespace,
        labels: { 'app.kubernetes.io/managed-by': 'ms-manager', ...extraLabels },
      },
      type, data,
    }

    setSaving(true); setError('')
    try {
      if (isCreate)
        await svc._call(`/api/v1/namespaces/${namespace}/secrets`, 'POST', manifest)
      else
        await svc._call(`/api/v1/namespaces/${namespace}/secrets/${name}`, 'PATCH', manifest,
          { 'Content-Type': 'application/merge-patch+json' })
      onSaved()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const title = isCreate ? 'Tạo Secret mới' : isEdit ? `Chỉnh sửa: ${secret?.name}` : secret?.name

  return (
    <>
      <motion.div className={styles.drawerBackdrop}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.aside className={styles.drawer}
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 36 }}
      >
        {/* Header */}
        <div className={styles.drawerHeader}>
          <div className={styles.drawerHeaderLeft}>
            <KeyRound size={14} color="var(--accent-blue)" />
            <span className={styles.drawerTitle}>{title}</span>
            {isView && (
              <span className={styles.typePill}
                style={{ color: (SECRET_TYPES[type] || {}).color || 'var(--text-muted)' }}>
                {(SECRET_TYPES[type] || {}).label || type}
              </span>
            )}
          </div>
          <div className={styles.drawerHeaderRight}>
            {isView && (
              <button className={styles.editToggleBtn} onClick={() => setMode('edit')}>
                <Edit3 size={13} /> Chỉnh sửa
              </button>
            )}
            {isEdit && (
              <button className={styles.editToggleBtn} onClick={() => setMode('view')}>
                <Unlock size={13} /> View
              </button>
            )}
            <button className={styles.closeDrawerBtn} onClick={onClose}><X size={14} /></button>
          </div>
        </div>

        {/* Body */}
        <div className={styles.drawerBody}>

          {/* Metadata */}
          <div className={styles.drawerSection}>
            <div className={styles.drawerSectionTitle}>METADATA</div>
            <div className={styles.metaGrid}>
              <div className={styles.metaField}>
                <label className={styles.fieldLabel}>NAME</label>
                {canEdit
                  ? <input className={styles.input} value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="my-secret" disabled={isEdit} />
                  : <div className={styles.valueDisplay}>{name}</div>
                }
              </div>
              <div className={styles.metaField}>
                <label className={styles.fieldLabel}>TYPE</label>
                {canEdit
                  ? <select className={styles.input} value={type}
                      onChange={e => handleTypeChange(e.target.value)}>
                      {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  : <div className={styles.valueDisplay}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{type}</div>
                }
              </div>
            </div>
          </div>

          {/* Data entries */}
          <div className={styles.drawerSection}>
            <div className={styles.drawerSectionHeader}>
              <div className={styles.drawerSectionTitle}>DATA</div>
              {canEdit && (
                <button className={styles.addEntryBtn} onClick={addEntry}>
                  <Plus size={11} /> Add key
                </button>
              )}
            </div>

            {entries.length === 0 && (
              <div className={styles.emptyEntries}>Chưa có data</div>
            )}

            {entries.map((entry, i) => {
              const canPickFile = canEdit && isFilePickable(entry.key, type)
              return (
                <div key={i} className={styles.entryRow}>
                  {/* Key */}
                  <div className={styles.entryKeyCol}>
                    {canEdit ? (
                      <input
                        className={`${styles.entryInput} ${styles.entryKey}`}
                        placeholder="key"
                        value={entry.key}
                        onChange={e => updateEntry(i, 'key', e.target.value)}
                      />
                    ) : (
                      <div className={styles.entryKeyDisplay}>{entry.key}</div>
                    )}
                    {/* Hiện nút chọn file bên dưới key input khi edit */}
                    {canPickFile && (
                      <button
                        className={styles.pickFileBtn}
                        onClick={() => handlePickFile(i, entry.key)}
                        title="Chọn từ file"
                      >
                        <FolderOpen size={11} />
                        {entry.fileName
                          ? <span className={styles.pickedFileName}>{entry.fileName}</span>
                          : <span>Chọn file</span>
                        }
                      </button>
                    )}
                  </div>

                  {/* Value */}
                  <div className={styles.entryValueWrap}>
                    {canEdit ? (
                      <textarea
                        className={`${styles.entryInput} ${styles.entryValue}`}
                        placeholder={
                          canPickFile
                            ? 'Paste PEM trực tiếp hoặc dùng "Chọn file" bên trái'
                            : 'value (plain text — sẽ được base64 encode)'
                        }
                        value={entry.value}
                        onChange={e => updateEntry(i, 'value', e.target.value)}
                        rows={entry.value?.includes('\n')
                          ? Math.min(entry.value.split('\n').length + 1, 10)
                          : 2
                        }
                      />
                    ) : (
                      <div className={styles.entryValueDisplay}>
                        {entry.revealed
                          ? <pre className={styles.revealedValue}>{entry.value || '(empty)'}</pre>
                          : <span className={styles.maskedValue}>
                              {'•'.repeat(Math.min(entry.value?.length || 8, 32))}
                            </span>
                        }
                      </div>
                    )}

                    {/* Value actions */}
                    <div className={styles.entryActions}>
                      <button className={styles.entryActionBtn}
                        title={entry.revealed ? 'Ẩn' : 'Hiện'}
                        onClick={() => toggleReveal(i)}>
                        {entry.revealed ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                      <button className={styles.entryActionBtn} title="Copy value"
                        onClick={() => copyValue(entry.value, `${entry.key}-${i}`)}>
                        {copied === `${entry.key}-${i}` ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                      {canEdit && (
                        <button className={`${styles.entryActionBtn} ${styles.removeEntryBtn}`}
                          title="Xoá entry" onClick={() => removeEntry(i)}>
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Labels */}
          {canEdit && (
            <div className={styles.drawerSection}>
              <div className={styles.drawerSectionHeader}>
                <div className={styles.drawerSectionTitle}>LABELS</div>
                <button className={styles.addEntryBtn}
                  onClick={() => setLabels(l => [...l, { key: '', value: '' }])}>
                  <Plus size={11} /> Add
                </button>
              </div>
              {labels.map((l, i) => (
                <div key={i} className={styles.labelRow}>
                  <input className={`${styles.entryInput} ${styles.labelKey}`}
                    placeholder="key" value={l.key}
                    onChange={e => setLabels(ls => ls.map((item, idx) =>
                      idx === i ? { ...item, key: e.target.value } : item))} />
                  <span className={styles.eq}>=</span>
                  <input className={`${styles.entryInput} ${styles.labelVal}`}
                    placeholder="value" value={l.value}
                    onChange={e => setLabels(ls => ls.map((item, idx) =>
                      idx === i ? { ...item, value: e.target.value } : item))} />
                  <button className={`${styles.entryActionBtn} ${styles.removeEntryBtn}`}
                    onClick={() => setLabels(ls => ls.filter((_, idx) => idx !== i))}>
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Info (view only) */}
          {isView && secret && (
            <div className={styles.drawerSection}>
              <div className={styles.drawerSectionTitle}>INFO</div>
              <div className={styles.infoGrid}>
                <InfoRow label="Namespace" value={namespace} />
                <InfoRow label="Created"
                  value={secret.createdAt ? new Date(secret.createdAt).toLocaleString('vi-VN') : '—'} />
                <InfoRow label="Resource version" value={secret.resourceVersion} mono />
                <InfoRow label="UID" value={secret.uid} mono />
              </div>
            </div>
          )}
        </div>

        {/* Footer error */}
        <AnimatePresence>
          {error && (
            <motion.div className={styles.drawerError}
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
              <AlertCircle size={13} /> {error}
            </motion.div>
          )}
        </AnimatePresence>

        {canEdit && (
          <div className={styles.drawerFooter}>
            <button className={styles.cancelFooterBtn} onClick={onClose}>Huỷ</button>
            <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
              {saving
                ? <><span className={styles.spinner} /> Đang lưu...</>
                : <><Save size={13} /> {isCreate ? 'Tạo Secret' : 'Lưu thay đổi'}</>
              }
            </button>
          </div>
        )}
      </motion.aside>
    </>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function InfoRow({ label, value, mono }) {
  return (
    <div className={styles.infoRow}>
      <span className={styles.infoLabel}>{label}</span>
      <span className={`${styles.infoValue} ${mono ? styles.infoMono : ''}`}>{value || '—'}</span>
    </div>
  )
}

function safeBase64Decode(str) {
  if (!str) return ''
  try { return decodeURIComponent(escape(atob(str))) }
  catch { return str }
}
