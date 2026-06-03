import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Network, Plus, Trash2, Search, RefreshCw, AlertCircle,
  Edit3, X, Save, ArrowDownToLine, ArrowUpFromLine, ChevronDown,
  ChevronRight, ShieldOff, Tag, Copy, Check, Eye,
} from 'lucide-react'
import { useK8sStore } from '@/store'
import { useK8sService } from '@/hooks/useAuth'
import styles from './NetworkPolicyPage.module.css'

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Render selector object thành string ngắn gọn */
function selectorToString(sel) {
  if (!sel || Object.keys(sel).length === 0) return 'All Pods'
  const ml = sel.matchLabels || {}
  const me = sel.matchExpressions || []
  const parts = [
    ...Object.entries(ml).map(([k, v]) => `${k}=${v}`),
    ...me.map(e => `${e.key} ${e.operator} [${(e.values || []).join(',')}]`),
  ]
  return parts.join(', ') || 'All Pods'
}

/** Tóm tắt 1 rule (ingress hoặc egress) */
function ruleSummary(rule) {
  const peers = (rule.from || rule.to || [])
  const ports = (rule.ports || [])
  const peerStr = peers.length === 0 ? 'All sources'
    : peers.map(p => {
        if (p.podSelector)       return `pod:${selectorToString(p.podSelector)}`
        if (p.namespaceSelector) return `ns:${selectorToString(p.namespaceSelector)}`
        if (p.ipBlock)           return `ip:${p.ipBlock.cidr}`
        return '?'
      }).join(' | ')
  const portStr = ports.length === 0 ? 'All ports'
    : ports.map(p => `${p.protocol || 'TCP'}/${p.port || '*'}`).join(', ')
  return { peerStr, portStr }
}

// ── Default form ───────────────────────────────────────────────────────────────

const emptyRule = (dir) => ({
  id: Date.now() + Math.random(),
  peers: [],      // [{ type:'pod'|'ns'|'ip', key, value, cidr, except }]
  ports: [],      // [{ protocol:'TCP'|'UDP'|'SCTP', port }]
  _dir: dir,
})

const DEFAULT_FORM = {
  name: '',
  podSelectorLabels: [],   // [{ key, value }]
  enableIngress: true,
  enableEgress: false,
  denyAllIngress: false,
  denyAllEgress: false,
  ingressRules: [],
  egressRules: [],
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function NetworkPolicyPage() {
  const getService  = useK8sService()
  const { selectedNamespace } = useK8sStore()

  const [policies,  setPolicies]  = useState([])
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [search,    setSearch]    = useState('')

  // drawer: null | { mode:'create'|'edit'|'view', policy? }
  const [drawer,      setDrawer]      = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetchPolicies = useCallback(async () => {
    const svc = getService()
    if (!svc) { setError('Chưa kết nối cluster'); return }
    setLoading(true); setError('')
    try { setPolicies(await svc.getNetworkPolicies(selectedNamespace)) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [getService, selectedNamespace])

  useEffect(() => { fetchPolicies() }, [fetchPolicies])

  // ── Delete ───────────────────────────────────────────────────────────────
  const handleDelete = async (name) => {
    const svc = getService()
    if (!svc) return
    setDeleteLoading(true)
    try {
      await svc.deleteNetworkPolicy(name, selectedNamespace)
      await fetchPolicies()
      setDeleteTarget(null)
    } catch (e) { setError(e.message) }
    finally { setDeleteLoading(false) }
  }

  const filtered = policies.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className={styles.root}>

      {/* Header */}
      <div className={styles.pageHeader}>
        <div className={styles.pageTitle}>
          <Network size={16} color="var(--accent-blue)" />
          <span>Network Policies</span>
          {policies.length > 0 && <span className={styles.countBadge}>{policies.length}</span>}
          <span className={styles.nsBadge}>{selectedNamespace}</span>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.searchWrap}>
            <Search size={12} />
            <input className={styles.search} placeholder="Tìm policy..."
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className={styles.iconBtn} onClick={fetchPolicies} disabled={loading} title="Refresh">
            <RefreshCw size={14} className={loading ? styles.spin : ''} />
          </button>
          <button className={styles.primaryBtn} onClick={() => setDrawer({ mode: 'create' })}>
            <Plus size={13} /> Tạo mới
          </button>
        </div>
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div className={styles.errorBanner}
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <AlertCircle size={13} /> {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      <div className={styles.content}>
        {loading && policies.length === 0 ? (
          <div className={styles.loadingState}>
            <div className={styles.loadingSpinner} />
            <span>Đang tải network policies...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.emptyState}>
            <Network size={32} color="var(--text-muted)" style={{ opacity: 0.3 }} />
            <span>{search ? 'Không tìm thấy policy nào' : `Namespace "${selectedNamespace}" chưa có NetworkPolicy`}</span>
            <span className={styles.emptyHint}>Tất cả traffic được cho phép khi không có policy</span>
          </div>
        ) : (
          <div className={styles.policyGrid}>
            <AnimatePresence initial={false}>
              {filtered.map((p, i) => (
                <PolicyCard key={p.name} policy={p} index={i}
                  onView={() => setDrawer({ mode: 'view', policy: p })}
                  onEdit={() => setDrawer({ mode: 'edit', policy: p })}
                  onDelete={() => setDeleteTarget(p.name)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Drawer */}
      <AnimatePresence>
        {drawer && (
          <PolicyDrawer
            mode={drawer.mode}
            policy={drawer.policy}
            namespace={selectedNamespace}
            getService={getService}
            onClose={() => setDrawer(null)}
            onSaved={() => { setDrawer(null); fetchPolicies() }}
          />
        )}
      </AnimatePresence>

      {/* Delete confirm */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div className={styles.overlay}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className={styles.dialog}
              initial={{ scale: 0.95, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 8 }}>
              <h3 className={styles.dialogTitle}>Xoá NetworkPolicy?</h3>
              <p className={styles.dialogBody}>
                Policy <code className={styles.nameCode}>{deleteTarget}</code> sẽ bị xoá.
                Traffic giữa các pods có thể thay đổi ngay lập tức.
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

// ── PolicyCard ─────────────────────────────────────────────────────────────────

function PolicyCard({ policy, index, onView, onEdit, onDelete }) {
  return (
    <motion.div className={styles.policyCard}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.3) }}
      onClick={onView}
    >
      {/* Card header */}
      <div className={styles.cardHeader}>
        <div className={styles.cardTitleRow}>
          <Network size={13} color="var(--accent-blue)" />
          <span className={styles.cardName}>{policy.name}</span>
        </div>
        <div className={styles.cardActions}>
          <button className={styles.cardActionBtn} title="Chỉnh sửa"
            onClick={e => { e.stopPropagation(); onEdit() }}><Edit3 size={12} /></button>
          <button className={`${styles.cardActionBtn} ${styles.cardDeleteBtn}`} title="Xoá"
            onClick={e => { e.stopPropagation(); onDelete() }}><Trash2 size={12} /></button>
        </div>
      </div>

      {/* Pod selector */}
      <div className={styles.cardSelector}>
        <Tag size={10} color="var(--text-muted)" />
        <span className={styles.cardSelectorText}>
          {selectorToString(policy.podSelector)}
        </span>
      </div>

      {/* Policy type badges */}
      <div className={styles.cardBadges}>
        {policy.hasIngress && (
          <span className={`${styles.typeBadge} ${policy.isDenyAllIngress ? styles.denyBadge : styles.ingressBadge}`}>
            <ArrowDownToLine size={10} />
            {policy.isDenyAllIngress ? 'Deny All Ingress' : `Ingress (${policy.ingressCount} rules)`}
          </span>
        )}
        {policy.hasEgress && (
          <span className={`${styles.typeBadge} ${policy.isDenyAllEgress ? styles.denyBadge : styles.egressBadge}`}>
            <ArrowUpFromLine size={10} />
            {policy.isDenyAllEgress ? 'Deny All Egress' : `Egress (${policy.egressCount} rules)`}
          </span>
        )}
        {!policy.hasIngress && !policy.hasEgress && (
          <span className={styles.typeBadge} style={{ color: 'var(--text-muted)', borderColor: 'var(--border-dim)' }}>
            No policy types
          </span>
        )}
      </div>

      {/* Rules preview */}
      {(policy.ingressCount > 0 || policy.egressCount > 0) && (
        <div className={styles.cardRulesPreview}>
          {[...policy.ingress.slice(0, 2).map(r => ({ ...r, _dir: 'ingress' })),
             ...policy.egress.slice(0, 2).map(r => ({ ...r, _dir: 'egress' }))
          ].slice(0, 3).map((rule, i) => {
            const { peerStr, portStr } = ruleSummary(rule)
            return (
              <div key={i} className={styles.rulePreviewRow}>
                <span className={`${styles.ruleDir} ${rule._dir === 'ingress' ? styles.ruleDirIn : styles.ruleDirOut}`}>
                  {rule._dir === 'ingress' ? '↓' : '↑'}
                </span>
                <span className={styles.rulePeer}>{peerStr}</span>
                <span className={styles.rulePort}>{portStr}</span>
              </div>
            )
          })}
          {policy.ingressCount + policy.egressCount > 3 && (
            <div className={styles.ruleMore}>+{policy.ingressCount + policy.egressCount - 3} more rules</div>
          )}
        </div>
      )}

      <div className={styles.cardFooter}>
        {policy.createdAt ? new Date(policy.createdAt).toLocaleString('vi-VN') : '—'}
      </div>
    </motion.div>
  )
}

// ── PolicyDrawer ───────────────────────────────────────────────────────────────

function PolicyDrawer({ mode: initMode, policy, namespace, getService, onClose, onSaved }) {
  const [mode, setMode]   = useState(initMode)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [copied, setCopied] = useState(false)
  const [podLabels, setPodLabels] = useState({})  // { key: [values] }
  const [activeTab, setActiveTab] = useState('form') // 'form' | 'yaml'

  // ── Form state ─────────────────────────────────────────────────────────────
  const [form, setForm] = useState(() => {
    if (!policy) return DEFAULT_FORM
    // Parse existing policy into form
    const p = policy
    return {
      name: p.name,
      podSelectorLabels: Object.entries(p.podSelector?.matchLabels || {}).map(([k, v]) => ({ key: k, value: v })),
      enableIngress: p.hasIngress,
      enableEgress:  p.hasEgress,
      denyAllIngress: p.isDenyAllIngress,
      denyAllEgress:  p.isDenyAllEgress,
      ingressRules: p.ingress.map(r => fromApiRule(r, 'ingress')),
      egressRules:  p.egress.map(r => fromApiRule(r, 'egress')),
    }
  })

  const isView   = mode === 'view'
  const canEdit  = mode === 'edit' || mode === 'create'
  const isCreate = mode === 'create'

  // Load pod labels khi mở
  useEffect(() => {
    const svc = getService()
    if (!svc) return
    svc.getPodLabels(namespace).then(setPodLabels).catch(() => {})
  }, [getService, namespace])

  // ── Build YAML từ form ─────────────────────────────────────────────────────
  const buildManifest = () => {
    const podSel = form.podSelectorLabels.filter(l => l.key)
      .reduce((acc, l) => ({ ...acc, [l.key]: l.value }), {})

    const policyTypes = [
      ...(form.enableIngress ? ['Ingress'] : []),
      ...(form.enableEgress  ? ['Egress']  : []),
    ]

    const ingress = form.enableIngress && !form.denyAllIngress
      ? form.ingressRules.map(r => toApiRule(r))
      : undefined

    const egress = form.enableEgress && !form.denyAllEgress
      ? form.egressRules.map(r => toApiRule(r))
      : undefined

    return {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: {
        name: form.name.trim(),
        namespace,
        labels: { 'app.kubernetes.io/managed-by': 'ms-manager' },
      },
      spec: {
        podSelector: Object.keys(podSel).length > 0 ? { matchLabels: podSel } : {},
        policyTypes,
        ...(ingress !== undefined ? { ingress } : {}),
        ...(egress  !== undefined ? { egress  } : {}),
      },
    }
  }

  const yamlPreview = (() => {
    try {
      const m = buildManifest()
      // Simple YAML serializer (không dùng js-yaml để tránh async)
      return manifestToYaml(m)
    } catch { return '' }
  })()

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.name.trim()) { setError('Name không được để trống'); return }
    if (!form.enableIngress && !form.enableEgress) { setError('Chọn ít nhất 1 policy type'); return }
    const svc = getService()
    if (!svc) { setError('Chưa kết nối cluster'); return }

    setSaving(true); setError('')
    try {
      const manifest = buildManifest()
      if (isCreate)
        await svc.createNetworkPolicy(manifest, namespace)
      else
        await svc.updateNetworkPolicy(form.name, manifest, namespace)
      onSaved()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const copyYaml = async () => {
    await navigator.clipboard.writeText(yamlPreview)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  // ── Rule helpers ───────────────────────────────────────────────────────────
  const addRule = (dir) => {
    const field = dir === 'ingress' ? 'ingressRules' : 'egressRules'
    setForm(f => ({ ...f, [field]: [...f[field], emptyRule(dir)] }))
  }
  const removeRule = (dir, id) => {
    const field = dir === 'ingress' ? 'ingressRules' : 'egressRules'
    setForm(f => ({ ...f, [field]: f[field].filter(r => r.id !== id) }))
  }
  const updateRule = (dir, id, updater) => {
    const field = dir === 'ingress' ? 'ingressRules' : 'egressRules'
    setForm(f => ({ ...f, [field]: f[field].map(r => r.id === id ? updater(r) : r) }))
  }

  const title = isCreate ? 'Tạo NetworkPolicy' : isView ? policy?.name : `Chỉnh sửa: ${policy?.name}`

  return (
    <>
      <motion.div className={styles.drawerBackdrop}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} />
      <motion.aside className={styles.drawer}
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 36 }}>

        {/* Drawer header */}
        <div className={styles.drawerHeader}>
          <div className={styles.drawerHeaderLeft}>
            <Network size={14} color="var(--accent-blue)" />
            <span className={styles.drawerTitle}>{title}</span>
          </div>
          <div className={styles.drawerHeaderRight}>
            {isView && (
              <button className={styles.editBtn} onClick={() => setMode('edit')}>
                <Edit3 size={13} /> Chỉnh sửa
              </button>
            )}
            {mode === 'edit' && (
              <button className={styles.editBtn} onClick={() => setMode('view')}>
                <Eye size={13} /> View
              </button>
            )}
            <button className={styles.closeBtn} onClick={onClose}><X size={14} /></button>
          </div>
        </div>

        {/* Tabs: Form / YAML */}
        {canEdit && (
          <div className={styles.drawerTabs}>
            <button className={`${styles.drawerTab} ${activeTab === 'form' ? styles.drawerTabActive : ''}`}
              onClick={() => setActiveTab('form')}>Form</button>
            <button className={`${styles.drawerTab} ${activeTab === 'yaml' ? styles.drawerTabActive : ''}`}
              onClick={() => setActiveTab('yaml')}>
              Preview YAML
              <button className={styles.copyYamlBtn} onClick={e => { e.stopPropagation(); copyYaml() }}>
                {copied ? <Check size={10} /> : <Copy size={10} />}
              </button>
            </button>
          </div>
        )}

        {/* Body */}
        <div className={styles.drawerBody}>

          {/* ── YAML preview tab ── */}
          {activeTab === 'yaml' && (
            <pre className={styles.yamlPreview}>{yamlPreview}</pre>
          )}

          {/* ── Form tab ── */}
          {activeTab === 'form' && (
            <>
              {/* Name */}
              <DrawerSection title="METADATA">
                <Field label="NAME">
                  {canEdit
                    ? <input className={styles.input} value={form.name}
                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="deny-external-ingress" disabled={!isCreate} />
                    : <div className={styles.valueText}>{form.name}</div>
                  }
                </Field>
              </DrawerSection>

              {/* Pod Selector */}
              <DrawerSection title="POD SELECTOR"
                hint="Policy áp dụng cho pods có labels này. Để trống = tất cả pods">
                {canEdit ? (
                  <LabelEditor
                    labels={form.podSelectorLabels}
                    suggestions={podLabels}
                    onChange={v => setForm(f => ({ ...f, podSelectorLabels: v }))}
                  />
                ) : (
                  <div className={styles.valueText}>
                    {selectorToString(policy?.podSelector)}
                  </div>
                )}
              </DrawerSection>

              {/* Policy Types */}
              <DrawerSection title="POLICY TYPES">
                <div className={styles.policyTypeRow}>
                  {[
                    { key: 'enableIngress', label: 'Ingress', icon: ArrowDownToLine, color: 'var(--accent-blue)' },
                    { key: 'enableEgress',  label: 'Egress',  icon: ArrowUpFromLine,  color: 'var(--accent-green)' },
                  ].map(({ key, label, icon: Icon, color }) => (
                    <label key={key} className={`${styles.typeToggle} ${form[key] ? styles.typeToggleOn : ''}`}
                      style={form[key] ? { borderColor: color + '50', background: color + '10' } : {}}>
                      {canEdit && (
                        <input type="checkbox" style={{ display: 'none' }}
                          checked={form[key]}
                          onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))} />
                      )}
                      <Icon size={14} color={form[key] ? color : 'var(--text-muted)'} />
                      <span style={{ color: form[key] ? color : 'var(--text-muted)' }}>{label}</span>
                    </label>
                  ))}
                </div>
              </DrawerSection>

              {/* Ingress rules */}
              {form.enableIngress && (
                <DrawerSection
                  title="INGRESS RULES"
                  hint={form.denyAllIngress ? 'Deny All — chặn toàn bộ traffic vào' : ''}
                  action={canEdit && (
                    <label className={styles.denyToggle}>
                      <input type="checkbox" checked={form.denyAllIngress}
                        onChange={e => setForm(f => ({ ...f, denyAllIngress: e.target.checked, ingressRules: [] }))} />
                      Deny All
                    </label>
                  )}
                >
                  {form.denyAllIngress ? (
                    <div className={styles.denyAllBanner}>
                      <ShieldOff size={13} /> Tất cả ingress traffic sẽ bị chặn
                    </div>
                  ) : (
                    <>
                      {form.ingressRules.map(rule => (
                        <RuleEditor key={rule.id} rule={rule} dir="ingress"
                          canEdit={canEdit} podLabels={podLabels}
                          onUpdate={updater => updateRule('ingress', rule.id, updater)}
                          onRemove={() => removeRule('ingress', rule.id)} />
                      ))}
                      {canEdit && (
                        <button className={styles.addRuleBtn} onClick={() => addRule('ingress')}>
                          <Plus size={12} /> Add Ingress Rule
                        </button>
                      )}
                      {form.ingressRules.length === 0 && !canEdit && (
                        <div className={styles.emptyRules}>Không có rules — Allow All</div>
                      )}
                    </>
                  )}
                </DrawerSection>
              )}

              {/* Egress rules */}
              {form.enableEgress && (
                <DrawerSection
                  title="EGRESS RULES"
                  hint={form.denyAllEgress ? 'Deny All — chặn toàn bộ traffic ra' : ''}
                  action={canEdit && (
                    <label className={styles.denyToggle}>
                      <input type="checkbox" checked={form.denyAllEgress}
                        onChange={e => setForm(f => ({ ...f, denyAllEgress: e.target.checked, egressRules: [] }))} />
                      Deny All
                    </label>
                  )}
                >
                  {form.denyAllEgress ? (
                    <div className={styles.denyAllBanner}>
                      <ShieldOff size={13} /> Tất cả egress traffic sẽ bị chặn
                    </div>
                  ) : (
                    <>
                      {form.egressRules.map(rule => (
                        <RuleEditor key={rule.id} rule={rule} dir="egress"
                          canEdit={canEdit} podLabels={podLabels}
                          onUpdate={updater => updateRule('egress', rule.id, updater)}
                          onRemove={() => removeRule('egress', rule.id)} />
                      ))}
                      {canEdit && (
                        <button className={styles.addRuleBtn} onClick={() => addRule('egress')}>
                          <Plus size={12} /> Add Egress Rule
                        </button>
                      )}
                      {form.egressRules.length === 0 && !canEdit && (
                        <div className={styles.emptyRules}>Không có rules — Allow All</div>
                      )}
                    </>
                  )}
                </DrawerSection>
              )}
            </>
          )}
        </div>

        {/* Footer */}
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
            <button className={styles.cancelBtn} onClick={onClose}>Huỷ</button>
            <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
              {saving
                ? <><span className={styles.spinner} /> Đang lưu...</>
                : <><Save size={13} /> {isCreate ? 'Tạo Policy' : 'Lưu thay đổi'}</>
              }
            </button>
          </div>
        )}
      </motion.aside>
    </>
  )
}

// ── RuleEditor ─────────────────────────────────────────────────────────────────

function RuleEditor({ rule, dir, canEdit, podLabels, onUpdate, onRemove }) {
  const [expanded, setExpanded] = useState(true)

  const addPeer = (type) => onUpdate(r => ({
    ...r, peers: [...r.peers, { id: Date.now(), type, key: '', value: '', cidr: '', except: '' }]
  }))
  const removePeer = (id) => onUpdate(r => ({ ...r, peers: r.peers.filter(p => p.id !== id) }))
  const updatePeer = (id, field, val) => onUpdate(r => ({
    ...r, peers: r.peers.map(p => p.id === id ? { ...p, [field]: val } : p)
  }))

  const addPort = () => onUpdate(r => ({
    ...r, ports: [...r.ports, { id: Date.now(), protocol: 'TCP', port: '' }]
  }))
  const removePort = (id) => onUpdate(r => ({ ...r, ports: r.ports.filter(p => p.id !== id) }))
  const updatePort = (id, field, val) => onUpdate(r => ({
    ...r, ports: r.ports.map(p => p.id === id ? { ...p, [field]: val } : p)
  }))

  const dirColor = dir === 'ingress' ? 'var(--accent-blue)' : 'var(--accent-green)'

  return (
    <div className={styles.ruleBox}>
      <div className={styles.ruleBoxHeader}>
        <button className={styles.ruleExpandBtn} onClick={() => setExpanded(v => !v)}>
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span className={styles.ruleLabel} style={{ color: dirColor }}>
            {dir === 'ingress' ? 'from' : 'to'}
          </span>
          {!expanded && (
            <span className={styles.ruleCollapsedSummary}>
              {ruleSummary({ [dir === 'ingress' ? 'from' : 'to']: rule.peers, ports: rule.ports }).peerStr}
            </span>
          )}
        </button>
        {canEdit && (
          <button className={styles.removeRuleBtn} onClick={onRemove}><X size={11} /></button>
        )}
      </div>

      {expanded && (
        <div className={styles.ruleBoxBody}>
          {/* Peers */}
          <div className={styles.ruleSubSection}>
            <div className={styles.ruleSubTitle}>
              {dir === 'ingress' ? 'From (nguồn)' : 'To (đích)'}
              {canEdit && (
                <div className={styles.addPeerBtns}>
                  <button className={styles.addPeerBtn} onClick={() => addPeer('pod')}>+ Pod</button>
                  <button className={styles.addPeerBtn} onClick={() => addPeer('ns')}>+ Namespace</button>
                  <button className={styles.addPeerBtn} onClick={() => addPeer('ip')}>+ IP Block</button>
                </div>
              )}
            </div>
            {rule.peers.length === 0 && (
              <div className={styles.emptyPeers}>
                {canEdit ? 'Thêm nguồn/đích bên trên (để trống = Allow All)' : 'Allow All'}
              </div>
            )}
            {rule.peers.map(peer => (
              <div key={peer.id} className={styles.peerRow}>
                <span className={`${styles.peerType} ${
                  peer.type === 'pod' ? styles.peerTypePod
                  : peer.type === 'ns' ? styles.peerTypeNs
                  : styles.peerTypeIp
                }`}>
                  {peer.type === 'pod' ? 'pod' : peer.type === 'ns' ? 'ns' : 'ip'}
                </span>
                {peer.type === 'ip' ? (
                  <div className={styles.peerFields}>
                    <input className={styles.peerInput} placeholder="CIDR (e.g. 10.0.0.0/8)"
                      value={peer.cidr} disabled={!canEdit}
                      onChange={e => updatePeer(peer.id, 'cidr', e.target.value)} />
                    <input className={styles.peerInput} placeholder="except (optional)"
                      value={peer.except} disabled={!canEdit}
                      onChange={e => updatePeer(peer.id, 'except', e.target.value)} />
                  </div>
                ) : (
                  <div className={styles.peerFields}>
                    <input className={styles.peerInput} placeholder="label key"
                      value={peer.key} disabled={!canEdit}
                      list={`labels-${peer.id}-keys`}
                      onChange={e => updatePeer(peer.id, 'key', e.target.value)} />
                    <datalist id={`labels-${peer.id}-keys`}>
                      {Object.keys(podLabels).map(k => <option key={k} value={k} />)}
                    </datalist>
                    <span className={styles.eq}>=</span>
                    <input className={styles.peerInput} placeholder="label value"
                      value={peer.value} disabled={!canEdit}
                      list={`labels-${peer.id}-vals`}
                      onChange={e => updatePeer(peer.id, 'value', e.target.value)} />
                    <datalist id={`labels-${peer.id}-vals`}>
                      {(podLabels[peer.key] || []).map(v => <option key={v} value={v} />)}
                    </datalist>
                  </div>
                )}
                {canEdit && (
                  <button className={styles.removePeerBtn} onClick={() => removePeer(peer.id)}>
                    <X size={10} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Ports */}
          <div className={styles.ruleSubSection}>
            <div className={styles.ruleSubTitle}>
              Ports
              {canEdit && (
                <button className={styles.addPeerBtn} onClick={addPort}>+ Port</button>
              )}
            </div>
            {rule.ports.length === 0 && (
              <div className={styles.emptyPeers}>
                {canEdit ? 'Thêm port (để trống = All ports)' : 'All ports'}
              </div>
            )}
            {rule.ports.map(port => (
              <div key={port.id} className={styles.portRow}>
                <select className={styles.protocolSelect} value={port.protocol} disabled={!canEdit}
                  onChange={e => updatePort(port.id, 'protocol', e.target.value)}>
                  <option>TCP</option><option>UDP</option><option>SCTP</option>
                </select>
                <input className={styles.portInput} placeholder="port / port-name"
                  value={port.port} disabled={!canEdit}
                  onChange={e => updatePort(port.id, 'port', e.target.value)} />
                {canEdit && (
                  <button className={styles.removePeerBtn} onClick={() => removePort(port.id)}>
                    <X size={10} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── LabelEditor ────────────────────────────────────────────────────────────────

function LabelEditor({ labels, suggestions, onChange }) {
  const add    = () => onChange([...labels, { id: Date.now(), key: '', value: '' }])
  const remove = (id) => onChange(labels.filter(l => l.id !== id))
  const update = (id, field, val) => onChange(labels.map(l => l.id === id ? { ...l, [field]: val } : l))

  return (
    <div>
      {labels.length === 0 && (
        <div className={styles.emptyPeers}>Để trống = áp dụng cho tất cả pods</div>
      )}
      {labels.map(l => (
        <div key={l.id} className={styles.peerRow}>
          <input className={styles.peerInput} placeholder="key"
            value={l.key} list={`sug-keys-${l.id}`}
            onChange={e => update(l.id, 'key', e.target.value)} />
          <datalist id={`sug-keys-${l.id}`}>
            {Object.keys(suggestions).map(k => <option key={k} value={k} />)}
          </datalist>
          <span className={styles.eq}>=</span>
          <input className={styles.peerInput} placeholder="value"
            value={l.value} list={`sug-vals-${l.id}`}
            onChange={e => update(l.id, 'value', e.target.value)} />
          <datalist id={`sug-vals-${l.id}`}>
            {(suggestions[l.key] || []).map(v => <option key={v} value={v} />)}
          </datalist>
          <button className={styles.removePeerBtn} onClick={() => remove(l.id)}>
            <X size={10} />
          </button>
        </div>
      ))}
      <button className={styles.addPeerBtn} style={{ marginTop: 6 }} onClick={add}>
        <Plus size={10} /> Add label
      </button>
    </div>
  )
}

// ── DrawerSection ──────────────────────────────────────────────────────────────

function DrawerSection({ title, hint, action, children }) {
  return (
    <div className={styles.drawerSection}>
      <div className={styles.drawerSectionHeader}>
        <span className={styles.drawerSectionTitle}>{title}</span>
        {hint && <span className={styles.drawerSectionHint}>{hint}</span>}
        {action && <span className={styles.drawerSectionAction}>{action}</span>}
      </div>
      <div className={styles.drawerSectionBody}>{children}</div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel}>{label}</label>
      {children}
    </div>
  )
}

// ── Converters ─────────────────────────────────────────────────────────────────

function fromApiRule(r, dir) {
  const peers = (r.from || r.to || []).map(p => {
    if (p.ipBlock) return {
      id: Date.now() + Math.random(), type: 'ip',
      cidr: p.ipBlock.cidr || '', except: (p.ipBlock.except || []).join(', '),
    }
    const sel = p.podSelector || p.namespaceSelector || {}
    const ml = sel.matchLabels || {}
    const [key, value] = Object.entries(ml)[0] || ['', '']
    return { id: Date.now() + Math.random(), type: p.podSelector ? 'pod' : 'ns', key, value, cidr: '', except: '' }
  })
  const ports = (r.ports || []).map(p => ({
    id: Date.now() + Math.random(), protocol: p.protocol || 'TCP', port: String(p.port || ''),
  }))
  return { id: Date.now() + Math.random(), peers, ports, _dir: dir }
}

function toApiRule(rule) {
  const peerKey = rule._dir === 'ingress' ? 'from' : 'to'
  const peers = rule.peers.map(p => {
    if (p.type === 'ip') {
      const ipBlock = { cidr: p.cidr }
      if (p.except?.trim()) ipBlock.except = p.except.split(',').map(s => s.trim()).filter(Boolean)
      return { ipBlock }
    }
    const sel = p.key ? { matchLabels: { [p.key]: p.value } } : {}
    return p.type === 'pod' ? { podSelector: sel } : { namespaceSelector: sel }
  })
  const ports = rule.ports
    .filter(p => p.port)
    .map(p => ({ protocol: p.protocol, port: isNaN(p.port) ? p.port : parseInt(p.port, 10) }))

  const result = {}
  if (peers.length > 0) result[peerKey] = peers
  if (ports.length > 0) result.ports = ports
  return result
}

// ── Simple YAML serializer ─────────────────────────────────────────────────────
function manifestToYaml(obj, indent = 0) {
  const pad = ' '.repeat(indent)
  if (obj === null || obj === undefined) return 'null'
  if (typeof obj === 'boolean') return String(obj)
  if (typeof obj === 'number') return String(obj)
  if (typeof obj === 'string') {
    if (obj.includes('\n') || obj.includes(':') || obj.includes('#') || obj === '')
      return `"${obj.replace(/"/g, '\\"')}"`
    return obj
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]'
    return obj.map(item => {
      const v = manifestToYaml(item, indent + 2)
      if (typeof item === 'object' && !Array.isArray(item) && item !== null) {
        const lines = v.split('\n')
        return `${pad}- ${lines[0]}\n${lines.slice(1).join('\n')}`
      }
      return `${pad}- ${v}`
    }).join('\n')
  }
  if (typeof obj === 'object') {
    const entries = Object.entries(obj)
    if (entries.length === 0) return '{}'
    return entries.map(([k, v]) => {
      if (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length > 0) {
        return `${pad}${k}:\n${manifestToYaml(v, indent + 2)}`
      }
      if (Array.isArray(v) && v.length > 0) {
        return `${pad}${k}:\n${manifestToYaml(v, indent + 2)}`
      }
      return `${pad}${k}: ${manifestToYaml(v, indent + 2)}`
    }).join('\n')
  }
  return String(obj)
}
