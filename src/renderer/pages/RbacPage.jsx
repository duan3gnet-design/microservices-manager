import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Shield, Plus, Trash2, Search, RefreshCw, AlertCircle,
  Edit3, X, Save, ChevronDown, ChevronRight, Users, Key,
  Link, Unlink, Check, BookOpen, UserCheck, Globe, Lock,
  Tag, Info,
} from 'lucide-react'
import { useK8sStore } from '@/store'
import { useK8sService } from '@/hooks/useAuth'
import styles from './RbacPage.module.css'

// ── Constants ─────────────────────────────────────────────────────────────────

const K8S_VERBS = ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete', 'deletecollection']
const VERB_COLORS = {
  get: 'var(--accent-cyan)', list: 'var(--accent-cyan)', watch: 'var(--accent-cyan)',
  create: 'var(--accent-green)', update: 'var(--accent-amber)', patch: 'var(--accent-amber)',
  delete: 'var(--accent-red)', deletecollection: 'var(--accent-red)',
}

const COMMON_RESOURCES = [
  { group: 'Core', apiGroup: '', resources: ['pods', 'services', 'endpoints', 'configmaps', 'secrets', 'persistentvolumeclaims', 'serviceaccounts', 'events', 'namespaces', 'nodes'] },
  { group: 'Apps', apiGroup: 'apps', resources: ['deployments', 'replicasets', 'statefulsets', 'daemonsets', 'controllerrevisions'] },
  { group: 'Batch', apiGroup: 'batch', resources: ['jobs', 'cronjobs'] },
  { group: 'Networking', apiGroup: 'networking.k8s.io', resources: ['ingresses', 'networkpolicies', 'ingressclasses'] },
  { group: 'RBAC', apiGroup: 'rbac.authorization.k8s.io', resources: ['roles', 'rolebindings', 'clusterroles', 'clusterrolebindings'] },
  { group: 'Storage', apiGroup: 'storage.k8s.io', resources: ['storageclasses', 'volumeattachments'] },
  { group: 'Autoscaling', apiGroup: 'autoscaling', resources: ['horizontalpodautoscalers'] },
  { group: 'Policy', apiGroup: 'policy', resources: ['poddisruptionbudgets'] },
]

// Preset OIDC role → k8s verbs mapping
const OIDC_ROLE_PRESETS = {
  'ROLE_ADMIN':    { verbs: ['get','list','watch','create','update','patch','delete','deletecollection'], label: 'Admin', color: 'var(--accent-red)' },
  'ROLE_DEVELOPER':{ verbs: ['get','list','watch','create','update','patch'], label: 'Developer', color: 'var(--accent-blue)' },
  'ROLE_VIEWER':   { verbs: ['get','list','watch'], label: 'Viewer', color: 'var(--accent-cyan)' },
  'ROLE_DEPLOYER': { verbs: ['get','list','watch','create','update','patch'], label: 'Deployer', color: 'var(--accent-green)' },
  'ROLE_OPS':      { verbs: ['get','list','watch','delete'], label: 'Ops', color: 'var(--accent-amber)' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseRoleRules(role) {
  return (role?.rules || []).map((rule, i) => ({
    id: i,
    apiGroups: rule.apiGroups || [''],
    resources: rule.resources || [],
    resourceNames: rule.resourceNames || [],
    verbs: rule.verbs || [],
    nonResourceURLs: rule.nonResourceURLs || [],
  }))
}

function buildRuleObject(rule) {
  const obj = {
    apiGroups: rule.apiGroups?.length ? rule.apiGroups : [''],
    resources: rule.resources,
    verbs: rule.verbs,
  }
  if (rule.resourceNames?.length) obj.resourceNames = rule.resourceNames
  if (rule.nonResourceURLs?.length) obj.nonResourceURLs = rule.nonResourceURLs
  return obj
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function RbacPage() {
  const getService = useK8sService()
  const { selectedNamespace } = useK8sStore()

  const [tab, setTab] = useState('roles') // roles | clusterroles | bindings | oidc-map
  const [roles, setRoles] = useState([])
  const [clusterRoles, setClusterRoles] = useState([])
  const [roleBindings, setRoleBindings] = useState([])
  const [clusterRoleBindings, setClusterRoleBindings] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [drawer, setDrawer] = useState(null) // { mode, kind, item? }
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    const svc = getService()
    if (!svc) { setError('Chưa kết nối cluster'); return }
    setLoading(true); setError('')
    try {
      const [r, cr, rb, crb] = await Promise.all([
        svc._call(`/apis/rbac.authorization.k8s.io/v1/namespaces/${selectedNamespace}/roles`).then(d => d.items || []),
        svc._call('/apis/rbac.authorization.k8s.io/v1/clusterroles').then(d => (d.items || []).filter(r => !r.metadata?.name?.startsWith('system:'))),
        svc._call(`/apis/rbac.authorization.k8s.io/v1/namespaces/${selectedNamespace}/rolebindings`).then(d => d.items || []),
        svc._call('/apis/rbac.authorization.k8s.io/v1/clusterrolebindings').then(d => (d.items || []).filter(r => !r.metadata?.name?.startsWith('system:'))),
      ])

      setRoles(r.map(role => ({ ...role, kind: "Role" })))
      setClusterRoles(cr.map(role => ({ ...role, kind: "ClusterRole" })))
      setRoleBindings(rb.map(role => ({ ...role, kind: "RoleBinding" })))
      setClusterRoleBindings(crb.map(role => ({ ...role, kind: "ClusterRoleBinding" })))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [getService, selectedNamespace])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    const svc = getService()
    if (!svc || !deleteTarget) return
    setDeleteLoading(true)
    try {
      const { name, kind } = deleteTarget
      const paths = {
        Role:               `/apis/rbac.authorization.k8s.io/v1/namespaces/${selectedNamespace}/roles/${name}`,
        ClusterRole:        `/apis/rbac.authorization.k8s.io/v1/clusterroles/${name}`,
        RoleBinding:        `/apis/rbac.authorization.k8s.io/v1/namespaces/${selectedNamespace}/rolebindings/${name}`,
        ClusterRoleBinding: `/apis/rbac.authorization.k8s.io/v1/clusterrolebindings/${name}`,
      }
      await svc._call(paths[kind], 'DELETE')
      await fetchAll()
      setDeleteTarget(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setDeleteLoading(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const TABS = [
    { id: 'roles',        label: 'Roles',              icon: BookOpen, count: roles.length },
    { id: 'clusterroles', label: 'ClusterRoles',       icon: Globe,    count: clusterRoles.length },
    { id: 'bindings',     label: 'Bindings',           icon: Link,     count: roleBindings.length + clusterRoleBindings.length },
    { id: 'oidc-map',     label: 'OIDC → K8s Map',    icon: Key,      count: null },
  ]

  const currentList = {
    roles: roles,
    clusterroles: clusterRoles,
    bindings: [...roleBindings, ...clusterRoleBindings],
    'oidc-map': [],
  }[tab]

  const filtered = (currentList || []).filter(item =>
    item.metadata?.name?.toLowerCase().includes(search.toLowerCase())
  )

  const canCreateRole    = tab === 'roles' || tab === 'clusterroles'
  const canCreateBinding = tab === 'bindings'

  return (
    <div className={styles.root}>
      {/* Header */}
      <div className={styles.pageHeader}>
        <div className={styles.pageTitle}>
          <Shield size={16} color="var(--accent-blue)" />
          <span>RBAC Manager</span>
          <span className={styles.nsBadge}>{selectedNamespace}</span>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.searchWrap}>
            <Search size={12} />
            <input className={styles.search} placeholder="Tìm kiếm..."
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className={styles.iconBtn} onClick={fetchAll} disabled={loading} title="Refresh">
            <RefreshCw size={14} className={loading ? styles.spin : ''} />
          </button>
          {canCreateRole && (
            <button className={styles.primaryBtn}
              onClick={() => setDrawer({ mode: 'create', kind: tab === 'roles' ? 'Role' : 'ClusterRole' })}>
              <Plus size={13} /> Tạo {tab === 'roles' ? 'Role' : 'ClusterRole'}
            </button>
          )}
          {canCreateBinding && (
            <button className={styles.primaryBtn}
              onClick={() => setDrawer({ mode: 'create', kind: 'RoleBinding' })}>
              <Plus size={13} /> Tạo Binding
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        {TABS.map(t => (
          <button
            key={t.id}
            className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
            onClick={() => { setTab(t.id); setSearch('') }}
          >
            <t.icon size={13} />
            {t.label}
            {t.count !== null && <span className={styles.tabCount}>{t.count}</span>}
          </button>
        ))}
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div className={styles.errorBanner}
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            <AlertCircle size={13} /> {error}
            <button className={styles.errorClose} onClick={() => setError('')}><X size={12} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      <div className={styles.content}>
        {tab === 'oidc-map' ? (
          <OidcMappingPanel
            roles={[...roles, ...clusterRoles]}
            roleBindings={[...roleBindings, ...clusterRoleBindings]}
            onCreateBinding={(preset) => setDrawer({ mode: 'create', kind: 'RoleBinding', preset })}
          />
        ) : loading && filtered.length === 0 ? (
          <div className={styles.loadingState}>
            <div className={styles.loadingSpinner} />
            <span>Đang tải RBAC resources...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.emptyState}>
            <Shield size={32} color="var(--text-muted)" style={{ opacity: 0.3 }} />
            <span>{search ? 'Không tìm thấy kết quả' : `Chưa có ${tab}`}</span>
          </div>
        ) : (
          <div className={styles.list}>
            <AnimatePresence initial={false}>
              {filtered.map((item, i) => (
                tab === 'bindings'
                  ? <BindingRow key={item.metadata?.uid || i} item={item} index={i}
                      onEdit={() => setDrawer({ mode: 'edit', kind: item.kind, item })}
                      onDelete={() => setDeleteTarget({ name: item.metadata?.name, kind: item.kind })}
                    />
                  : <RoleRow key={item.metadata?.uid || i} item={item} index={i}
                      onEdit={() => setDrawer({ mode: 'edit', kind: item.kind, item })}
                      onDelete={() => setDeleteTarget({ name: item.metadata?.name, kind: item.kind })}
                    />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Drawers */}
      <AnimatePresence>
        {drawer && (drawer.kind === 'Role' || drawer.kind === 'ClusterRole') && (
          <RoleDrawer
            mode={drawer.mode} kind={drawer.kind} item={drawer.item}
            namespace={selectedNamespace} getService={getService}
            onClose={() => setDrawer(null)}
            onSaved={() => { setDrawer(null); fetchAll() }}
          />
        )}
        {drawer && (drawer.kind === 'RoleBinding' || drawer.kind === 'ClusterRoleBinding') && (
          <BindingDrawer
            mode={drawer.mode} kind={drawer.kind} item={drawer.item} preset={drawer.preset}
            namespace={selectedNamespace} getService={getService}
            roles={roles} clusterRoles={clusterRoles}
            onClose={() => setDrawer(null)}
            onSaved={() => { setDrawer(null); fetchAll() }}
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
              <h3 className={styles.dialogTitle}>Xoá {deleteTarget.kind}?</h3>
              <p className={styles.dialogBody}>
                <code className={styles.nameCode}>{deleteTarget.name}</code> sẽ bị xoá vĩnh viễn.
                {deleteTarget.kind.includes('Binding') && ' Các subject sẽ mất quyền liên quan.'}
              </p>
              <div className={styles.dialogActions}>
                <button className={styles.cancelBtn} onClick={() => setDeleteTarget(null)}>Huỷ</button>
                <button className={styles.deleteConfirmBtn} onClick={handleDelete} disabled={deleteLoading}>
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

// ── RoleRow ───────────────────────────────────────────────────────────────────

function RoleRow({ item, index, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const rules = item.rules || []
  const isCluster = item.kind === 'ClusterRole'
  const ruleCount = rules.length

  return (
    <motion.div className={styles.roleCard}
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.025, 0.3) }}>
      {/* Card header */}
      <div className={styles.roleCardHeader} onClick={() => setExpanded(v => !v)}>
        <div className={styles.roleCardLeft}>
          <span className={styles.roleExpandIcon}>
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <div className={`${styles.roleKindBadge} ${isCluster ? styles.clusterBadge : styles.namespacedBadge}`}>
            {isCluster ? <Globe size={10} /> : <Lock size={10} />}
            {item.kind}
          </div>
          <span className={styles.roleName}>{item.metadata?.name}</span>
          <span className={styles.ruleCountBadge}>{ruleCount} rule{ruleCount !== 1 ? 's' : ''}</span>
        </div>
        <div className={styles.roleCardRight}>
          <span className={styles.dateText}>
            {item.metadata?.creationTimestamp
              ? new Date(item.metadata.creationTimestamp).toLocaleDateString('vi-VN')
              : '—'}
          </span>
          <button className={styles.actionBtn} title="Chỉnh sửa"
            onClick={e => { e.stopPropagation(); onEdit() }}>
            <Edit3 size={12} />
          </button>
          <button className={`${styles.actionBtn} ${styles.deleteActionBtn}`} title="Xoá"
            onClick={e => { e.stopPropagation(); onDelete() }}>
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Rules expanded */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div className={styles.rulesExpanded}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}>
            {rules.length === 0
              ? <div className={styles.emptyRules}>Không có rules</div>
              : rules.map((rule, ri) => <RulePreview key={ri} rule={rule} />)
            }
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function RulePreview({ rule }) {
  const verbs = rule.verbs || []
  const resources = rule.resources || []
  const apiGroups = rule.apiGroups || ['']

  return (
    <div className={styles.rulePreview}>
      <div className={styles.ruleApiGroup}>
        <span className={styles.ruleLabel}>apiGroup:</span>
        <span className={styles.ruleApiGroupValue}>{apiGroups.map(g => g || 'core').join(', ')}</span>
      </div>
      <div className={styles.ruleResources}>
        {resources.map(r => (
          <span key={r} className={styles.resourceChip}>{r}</span>
        ))}
        {rule.nonResourceURLs?.map(u => (
          <span key={u} className={`${styles.resourceChip} ${styles.urlChip}`}>{u}</span>
        ))}
      </div>
      <div className={styles.ruleVerbs}>
        {verbs.map(v => (
          <span key={v} className={styles.verbChip} style={{ color: VERB_COLORS[v] || 'var(--text-muted)', borderColor: (VERB_COLORS[v] || 'var(--text-muted)') + '30' }}>
            {v}
          </span>
        ))}
      </div>
      {rule.resourceNames?.length > 0 && (
        <div className={styles.resourceNames}>
          <Tag size={10} color="var(--accent-amber)" />
          <span>names: {rule.resourceNames.join(', ')}</span>
        </div>
      )}
    </div>
  )
}

// ── BindingRow ────────────────────────────────────────────────────────────────

function BindingRow({ item, index, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const subjects = item.subjects || []
  const roleRef = item.roleRef || {}
  const isCluster = item.kind === 'ClusterRoleBinding'

  return (
    <motion.div className={styles.roleCard}
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.025, 0.3) }}>
      <div className={styles.roleCardHeader} onClick={() => setExpanded(v => !v)}>
        <div className={styles.roleCardLeft}>
          <span className={styles.roleExpandIcon}>
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <div className={`${styles.roleKindBadge} ${isCluster ? styles.clusterBadge : styles.namespacedBadge}`}>
            {isCluster ? <Globe size={10} /> : <Link size={10} />}
            {item.kind}
          </div>
          <span className={styles.roleName}>{item.metadata?.name}</span>
          <span className={styles.bindingRefBadge}>
            <BookOpen size={10} /> {roleRef.name}
          </span>
          <span className={styles.subjectCountBadge}>
            <Users size={10} /> {subjects.length}
          </span>
        </div>
        <div className={styles.roleCardRight}>
          <span className={styles.dateText}>
            {item.metadata?.creationTimestamp
              ? new Date(item.metadata.creationTimestamp).toLocaleDateString('vi-VN')
              : '—'}
          </span>
          <button className={styles.actionBtn} title="Chỉnh sửa"
            onClick={e => { e.stopPropagation(); onEdit() }}>
            <Edit3 size={12} />
          </button>
          <button className={`${styles.actionBtn} ${styles.deleteActionBtn}`} title="Xoá"
            onClick={e => { e.stopPropagation(); onDelete() }}>
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div className={styles.rulesExpanded}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}>
            <div className={styles.bindingDetail}>
              <div className={styles.bindingSection}>
                <div className={styles.bindingSectionLabel}>ROLE REF</div>
                <div className={styles.roleRefDisplay}>
                  <BookOpen size={12} color="var(--accent-blue)" />
                  <span className={styles.roleRefKind}>{roleRef.kind}</span>
                  <span className={styles.roleRefName}>{roleRef.name}</span>
                </div>
              </div>
              <div className={styles.bindingSection}>
                <div className={styles.bindingSectionLabel}>SUBJECTS ({subjects.length})</div>
                {subjects.map((s, si) => (
                  <div key={si} className={styles.subjectRow}>
                    <SubjectIcon kind={s.kind} />
                    <span className={styles.subjectKind}>{s.kind}</span>
                    <span className={styles.subjectName}>{s.name}</span>
                    {s.namespace && <span className={styles.subjectNs}>({s.namespace})</span>}
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function SubjectIcon({ kind }) {
  if (kind === 'ServiceAccount') return <Tag size={11} color="var(--accent-purple)" />
  if (kind === 'Group') return <Users size={11} color="var(--accent-amber)" />
  return <UserCheck size={11} color="var(--accent-green)" />
}

// ── OidcMappingPanel ──────────────────────────────────────────────────────────

function OidcMappingPanel({ roles, roleBindings, onCreateBinding }) {
  const [mappings, setMappings] = useState(() => {
    try { return JSON.parse(localStorage.getItem('rbac_oidc_mappings') || '[]') } catch { return [] }
  })
  const [showAddForm, setShowAddForm] = useState(false)
  const [newMapping, setNewMapping] = useState({ oidcRole: '', k8sRole: '', bindingType: 'Group', description: '' })

  const saveMapping = () => {
    if (!newMapping.oidcRole || !newMapping.k8sRole) return
    const updated = [...mappings.filter(m => m.oidcRole !== newMapping.oidcRole), { ...newMapping, id: Date.now() }]
    setMappings(updated)
    localStorage.setItem('rbac_oidc_mappings', JSON.stringify(updated))
    setShowAddForm(false)
    setNewMapping({ oidcRole: '', k8sRole: '', bindingType: 'Group', description: '' })
  }

  const removeMapping = (id) => {
    const updated = mappings.filter(m => m.id !== id)
    setMappings(updated)
    localStorage.setItem('rbac_oidc_mappings', JSON.stringify(updated))
  }

  // Check binding exists
  const isBindingActive = (mapping) => {
    return roleBindings.some(b =>
      b.subjects?.some(s => s.name === mapping.oidcRole && s.kind === mapping.bindingType) &&
      b.roleRef?.name === mapping.k8sRole
    )
  }

  return (
    <div className={styles.oidcPanel}>
      {/* Info banner */}
      <div className={styles.oidcInfoBanner}>
        <Info size={13} color="var(--accent-cyan)" />
        <span>Ánh xạ OIDC roles/groups (từ JWT claims) sang Kubernetes Roles/ClusterRoles.
          Sau khi cấu hình, tạo RoleBinding tương ứng để activate.</span>
      </div>

      {/* Preset table */}
      <div className={styles.oidcSection}>
        <div className={styles.oidcSectionHeader}>
          <span className={styles.oidcSectionTitle}>OIDC ROLE PRESETS → K8S VERBS</span>
        </div>
        <div className={styles.presetTable}>
          <div className={styles.presetHead}>
            <span>OIDC Role</span>
            <span>K8s Verbs</span>
            <span>Gợi ý tài nguyên</span>
          </div>
          {Object.entries(OIDC_ROLE_PRESETS).map(([role, preset]) => (
            <div key={role} className={styles.presetRow}>
              <span className={styles.presetRole} style={{ color: preset.color }}>{role}</span>
              <div className={styles.presetVerbs}>
                {preset.verbs.map(v => (
                  <span key={v} className={styles.verbChipSm}
                    style={{ color: VERB_COLORS[v], borderColor: VERB_COLORS[v] + '30' }}>{v}</span>
                ))}
              </div>
              <span className={styles.presetLabel}>{preset.label} access</span>
            </div>
          ))}
        </div>
      </div>

      {/* Custom mappings */}
      <div className={styles.oidcSection}>
        <div className={styles.oidcSectionHeader}>
          <span className={styles.oidcSectionTitle}>CUSTOM OIDC → K8S MAPPINGS</span>
          <button className={styles.addMappingBtn} onClick={() => setShowAddForm(v => !v)}>
            <Plus size={11} /> Thêm mapping
          </button>
        </div>

        {/* Add form */}
        <AnimatePresence>
          {showAddForm && (
            <motion.div className={styles.addMappingForm}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}>
              <div className={styles.mappingFormGrid}>
                <div className={styles.mappingFormField}>
                  <label className={styles.fieldLabel}>OIDC ROLE / GROUP (JWT claim)</label>
                  <input className={styles.input} placeholder="e.g. ROLE_ADMIN, k8s-dev-team"
                    value={newMapping.oidcRole}
                    onChange={e => setNewMapping(m => ({ ...m, oidcRole: e.target.value }))} />
                  <div className={styles.fieldHint}>Giá trị trong <code>roles[]</code> hoặc <code>groups[]</code> của JWT</div>
                </div>
                <div className={styles.mappingFormField}>
                  <label className={styles.fieldLabel}>KUBERNETES ROLE</label>
                  <select className={styles.input} value={newMapping.k8sRole}
                    onChange={e => setNewMapping(m => ({ ...m, k8sRole: e.target.value }))}>
                    <option value="">-- Chọn Role --</option>
                    {roles.map(r => (
                      <option key={r.metadata?.name} value={r.metadata?.name}>
                        [{r.kind}] {r.metadata?.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.mappingFormField}>
                  <label className={styles.fieldLabel}>SUBJECT KIND</label>
                  <select className={styles.input} value={newMapping.bindingType}
                    onChange={e => setNewMapping(m => ({ ...m, bindingType: e.target.value }))}>
                    <option value="Group">Group (nhiều user)</option>
                    <option value="User">User (cụ thể)</option>
                    <option value="ServiceAccount">ServiceAccount</option>
                  </select>
                </div>
                <div className={styles.mappingFormField}>
                  <label className={styles.fieldLabel}>MÔ TẢ (tuỳ chọn)</label>
                  <input className={styles.input} placeholder="Ghi chú về mapping này..."
                    value={newMapping.description}
                    onChange={e => setNewMapping(m => ({ ...m, description: e.target.value }))} />
                </div>
              </div>
              <div className={styles.mappingFormActions}>
                <button className={styles.cancelSmBtn} onClick={() => setShowAddForm(false)}>Huỷ</button>
                <button className={styles.saveSmBtn} onClick={saveMapping}
                  disabled={!newMapping.oidcRole || !newMapping.k8sRole}>
                  <Save size={12} /> Lưu mapping
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Mapping list */}
        {mappings.length === 0 ? (
          <div className={styles.emptyMappings}>
            <Key size={24} color="var(--text-muted)" style={{ opacity: 0.3 }} />
            <span>Chưa có mapping nào. Thêm để ánh xạ OIDC roles sang K8s roles.</span>
          </div>
        ) : (
          <div className={styles.mappingList}>
            {mappings.map(m => {
              const active = isBindingActive(m)
              return (
                <div key={m.id} className={styles.mappingItem}>
                  <div className={styles.mappingItemLeft}>
                    <div className={styles.mappingOidcRole}>
                      <Key size={11} color="var(--accent-purple)" />
                      <span>{m.oidcRole}</span>
                    </div>
                    <div className={styles.mappingArrow}>→</div>
                    <div className={styles.mappingK8sRole}>
                      <BookOpen size={11} color="var(--accent-blue)" />
                      <span>{m.k8sRole}</span>
                    </div>
                    <span className={styles.mappingSubjectKind}>({m.bindingType})</span>
                    {m.description && <span className={styles.mappingDesc}>{m.description}</span>}
                  </div>
                  <div className={styles.mappingItemRight}>
                    <span className={`${styles.bindingStatus} ${active ? styles.bindingActive : styles.bindingInactive}`}>
                      {active ? <><Check size={10} /> Binding active</> : <><Unlink size={10} /> No binding</>}
                    </span>
                    {!active && (
                      <button className={styles.createBindingBtn}
                        onClick={() => onCreateBinding(m)}
                        title="Tạo RoleBinding từ mapping này">
                        <Link size={11} /> Tạo Binding
                      </button>
                    )}
                    <button className={styles.removeMappingBtn} onClick={() => removeMapping(m.id)}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── RoleDrawer ────────────────────────────────────────────────────────────────

function RoleDrawer({ mode, kind, item, namespace, getService, onClose, onSaved }) {
  const [name, setName] = useState(item?.metadata?.name || '')
  const [rules, setRules] = useState(() => item ? parseRoleRules(item) : [newEmptyRule()])
  const [labels, setLabels] = useState(
    Object.entries(item?.metadata?.labels || {})
      .filter(([k]) => !k.startsWith('kubernetes.io'))
      .map(([k, v]) => ({ key: k, value: v }))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [activeRuleIdx, setActiveRuleIdx] = useState(0)
  const isCreate = mode === 'create'
  const isCluster = kind === 'ClusterRole'

  function newEmptyRule() {
    return { id: Date.now(), apiGroups: [''], resources: [], resourceNames: [], verbs: [], nonResourceURLs: [] }
  }

  const addRule = () => {
    const rule = newEmptyRule()
    setRules(r => [...r, rule])
    setActiveRuleIdx(rules.length)
  }

  const removeRule = (idx) => {
    setRules(r => r.filter((_, i) => i !== idx))
    setActiveRuleIdx(Math.max(0, activeRuleIdx - 1))
  }

  const updateRule = (idx, field, value) =>
    setRules(r => r.map((rule, i) => i === idx ? { ...rule, [field]: value } : rule))

  const toggleVerb = (idx, verb) => {
    const rule = rules[idx]
    const has = rule.verbs.includes(verb)
    updateRule(idx, 'verbs', has ? rule.verbs.filter(v => v !== verb) : [...rule.verbs, verb])
  }

  const toggleResource = (idx, resource, apiGroup) => {
    const rule = rules[idx]
    const hasRes = rule.resources.includes(resource)
    const newResources = hasRes ? rule.resources.filter(r => r !== resource) : [...rule.resources, resource]
    // Auto-set apiGroups
    const currentGroups = rule.apiGroups.includes('') && apiGroup !== '' ? rule.apiGroups.filter(g => g !== '') : rule.apiGroups
    const newGroups = newResources.length === 0 ? [''] : [...new Set([...currentGroups, apiGroup])]
    updateRule(idx, 'resources', newResources)
    updateRule(idx, 'apiGroups', newGroups.length ? newGroups : [''])
  }

  const applyPreset = (idx, presetKey) => {
    const preset = OIDC_ROLE_PRESETS[presetKey]
    if (!preset) return
    updateRule(idx, 'verbs', preset.verbs)
  }

  const handleSave = async () => {
    if (!name.trim()) { setError('Name không được để trống'); return }
    const validRules = rules.filter(r => r.resources.length > 0 || r.nonResourceURLs.length > 0)
    if (validRules.length === 0) { setError('Cần ít nhất 1 rule có resources'); return }

    const svc = getService()
    if (!svc) { setError('Chưa kết nối cluster'); return }

    const extraLabels = labels.filter(l => l.key.trim())
      .reduce((acc, l) => ({ ...acc, [l.key]: l.value }), {})

    const manifest = {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind,
      metadata: {
        name: name.trim(),
        ...(isCluster ? {} : { namespace }),
        labels: { 'app.kubernetes.io/managed-by': 'ms-manager', ...extraLabels },
      },
      rules: validRules.map(buildRuleObject),
    }

    setSaving(true); setError('')
    try {
      const basePath = isCluster
        ? `/apis/rbac.authorization.k8s.io/v1/clusterroles`
        : `/apis/rbac.authorization.k8s.io/v1/namespaces/${namespace}/roles`

      if (isCreate) {
        await svc._call(basePath, 'POST', manifest)
      } else {
        await svc._call(`${basePath}/${name}`, 'PUT', manifest)
      }
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const activeRule = rules[activeRuleIdx] || rules[0]

  return (
    <>
      <motion.div className={styles.drawerBackdrop}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} />
      <motion.aside className={styles.drawer}
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 36 }}>

        {/* Header */}
        <div className={styles.drawerHeader}>
          <div className={styles.drawerHeaderLeft}>
            <Shield size={14} color="var(--accent-blue)" />
            <span className={styles.drawerTitle}>
              {isCreate ? `Tạo ${kind}` : `Sửa: ${item?.metadata?.name}`}
            </span>
            <span className={`${styles.kindPill} ${isCluster ? styles.clusterPill : styles.namespacedPill}`}>
              {kind}
            </span>
          </div>
          <button className={styles.closeDrawerBtn} onClick={onClose}><X size={14} /></button>
        </div>

        <div className={styles.drawerBody}>
          {/* Metadata */}
          <div className={styles.drawerSection}>
            <div className={styles.drawerSectionHeader}>
              <div className={styles.drawerSectionTitle}>METADATA</div>
            </div>
            <div className={styles.sectionBody}>
              <label className={styles.fieldLabel}>NAME</label>
              <input className={styles.input} value={name}
                onChange={e => setName(e.target.value)}
                placeholder={`my-${kind.toLowerCase()}`}
                disabled={!isCreate} />
            </div>
          </div>

          {/* Rules panel */}
          <div className={styles.drawerSection} style={{ maxHeight: "500px" }}>
            <div className={styles.drawerSectionHeader}>
              <div className={styles.drawerSectionTitle}>RULES ({rules.length})</div>
              <button className={styles.addSmBtn} onClick={addRule}><Plus size={11} /> Add rule</button>
            </div>

            {/* Rule tabs */}
            <div className={styles.ruleTabs}>
              {rules.map((rule, i) => (
                <button key={rule.id} className={`${styles.ruleTab} ${activeRuleIdx === i ? styles.ruleTabActive : ''}`}
                  onClick={() => setActiveRuleIdx(i)}>
                  Rule {i + 1}
                  {rules.length > 1 && (
                    <span className={styles.removeRuleBtn}
                      onClick={e => { e.stopPropagation(); removeRule(i) }}>
                      <X size={9} />
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Active rule editor */}
            {activeRule && (
              <div className={styles.ruleEditor}>
                {/* Preset quick apply */}
                <div className={styles.presetApplyRow}>
                  <span className={styles.fieldLabel}>QUICK PRESET:</span>
                  {Object.entries(OIDC_ROLE_PRESETS).map(([key, preset]) => (
                    <button key={key} className={styles.presetApplyBtn}
                      style={{ color: preset.color, borderColor: preset.color + '30' }}
                      onClick={() => applyPreset(activeRuleIdx, key)}>
                      {preset.label}
                    </button>
                  ))}
                </div>

                {/* Resources */}
                <div className={styles.ruleEditorSection}>
                  <div className={styles.fieldLabel}>RESOURCES</div>
                  {COMMON_RESOURCES.map(group => (
                    <div key={group.group} className={styles.resourceGroup}>
                      <div className={styles.resourceGroupLabel}>{group.group}</div>
                      <div className={styles.resourceChips}>
                        {group.resources.map(res => {
                          const selected = activeRule.resources.includes(res)
                          return (
                            <button key={res}
                              className={`${styles.resourceToggle} ${selected ? styles.resourceToggleOn : ''}`}
                              onClick={() => toggleResource(activeRuleIdx, res, group.apiGroup)}>
                              {res}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                  <input className={`${styles.input} ${styles.customResourceInput}`}
                    placeholder="Custom resource (e.g. customresource.example.com)"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && e.target.value.trim()) {
                        updateRule(activeRuleIdx, 'resources', [...activeRule.resources, e.target.value.trim()])
                        e.target.value = ''
                      }
                    }} />
                </div>

                {/* API Groups */}
                <div className={styles.ruleEditorSection}>
                  <div className={styles.fieldLabel}>API GROUPS</div>
                  <div className={styles.apiGroupChips}>
                    {activeRule.apiGroups.map((g, gi) => (
                      <div key={gi} className={styles.apiGroupItem}>
                        <input className={`${styles.input} ${styles.apiGroupInput}`}
                          value={g} placeholder='core (leave empty)'
                          onChange={e => {
                            const newGroups = [...activeRule.apiGroups]
                            newGroups[gi] = e.target.value
                            updateRule(activeRuleIdx, 'apiGroups', newGroups)
                          }} />
                        {activeRule.apiGroups.length > 1 && (
                          <button className={styles.removeSmBtn} onClick={() =>
                            updateRule(activeRuleIdx, 'apiGroups', activeRule.apiGroups.filter((_, i) => i !== gi))}>
                            <X size={10} />
                          </button>
                        )}
                      </div>
                    ))}
                    <button className={styles.addSmBtn}
                      onClick={() => updateRule(activeRuleIdx, 'apiGroups', [...activeRule.apiGroups, ''])}>
                      <Plus size={10} /> Add group
                    </button>
                  </div>
                </div>

                {/* Verbs */}
                <div className={styles.ruleEditorSection}>
                  <div className={styles.fieldLabel}>VERBS</div>
                  <div className={styles.verbsGrid}>
                    {K8S_VERBS.map(verb => {
                      const selected = activeRule.verbs.includes(verb)
                      return (
                        <button key={verb}
                          className={`${styles.verbToggle} ${selected ? styles.verbToggleOn : ''}`}
                          style={selected ? { color: VERB_COLORS[verb], borderColor: VERB_COLORS[verb], background: VERB_COLORS[verb] + '18' } : {}}
                          onClick={() => toggleVerb(activeRuleIdx, verb)}>
                          {verb}
                        </button>
                      )
                    })}
                    <button className={`${styles.verbToggle} ${activeRule.verbs.includes('*') ? styles.verbToggleOn : ''}`}
                      style={activeRule.verbs.includes('*') ? { color: 'var(--accent-red)', borderColor: 'var(--accent-red)', background: 'rgba(239,68,68,0.18)' } : {}}
                      onClick={() => toggleVerb(activeRuleIdx, '*')}>
                      * (all)
                    </button>
                  </div>
                </div>

                {/* Resource Names */}
                <div className={styles.ruleEditorSection}>
                  <div className={styles.fieldLabel}>RESOURCE NAMES (optional)</div>
                  <div className={styles.resourceNamesList}>
                    {activeRule.resourceNames.map((n, ni) => (
                      <div key={ni} className={styles.resourceNameItem}>
                        <input className={`${styles.input} ${styles.resourceNameInput}`}
                          value={n}
                          onChange={e => {
                            const arr = [...activeRule.resourceNames]
                            arr[ni] = e.target.value
                            updateRule(activeRuleIdx, 'resourceNames', arr)
                          }} />
                        <button className={styles.removeSmBtn}
                          onClick={() => updateRule(activeRuleIdx, 'resourceNames',
                            activeRule.resourceNames.filter((_, i) => i !== ni))}>
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                    <button className={styles.addSmBtn}
                      onClick={() => updateRule(activeRuleIdx, 'resourceNames', [...activeRule.resourceNames, ''])}>
                      <Plus size={10} /> Add name
                    </button>
                  </div>
                  <div className={styles.fieldHint}>Giới hạn chỉ áp dụng với resource cụ thể (theo tên)</div>
                </div>
              </div>
            )}
          </div>

          {/* Labels */}
          <div className={styles.drawerSection}>
            <div className={styles.drawerSectionHeader}>
              <div className={styles.drawerSectionTitle}>LABELS</div>
              <button className={styles.addSmBtn}
                onClick={() => setLabels(l => [...l, { key: '', value: '' }])}>
                <Plus size={11} /> Add
              </button>
            </div>
            <div className={styles.sectionBody}>
              {labels.map((l, i) => (
                <div key={i} className={styles.labelRow}>
                  <input className={`${styles.input} ${styles.labelKeyInput}`}
                    placeholder="key" value={l.key}
                    onChange={e => setLabels(ls => ls.map((item, idx) => idx === i ? { ...item, key: e.target.value } : item))} />
                  <span className={styles.eq}>=</span>
                  <input className={`${styles.input} ${styles.labelValInput}`}
                    placeholder="value" value={l.value}
                    onChange={e => setLabels(ls => ls.map((item, idx) => idx === i ? { ...item, value: e.target.value } : item))} />
                  <button className={styles.removeSmBtn}
                    onClick={() => setLabels(ls => ls.filter((_, idx) => idx !== i))}>
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div className={styles.drawerError}
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
              <AlertCircle size={13} /> {error}
            </motion.div>
          )}
        </AnimatePresence>

        <div className={styles.drawerFooter}>
          <button className={styles.cancelBtn} onClick={onClose}>Huỷ</button>
          <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
            {saving
              ? <><span className={styles.spinner} /> Đang lưu...</>
              : <><Save size={13} /> {isCreate ? `Tạo ${kind}` : 'Lưu thay đổi'}</>}
          </button>
        </div>
      </motion.aside>
    </>
  )
}

// ── BindingDrawer ─────────────────────────────────────────────────────────────

function BindingDrawer({ mode, kind: initialKind, item, preset, namespace, getService, roles, clusterRoles, onClose, onSaved }) {
  const [name, setName] = useState(item?.metadata?.name || '')
  const [bindingKind, setBindingKind] = useState(initialKind || 'RoleBinding')
  const [roleRefKind, setRoleRefKind] = useState(item?.roleRef?.kind || 'Role')
  const [roleRefName, setRoleRefName] = useState(item?.roleRef?.name || preset?.k8sRole || '')
  const [subjects, setSubjects] = useState(
    item?.subjects || (preset ? [{ kind: preset.bindingType, name: preset.oidcRole, namespace: '' }] : [{ kind: 'Group', name: '', namespace: '' }])
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isCreate = mode === 'create'
  const isCluster = bindingKind === 'ClusterRoleBinding'

  const addSubject = () => setSubjects(s => [...s, { kind: 'Group', name: '', namespace: '' }])
  const removeSubject = (i) => setSubjects(s => s.filter((_, idx) => idx !== i))
  const updateSubject = (i, field, val) =>
    setSubjects(s => s.map((sub, idx) => idx === i ? { ...sub, [field]: val } : sub))

  const availableRoles = roleRefKind === 'ClusterRole' ? clusterRoles : roles

  const handleSave = async () => {
    if (!name.trim()) { setError('Name không được để trống'); return }
    if (!roleRefName) { setError('Chọn Role/ClusterRole'); return }
    const validSubjects = subjects.filter(s => s.name.trim())
    if (validSubjects.length === 0) { setError('Cần ít nhất 1 subject'); return }

    const svc = getService()
    if (!svc) { setError('Chưa kết nối cluster'); return }

    const manifest = {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: bindingKind,
      metadata: {
        name: name.trim(),
        ...(isCluster ? {} : { namespace }),
        labels: { 'app.kubernetes.io/managed-by': 'ms-manager' },
      },
      roleRef: {
        apiGroup: 'rbac.authorization.k8s.io',
        kind: roleRefKind,
        name: roleRefName,
      },
      subjects: validSubjects.map(s => ({
        kind: s.kind,
        name: s.name.trim(),
        ...(s.kind === 'ServiceAccount' && s.namespace ? { namespace: s.namespace } : {}),
      })),
    }

    setSaving(true); setError('')
    try {
      const basePath = isCluster
        ? `/apis/rbac.authorization.k8s.io/v1/clusterrolebindings`
        : `/apis/rbac.authorization.k8s.io/v1/namespaces/${namespace}/rolebindings`

      if (isCreate) {
        await svc._call(basePath, 'POST', manifest)
      } else {
        await svc._call(`${basePath}/${name}`, 'PUT', manifest)
      }
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <motion.div className={styles.drawerBackdrop}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose} />
      <motion.aside className={styles.drawer}
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 36 }}>

        <div className={styles.drawerHeader}>
          <div className={styles.drawerHeaderLeft}>
            <Link size={14} color="var(--accent-green)" />
            <span className={styles.drawerTitle}>
              {isCreate ? 'Tạo Binding' : `Sửa: ${item?.metadata?.name}`}
            </span>
          </div>
          <button className={styles.closeDrawerBtn} onClick={onClose}><X size={14} /></button>
        </div>

        <div className={styles.drawerBody}>
          {/* Preset notice */}
          {preset && (
            <div className={styles.presetNotice}>
              <Info size={12} color="var(--accent-cyan)" />
              <span>Tạo từ OIDC mapping: <strong>{preset.oidcRole}</strong> → <strong>{preset.k8sRole}</strong></span>
            </div>
          )}

          {/* Basic info */}
          <div className={styles.drawerSection}>
            <div className={styles.drawerSectionHeader}>
              <div className={styles.drawerSectionTitle}>METADATA</div>
            </div>
            <div className={styles.sectionBody}>
              <div className={styles.formRow}>
                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>BINDING KIND</label>
                  <select className={styles.input} value={bindingKind}
                    onChange={e => setBindingKind(e.target.value)}
                    disabled={!isCreate}>
                    <option value="RoleBinding">RoleBinding (namespace-scoped)</option>
                    <option value="ClusterRoleBinding">ClusterRoleBinding (cluster-scoped)</option>
                  </select>
                </div>
                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>NAME</label>
                  <input className={styles.input} value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="my-binding" disabled={!isCreate} />
                </div>
              </div>
            </div>
          </div>

          {/* Role Ref */}
          <div className={styles.drawerSection}>
            <div className={styles.drawerSectionHeader}>
              <div className={styles.drawerSectionTitle}>ROLE REF</div>
            </div>
            <div className={styles.sectionBody}>
              <div className={styles.formRow}>
                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>KIND</label>
                  <select className={styles.input} value={roleRefKind}
                    onChange={e => { setRoleRefKind(e.target.value); setRoleRefName('') }}
                    disabled={!isCreate}>
                    <option value="Role">Role</option>
                    <option value="ClusterRole">ClusterRole</option>
                  </select>
                </div>
                <div className={styles.formField}>
                  <label className={styles.fieldLabel}>NAME</label>
                  <select className={styles.input} value={roleRefName}
                    onChange={e => setRoleRefName(e.target.value)}
                    disabled={!isCreate}>
                    <option value="">-- Chọn {roleRefKind} --</option>
                    {availableRoles.map(r => (
                      <option key={r.metadata?.name} value={r.metadata?.name}>{r.metadata?.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className={styles.fieldHint}>RoleRef không thể thay đổi sau khi tạo (K8s immutable field)</div>
            </div>
          </div>

          {/* Subjects */}
          <div className={styles.drawerSection}>
            <div className={styles.drawerSectionHeader}>
              <div className={styles.drawerSectionHeader}>
                <div className={styles.drawerSectionTitle}>SUBJECTS ({subjects.length})</div>
              </div>
              <button className={styles.addSmBtn} onClick={addSubject}>
                <Plus size={11} /> Add subject
              </button>
            </div>
            <div className={styles.sectionBody}>
              {subjects.map((s, i) => (
                <div key={i} className={styles.subjectEditor}>
                  <div className={styles.subjectEditorRow}>
                    <div className={styles.formField}>
                      <label className={styles.fieldLabel}>KIND</label>
                      <select className={styles.input} value={s.kind}
                        onChange={e => updateSubject(i, 'kind', e.target.value)}>
                        <option value="Group">Group</option>
                        <option value="User">User</option>
                        <option value="ServiceAccount">ServiceAccount</option>
                      </select>
                    </div>
                    <div className={`${styles.formField} ${styles.flexGrow}`}>
                      <label className={styles.fieldLabel}>NAME</label>
                      <input className={styles.input} value={s.name}
                        placeholder={
                          s.kind === 'Group' ? 'e.g. ROLE_ADMIN, k8s-dev-team' :
                          s.kind === 'User' ? 'e.g. user@example.com' :
                          'service-account-name'
                        }
                        onChange={e => updateSubject(i, 'name', e.target.value)} />
                    </div>
                    {s.kind === 'ServiceAccount' && (
                      <div className={styles.formField}>
                        <label className={styles.fieldLabel}>NAMESPACE</label>
                        <input className={styles.input} value={s.namespace || ''}
                          placeholder="default"
                          onChange={e => updateSubject(i, 'namespace', e.target.value)} />
                      </div>
                    )}
                    {subjects.length > 1 && (
                      <button className={styles.removeSmBtn} onClick={() => removeSubject(i)}
                        style={{ marginTop: 20 }}>
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                  {s.kind === 'Group' && (
                    <div className={styles.subjectHint}>
                      Group name phải khớp với OIDC <code>roles[]</code> hoặc <code>groups[]</code> claim trong JWT
                    </div>
                  )}
                  {s.kind === 'User' && (
                    <div className={styles.subjectHint}>
                      User name phải khớp với <code>sub</code> hoặc <code>email</code> claim trong JWT
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <AnimatePresence>
          {error && (
            <motion.div className={styles.drawerError}
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
              <AlertCircle size={13} /> {error}
            </motion.div>
          )}
        </AnimatePresence>

        <div className={styles.drawerFooter}>
          <button className={styles.cancelBtn} onClick={onClose}>Huỷ</button>
          <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
            {saving
              ? <><span className={styles.spinner} /> Đang lưu...</>
              : <><Save size={13} /> {isCreate ? 'Tạo Binding' : 'Lưu thay đổi'}</>}
          </button>
        </div>
      </motion.aside>
    </>
  )
}
