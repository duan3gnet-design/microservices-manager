import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  GitBranch, Plus, Trash2, Search, RefreshCw, AlertCircle,
  Edit3, X, Save, Eye, Copy, Check, Shuffle, Shield, Globe, Layers, Zap, ArrowRight, AlertTriangle, Network,
} from 'lucide-react'
import { useK8sStore } from '@/store'
import { useK8sService } from '@/hooks/useAuth'
import styles from './IstioPolicyPage.module.css'

// ── Resource type config ───────────────────────────────────────────────────────
const RESOURCE_TYPES = {
  virtualservice: {
    label: 'Virtual Service',
    icon: Shuffle,
    color: 'var(--accent-blue)',
    desc: 'Traffic routing, retry, timeout, fault injection',
    apiGroup: 'networking.istio.io/v1beta1',
  },
  destinationrule: {
    label: 'Destination Rule',
    icon: Layers,
    color: 'var(--accent-cyan)',
    desc: 'Load balancing, circuit breaker, mTLS, subsets',
    apiGroup: 'networking.istio.io/v1beta1',
  },
  gateway: {
    label: 'Gateway',
    icon: Globe,
    color: 'var(--accent-green)',
    desc: 'Ingress/egress gateway configuration',
    apiGroup: 'networking.istio.io/v1beta1',
  },
  peerauthentication: {
    label: 'Peer Authentication',
    icon: Shield,
    color: 'var(--accent-purple)',
    desc: 'mTLS policy cho service-to-service',
    apiGroup: 'security.istio.io/v1beta1',
  },
  serviceentry: {
    label: 'Service Entry',
    icon: Network,
    color: 'var(--accent-amber)',
    desc: 'Đăng ký external services vào mesh',
    apiGroup: 'networking.istio.io/v1beta1',
  },
}

// ── YAML serializer (simple) ───────────────────────────────────────────────────
function toYaml(obj, indent = 0) {
  const pad = ' '.repeat(indent)
  if (obj === null || obj === undefined) return 'null'
  if (typeof obj === 'boolean' || typeof obj === 'number') return String(obj)
  if (typeof obj === 'string') {
    if (/[:#\n\[\]{},]/.test(obj) || obj === '') return `"${obj.replace(/"/g, '\\"')}"`
    return obj
  }
  if (Array.isArray(obj)) {
    if (!obj.length) return '[]'
    return obj.map(item => {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        const lines = toYaml(item, indent + 2).split('\n')
        return `${pad}- ${lines[0].trimStart()}\n${lines.slice(1).join('\n')}`
      }
      return `${pad}- ${toYaml(item, indent)}`
    }).join('\n')
  }
  if (typeof obj === 'object') {
    const entries = Object.entries(obj)
    if (!entries.length) return '{}'
    return entries.map(([k, v]) => {
      if ((typeof v === 'object' && v !== null) && Object.keys(v).length > 0) {
        return `${pad}${k}:\n${toYaml(v, indent + 2)}`
      }
      if (Array.isArray(v) && v.length > 0) {
        return `${pad}${k}:\n${toYaml(v, indent + 2)}`
      }
      return `${pad}${k}: ${toYaml(v)}`
    }).join('\n')
  }
  return String(obj)
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function IstioPolicyPage() {
  const getService = useK8sService()
  const { selectedNamespace } = useK8sStore()

  const [activeType, setActiveType]   = useState('virtualservice')
  const [resources,  setResources]    = useState({})   // { [type]: [] }
  const [loading,    setLoading]      = useState(false)
  const [error,      setError]        = useState('')
  const [istioStatus, setIstioStatus] = useState(null) // null | { installed, error? }
  const [search,     setSearch]       = useState('')
  const [drawer,     setDrawer]       = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // ── Check Istio ─────────────────────────────────────────────────────────────
  const checkIstio = useCallback(async () => {
    const svc = getService()
    if (!svc) return
    const status = await svc.checkIstioInstalled()
    setIstioStatus(status)
  }, [getService])

  // ── Fetch resources ─────────────────────────────────────────────────────────
  const fetchResources = useCallback(async (type = activeType) => {
    const svc = getService()
    if (!svc) { setError('Chưa kết nối cluster'); return }
    setLoading(true); setError('')
    try {
      let items = []
      if (type === 'virtualservice')    items = await svc.getVirtualServices(selectedNamespace)
      if (type === 'destinationrule')   items = await svc.getDestinationRules(selectedNamespace)
      if (type === 'gateway')           items = await svc.getGateways(selectedNamespace)
      if (type === 'peerauthentication') items = await svc.getPeerAuthentications(selectedNamespace)
      if (type === 'serviceentry')      items = await svc.getServiceEntries(selectedNamespace)
      setResources(r => ({ ...r, [type]: items }))
    } catch (e) {
      if (e.message?.includes('404') || e.message?.includes('not found')) {
        setResources(r => ({ ...r, [type]: [] }))
        if (!istioStatus) setIstioStatus({ installed: false })
      } else {
        setError(e.message)
      }
    } finally {
      setLoading(false) }
  }, [getService, selectedNamespace, activeType, istioStatus])

  useEffect(() => { checkIstio() }, [checkIstio])
  useEffect(() => { fetchResources(activeType) }, [activeType, selectedNamespace])

  const handleDelete = async ({ type, name }) => {
    const svc = getService(); if (!svc) return
    setDeleteLoading(true)
    try {
      if (type === 'virtualservice')     await svc.deleteVirtualService(name, selectedNamespace)
      if (type === 'destinationrule')    await svc.deleteDestinationRule(name, selectedNamespace)
      if (type === 'gateway')            await svc.deleteGateway(name, selectedNamespace)
      if (type === 'peerauthentication') await svc.deletePeerAuthentication(name, selectedNamespace)
      if (type === 'serviceentry')       await svc.deleteServiceEntry(name, selectedNamespace)
      await fetchResources(type)
      setDeleteTarget(null)
    } catch (e) { setError(e.message) }
    finally { setDeleteLoading(false) }
  }

  const currentItems = (resources[activeType] || []).filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase())
  )
  const typeMeta = RESOURCE_TYPES[activeType]

  return (
    <div className={styles.root}>
      {/* Header */}
      <div className={styles.pageHeader}>
        <div className={styles.pageTitle}>
          <GitBranch size={16} color="var(--accent-blue)" />
          <span>Istio Service Mesh</span>
          <span className={styles.nsBadge}>{selectedNamespace}</span>
          {istioStatus !== null && (
            <span className={`${styles.istioStatus} ${istioStatus.installed ? styles.istioOk : styles.istioMissing}`}>
              {istioStatus.installed ? '● Istio installed' : '○ Istio not found'}
            </span>
          )}
        </div>
        <div className={styles.headerActions}>
          <div className={styles.searchWrap}>
            <Search size={12} />
            <input className={styles.search} placeholder={`Tìm ${typeMeta.label}...`}
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className={styles.iconBtn} onClick={() => fetchResources(activeType)} disabled={loading} title="Refresh">
            <RefreshCw size={14} className={loading ? styles.spin : ''} />
          </button>
          <button className={styles.primaryBtn} onClick={() => setDrawer({ mode: 'create', type: activeType })}>
            <Plus size={13} /> Tạo mới
          </button>
        </div>
      </div>

      {/* Resource type tabs */}
      <div className={styles.typeTabs}>
        {Object.entries(RESOURCE_TYPES).map(([key, meta]) => {
          const Icon = meta.icon
          const count = (resources[key] || []).length
          return (
            <button key={key}
              className={`${styles.typeTab} ${activeType === key ? styles.typeTabActive : ''}`}
              style={activeType === key ? { borderBottomColor: meta.color, color: meta.color } : {}}
              onClick={() => { setActiveType(key); setSearch('') }}
            >
              <Icon size={13} />
              <span>{meta.label}</span>
              {count > 0 && <span className={styles.typeTabCount}>{count}</span>}
            </button>
          )
        })}
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

      {/* Istio not installed warning */}
      {istioStatus?.installed === false && (
        <div className={styles.istioWarning}>
          <AlertTriangle size={14} />
          <span>Istio CRD chưa được cài đặt trong cluster này. Cài Istio trước khi tạo resources.</span>
          <code className={styles.installCmd}>istioctl install --set profile=default</code>
        </div>
      )}

      {/* Content */}
      <div className={styles.content}>
        {loading && currentItems.length === 0 ? (
          <div className={styles.loadingState}>
            <div className={styles.loadingSpinner} />
            <span>Đang tải {typeMeta.label}...</span>
          </div>
        ) : currentItems.length === 0 ? (
          <div className={styles.emptyState}>
            {(() => { const I = typeMeta.icon; return <I size={32} color="var(--text-muted)" style={{ opacity: 0.3 }} /> })()}
            <span>{search ? 'Không tìm thấy' : `Chưa có ${typeMeta.label}`}</span>
            <span className={styles.emptyHint}>{typeMeta.desc}</span>
          </div>
        ) : (
          <div className={styles.resourceGrid}>
            <AnimatePresence initial={false}>
              {currentItems.map((item, i) => (
                <ResourceCard key={item.name}
                  item={item} type={activeType} typeMeta={typeMeta} index={i}
                  onView={() => setDrawer({ mode: 'view', type: activeType, item })}
                  onEdit={() => setDrawer({ mode: 'edit', type: activeType, item })}
                  onDelete={() => setDeleteTarget({ type: activeType, name: item.name })}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Drawer */}
      <AnimatePresence>
        {drawer && (
          <ResourceDrawer
            mode={drawer.mode} type={drawer.type} item={drawer.item}
            namespace={selectedNamespace} getService={getService}
            services={resources._services || []}
            onClose={() => setDrawer(null)}
            onSaved={() => { setDrawer(null); fetchResources(drawer.type) }}
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
              <h3 className={styles.dialogTitle}>Xoá {RESOURCE_TYPES[deleteTarget.type]?.label}?</h3>
              <p className={styles.dialogBody}>
                Resource <code className={styles.nameCode}>{deleteTarget.name}</code> sẽ bị xoá.
                Traffic routing có thể bị ảnh hưởng ngay lập tức.
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

// ── ResourceCard ───────────────────────────────────────────────────────────────
function ResourceCard({ item, type, typeMeta, index, onView, onEdit, onDelete }) {
  const Icon = typeMeta.icon

  const renderSummary = () => {
    if (type === 'virtualservice') {
      const routes = item.http?.flatMap(r => r.route || []) || []
      return (
        <div className={styles.cardDetails}>
          <DetailRow label="Hosts" value={(item.hosts || []).join(', ')} />
          {item.gateways?.length > 0 && <DetailRow label="Gateways" value={item.gateways.join(', ')} />}
          {item.http?.length > 0 && (
            <div className={styles.routeList}>
              {item.http.slice(0, 3).map((route, i) => (
                <div key={i} className={styles.routeItem}>
                  <span className={styles.routeMatch}>
                    {route.match?.[0]?.uri
                      ? `${Object.keys(route.match[0].uri)[0]}: ${Object.values(route.match[0].uri)[0]}`
                      : 'default'}
                  </span>
                  <ArrowRight size={10} color="var(--text-muted)" />
                  <span className={styles.routeDest}>
                    {(route.route || []).map(r => `${r.destination?.host}${r.weight !== undefined ? ` ${r.weight}%` : ''}`).join(' | ')}
                  </span>
                </div>
              ))}
              {item.http.length > 3 && <div className={styles.moreRoutes}>+{item.http.length - 3} more</div>}
            </div>
          )}
        </div>
      )
    }
    if (type === 'destinationrule') {
      const cb = item.trafficPolicy?.outlierDetection
      const lb = item.trafficPolicy?.loadBalancer?.simple
      return (
        <div className={styles.cardDetails}>
          <DetailRow label="Host" value={item.host} mono />
          {lb && <DetailRow label="LB" value={lb} />}
          {item.subsets?.length > 0 && (
            <div className={styles.subsetList}>
              {item.subsets.map(s => (
                <span key={s.name} className={styles.subsetChip}>{s.name}</span>
              ))}
            </div>
          )}
          {cb && <span className={styles.cbBadge}><Zap size={10} /> Circuit Breaker</span>}
          {item.trafficPolicy?.tls && (
            <span className={styles.mtlsBadge}><Shield size={10} /> {item.trafficPolicy.tls.mode}</span>
          )}
        </div>
      )
    }
    if (type === 'gateway') {
      return (
        <div className={styles.cardDetails}>
          <DetailRow label="Selector" value={Object.entries(item.selector || {}).map(([k,v]) => `${k}=${v}`).join(', ')} />
          {item.servers?.slice(0, 3).map((s, i) => (
            <div key={i} className={styles.serverRow}>
              <span className={styles.serverPort}>{s.port?.protocol}/{s.port?.number}</span>
              <span className={styles.serverHost}>{(s.hosts || []).join(', ')}</span>
              {s.tls?.mode && <span className={styles.tlsMode}>{s.tls.mode}</span>}
            </div>
          ))}
        </div>
      )
    }
    if (type === 'peerauthentication') {
      const mode = item.mtls?.mode || 'UNSET'
      return (
        <div className={styles.cardDetails}>
          <div className={`${styles.mtlsModeBadge} ${
            mode === 'STRICT' ? styles.mtlsStrict
            : mode === 'PERMISSIVE' ? styles.mtlsPermissive
            : styles.mtlsDisable
          }`}>
            <Shield size={11} />
            {mode === 'STRICT' ? 'mTLS STRICT' : mode === 'PERMISSIVE' ? 'mTLS PERMISSIVE' : mode}
          </div>
          {item.selector && (
            <DetailRow label="Selector" value={
              Object.entries(item.selector?.matchLabels || {}).map(([k,v]) => `${k}=${v}`).join(', ') || 'All pods'
            } />
          )}
          {Object.keys(item.portLevelMtls || {}).length > 0 && (
            <DetailRow label="Port overrides" value={`${Object.keys(item.portLevelMtls).length} ports`} />
          )}
        </div>
      )
    }
    if (type === 'serviceentry') {
      return (
        <div className={styles.cardDetails}>
          <DetailRow label="Hosts" value={(item.hosts || []).join(', ')} />
          <DetailRow label="Resolution" value={item.resolution} />
          {item.ports?.slice(0, 3).map((p, i) => (
            <span key={i} className={styles.portChip}>{p.protocol}/{p.number}</span>
          ))}
        </div>
      )
    }
    return null
  }

  return (
    <motion.div className={styles.resourceCard}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.04, 0.3) }}
      onClick={onView}
    >
      <div className={styles.cardHeader}>
        <div className={styles.cardTitleRow}>
          <Icon size={13} color={typeMeta.color} />
          <span className={styles.cardName}>{item.name}</span>
        </div>
        <div className={styles.cardActions}>
          <button className={styles.cardActionBtn} title="Edit" onClick={e => { e.stopPropagation(); onEdit() }}>
            <Edit3 size={12} />
          </button>
          <button className={`${styles.cardActionBtn} ${styles.cardDeleteBtn}`} title="Delete"
            onClick={e => { e.stopPropagation(); onDelete() }}>
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {renderSummary()}

      <div className={styles.cardFooter}>
        {item.createdAt ? new Date(item.createdAt).toLocaleString('vi-VN') : '—'}
      </div>
    </motion.div>
  )
}

function DetailRow({ label, value, mono }) {
  return (
    <div className={styles.detailRow}>
      <span className={styles.detailLabel}>{label}</span>
      <span className={`${styles.detailValue} ${mono ? styles.detailMono : ''}`}>{value || '—'}</span>
    </div>
  )
}

// ── ResourceDrawer ─────────────────────────────────────────────────────────────
function ResourceDrawer({ mode: initMode, type, item, namespace, getService, onClose, onSaved }) {
  const [mode, setMode]     = useState(initMode)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [activeTab, setActiveTab] = useState('form') // 'form' | 'yaml'
  const [copied, setCopied] = useState(false)

  const typeMeta = RESOURCE_TYPES[type]
  const isView  = mode === 'view'
  const canEdit = mode === 'edit' || mode === 'create'
  const isCreate = mode === 'create'

  // ── Form state per type ────────────────────────────────────────────────────
  const [form, setForm] = useState(() => buildDefaultForm(type, item))

  const setF = (key, val) => setForm(f => ({ ...f, [key]: val }))

  // ── Build manifest từ form ─────────────────────────────────────────────────
  const buildManifest = () => buildManifestFromForm(type, form, namespace)

  const yamlStr = (() => {
    try { return toYaml(buildManifest()) } catch { return '# form incomplete' }
  })()

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.name?.trim()) { setError('Name không được để trống'); return }
    const svc = getService(); if (!svc) { setError('Chưa kết nối cluster'); return }
    setSaving(true); setError('')
    try {
      const manifest = buildManifest()
      if (isCreate) {
        if (type === 'virtualservice')     await svc.createVirtualService(manifest, namespace)
        if (type === 'destinationrule')    await svc.createDestinationRule(manifest, namespace)
        if (type === 'gateway')            await svc.createGateway(manifest, namespace)
        if (type === 'peerauthentication') await svc.createPeerAuthentication(manifest, namespace)
        if (type === 'serviceentry')       await svc.createServiceEntry(manifest, namespace)
      } else {
        if (type === 'virtualservice')     await svc.updateVirtualService(form.name, manifest, namespace)
        if (type === 'destinationrule')    await svc.updateDestinationRule(form.name, manifest, namespace)
        if (type === 'gateway')            await svc.updateGateway(form.name, manifest, namespace)
        if (type === 'peerauthentication') await svc.updatePeerAuthentication(form.name, manifest, namespace)
        if (type === 'serviceentry')       await svc.updateServiceEntry(form.name, manifest, namespace)
      }
      onSaved()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const copyYaml = async () => {
    await navigator.clipboard.writeText(yamlStr)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const Icon = typeMeta.icon

  return (
    <>
      <motion.div className={styles.drawerBackdrop}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.aside className={styles.drawer}
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 36 }}>

        {/* Header */}
        <div className={styles.drawerHeader}>
          <div className={styles.drawerHeaderLeft}>
            <Icon size={14} color={typeMeta.color} />
            <span className={styles.drawerTitle}>
              {isCreate ? `Tạo ${typeMeta.label}` : item?.name}
            </span>
            {!isCreate && (
              <span className={styles.typePill} style={{ color: typeMeta.color, borderColor: typeMeta.color + '50' }}>
                {typeMeta.label}
              </span>
            )}
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

        {/* Tabs */}
        <div className={styles.drawerTabs}>
          <button className={`${styles.drawerTab} ${activeTab === 'form' ? styles.drawerTabActive : ''}`}
            onClick={() => setActiveTab('form')}>Form</button>
          <button className={`${styles.drawerTab} ${activeTab === 'yaml' ? styles.drawerTabActive : ''}`}
            onClick={() => setActiveTab('yaml')}>
            YAML Preview
            <button className={styles.copyYamlBtn} onClick={e => { e.stopPropagation(); copyYaml() }}>
              {copied ? <Check size={10} /> : <Copy size={10} />}
            </button>
          </button>
        </div>

        {/* Body */}
        <div className={styles.drawerBody}>
          {activeTab === 'yaml' ? (
            <pre className={styles.yamlPreview}>{yamlStr}</pre>
          ) : (
            <FormByType type={type} form={form} setF={setF} canEdit={canEdit} isCreate={isCreate} item={item} />
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
                : <><Save size={13} /> {isCreate ? `Tạo ${typeMeta.label}` : 'Lưu thay đổi'}</>
              }
            </button>
          </div>
        )}
      </motion.aside>
    </>
  )
}

// ── Form per resource type ─────────────────────────────────────────────────────
function FormByType({ type, form, setF, canEdit, isCreate, item }) {

  if (type === 'virtualservice') return (
    <VirtualServiceForm form={form} setF={setF} canEdit={canEdit} isCreate={isCreate} />
  )
  if (type === 'destinationrule') return (
    <DestinationRuleForm form={form} setF={setF} canEdit={canEdit} isCreate={isCreate} />
  )
  if (type === 'gateway') return (
    <GatewayForm form={form} setF={setF} canEdit={canEdit} isCreate={isCreate} />
  )
  if (type === 'peerauthentication') return (
    <PeerAuthForm form={form} setF={setF} canEdit={canEdit} isCreate={isCreate} />
  )
  if (type === 'serviceentry') return (
    <ServiceEntryForm form={form} setF={setF} canEdit={canEdit} isCreate={isCreate} />
  )
  return null
}

// ── VirtualService Form ────────────────────────────────────────────────────────
function VirtualServiceForm({ form, setF, canEdit, isCreate }) {
  const addRoute = () => setF('httpRoutes', [
    ...form.httpRoutes,
    { id: Date.now(), matchUri: '', matchType: 'prefix', destinations: [{ host: '', subset: '', weight: 100 }], retries: null, timeout: '' }
  ])
  const removeRoute = id => setF('httpRoutes', form.httpRoutes.filter(r => r.id !== id))
  const updateRoute = (id, key, val) => setF('httpRoutes', form.httpRoutes.map(r => r.id === id ? { ...r, [key]: val } : r))
  const updateDest = (routeId, idx, key, val) => setF('httpRoutes', form.httpRoutes.map(r =>
    r.id === routeId ? { ...r, destinations: r.destinations.map((d, i) => i === idx ? { ...d, [key]: val } : d) } : r
  ))
  const addDest = routeId => setF('httpRoutes', form.httpRoutes.map(r =>
    r.id === routeId ? { ...r, destinations: [...r.destinations, { host: '', subset: '', weight: 0 }] } : r
  ))
  const removeDest = (routeId, idx) => setF('httpRoutes', form.httpRoutes.map(r =>
    r.id === routeId ? { ...r, destinations: r.destinations.filter((_, i) => i !== idx) } : r
  ))

  return (
    <div className={styles.formContent}>
      <DS title="METADATA">
        <FRow label="NAME">
          <input className={styles.input} value={form.name} disabled={!isCreate}
            onChange={e => setF('name', e.target.value)} placeholder="my-virtual-service" />
        </FRow>
      </DS>

      <DS title="HOSTS & GATEWAYS">
        <FRow label="HOSTS (comma separated)">
          <input className={styles.input} value={form.hosts} disabled={!canEdit}
            onChange={e => setF('hosts', e.target.value)} placeholder="reviews, ratings.prod.svc.cluster.local" />
        </FRow>
        <FRow label="GATEWAYS (optional)">
          <input className={styles.input} value={form.gateways} disabled={!canEdit}
            onChange={e => setF('gateways', e.target.value)} placeholder="my-gateway (leave empty for mesh-internal)" />
        </FRow>
      </DS>

      <DS title="HTTP ROUTES"
        action={canEdit && <button className={styles.addSmBtn} onClick={addRoute}><Plus size={11} /> Add Route</button>}>
        {form.httpRoutes.length === 0 && <div className={styles.emptyHintText}>Chưa có route</div>}
        {form.httpRoutes.map((route, ri) => (
          <div key={route.id} className={styles.routeBox}>
            <div className={styles.routeBoxHeader}>
              <span className={styles.routeNum}>Route {ri + 1}</span>
              {canEdit && <button className={styles.removeSmBtn} onClick={() => removeRoute(route.id)}><X size={11} /></button>}
            </div>
            <div className={styles.routeBoxBody}>
              {/* Match */}
              <div className={styles.inlineRow}>
                <span className={styles.inlineLabel}>Match URI</span>
                <select className={styles.selectSm} value={route.matchType} disabled={!canEdit}
                  onChange={e => updateRoute(route.id, 'matchType', e.target.value)}>
                  <option value="prefix">prefix</option>
                  <option value="exact">exact</option>
                  <option value="regex">regex</option>
                </select>
                <input className={styles.inputFlex} value={route.matchUri} disabled={!canEdit}
                  onChange={e => updateRoute(route.id, 'matchUri', e.target.value)} placeholder="/api/v1" />
              </div>

              {/* Destinations */}
              <div className={styles.destSection}>
                <div className={styles.destHeader}>
                  <span className={styles.inlineLabel}>Destinations</span>
                  {canEdit && <button className={styles.addSmBtn} onClick={() => addDest(route.id)}><Plus size={10} /> Add</button>}
                </div>
                {route.destinations.map((dest, di) => (
                  <div key={di} className={styles.destRow}>
                    <input className={styles.destInput} value={dest.host} disabled={!canEdit} placeholder="service-host"
                      onChange={e => updateDest(route.id, di, 'host', e.target.value)} />
                    <input className={styles.destInputSm} value={dest.subset} disabled={!canEdit} placeholder="subset"
                      onChange={e => updateDest(route.id, di, 'subset', e.target.value)} />
                    <input className={styles.destInputXs} value={dest.weight} disabled={!canEdit} placeholder="100" type="number"
                      onChange={e => updateDest(route.id, di, 'weight', e.target.value)} />
                    <span className={styles.weightPct}>%</span>
                    {canEdit && route.destinations.length > 1 && (
                      <button className={styles.removeSmBtn} onClick={() => removeDest(route.id, di)}><X size={10} /></button>
                    )}
                  </div>
                ))}
              </div>

              {/* Timeout */}
              <div className={styles.inlineRow}>
                <span className={styles.inlineLabel}>Timeout</span>
                <input className={styles.inputSm} value={route.timeout} disabled={!canEdit} placeholder="5s"
                  onChange={e => updateRoute(route.id, 'timeout', e.target.value)} />
              </div>

              {/* Retry */}
              <div className={styles.inlineRow}>
                <span className={styles.inlineLabel}>Retry attempts</span>
                <input className={styles.inputSm} type="number" value={route.retries || ''} disabled={!canEdit} placeholder="3"
                  onChange={e => updateRoute(route.id, 'retries', e.target.value || null)} />
              </div>
            </div>
          </div>
        ))}
      </DS>
    </div>
  )
}

// ── DestinationRule Form ───────────────────────────────────────────────────────
function DestinationRuleForm({ form, setF, canEdit, isCreate }) {
  const addSubset = () => setF('subsets', [...form.subsets, { id: Date.now(), name: '', labelKey: '', labelValue: '' }])
  const removeSubset = id => setF('subsets', form.subsets.filter(s => s.id !== id))
  const updateSubset = (id, k, v) => setF('subsets', form.subsets.map(s => s.id === id ? { ...s, [k]: v } : s))

  return (
    <div className={styles.formContent}>
      <DS title="METADATA">
        <FRow label="NAME">
          <input className={styles.input} value={form.name} disabled={!isCreate}
            onChange={e => setF('name', e.target.value)} placeholder="reviews-destination-rule" />
        </FRow>
      </DS>

      <DS title="HOST">
        <FRow label="HOST">
          <input className={styles.input} value={form.host} disabled={!canEdit}
            onChange={e => setF('host', e.target.value)} placeholder="reviews.prod.svc.cluster.local" />
        </FRow>
      </DS>

      <DS title="TRAFFIC POLICY">
        <FRow label="LOAD BALANCER">
          <select className={styles.input} value={form.lbPolicy} disabled={!canEdit}
            onChange={e => setF('lbPolicy', e.target.value)}>
            <option value="">Default</option>
            <option value="ROUND_ROBIN">ROUND_ROBIN</option>
            <option value="LEAST_CONN">LEAST_CONN</option>
            <option value="RANDOM">RANDOM</option>
            <option value="PASSTHROUGH">PASSTHROUGH</option>
          </select>
        </FRow>
        <FRow label="MTLS MODE">
          <select className={styles.input} value={form.tlsMode} disabled={!canEdit}
            onChange={e => setF('tlsMode', e.target.value)}>
            <option value="">None</option>
            <option value="ISTIO_MUTUAL">ISTIO_MUTUAL</option>
            <option value="MUTUAL">MUTUAL</option>
            <option value="SIMPLE">SIMPLE</option>
            <option value="DISABLE">DISABLE</option>
          </select>
        </FRow>

        {/* Circuit Breaker */}
        <div className={styles.cbToggleRow}>
          <label className={styles.toggleLabel}>
            <input type="checkbox" checked={form.enableCB} disabled={!canEdit}
              onChange={e => setF('enableCB', e.target.checked)} />
            <span>Enable Circuit Breaker</span>
          </label>
        </div>
        {form.enableCB && (
          <div className={styles.cbFields}>
            <div className={styles.inlineRow}>
              <span className={styles.inlineLabel}>Consecutive errors</span>
              <input className={styles.inputSm} type="number" value={form.cbErrors} disabled={!canEdit}
                onChange={e => setF('cbErrors', e.target.value)} placeholder="5" />
            </div>
            <div className={styles.inlineRow}>
              <span className={styles.inlineLabel}>Interval</span>
              <input className={styles.inputSm} value={form.cbInterval} disabled={!canEdit}
                onChange={e => setF('cbInterval', e.target.value)} placeholder="1s" />
            </div>
            <div className={styles.inlineRow}>
              <span className={styles.inlineLabel}>Base ejection time</span>
              <input className={styles.inputSm} value={form.cbEjectTime} disabled={!canEdit}
                onChange={e => setF('cbEjectTime', e.target.value)} placeholder="30s" />
            </div>
            <div className={styles.inlineRow}>
              <span className={styles.inlineLabel}>Max ejection %</span>
              <input className={styles.inputSm} type="number" value={form.cbMaxEject} disabled={!canEdit}
                onChange={e => setF('cbMaxEject', e.target.value)} placeholder="50" />
            </div>
          </div>
        )}
      </DS>

      <DS title="SUBSETS"
        action={canEdit && <button className={styles.addSmBtn} onClick={addSubset}><Plus size={11} /> Add</button>}>
        {form.subsets.length === 0 && <div className={styles.emptyHintText}>Chưa có subset</div>}
        {form.subsets.map(s => (
          <div key={s.id} className={styles.subsetRow}>
            <input className={styles.subsetInput} value={s.name} disabled={!canEdit} placeholder="v1"
              onChange={e => updateSubset(s.id, 'name', e.target.value)} />
            <input className={styles.subsetInput} value={s.labelKey} disabled={!canEdit} placeholder="label key"
              onChange={e => updateSubset(s.id, 'labelKey', e.target.value)} />
            <span className={styles.eq}>=</span>
            <input className={styles.subsetInput} value={s.labelValue} disabled={!canEdit} placeholder="label value"
              onChange={e => updateSubset(s.id, 'labelValue', e.target.value)} />
            {canEdit && <button className={styles.removeSmBtn} onClick={() => removeSubset(s.id)}><X size={11} /></button>}
          </div>
        ))}
      </DS>
    </div>
  )
}

// ── Gateway Form ───────────────────────────────────────────────────────────────
function GatewayForm({ form, setF, canEdit, isCreate }) {
  const addServer = () => setF('servers', [
    ...form.servers,
    { id: Date.now(), port: 80, protocol: 'HTTP', hosts: '*', tlsMode: '' }
  ])
  const removeServer = id => setF('servers', form.servers.filter(s => s.id !== id))
  const updateServer = (id, k, v) => setF('servers', form.servers.map(s => s.id === id ? { ...s, [k]: v } : s))

  return (
    <div className={styles.formContent}>
      <DS title="METADATA">
        <FRow label="NAME">
          <input className={styles.input} value={form.name} disabled={!isCreate}
            onChange={e => setF('name', e.target.value)} placeholder="my-gateway" />
        </FRow>
        <FRow label="SELECTOR (label=value)">
          <input className={styles.input} value={form.selector} disabled={!canEdit}
            onChange={e => setF('selector', e.target.value)} placeholder="istio=ingressgateway" />
        </FRow>
      </DS>

      <DS title="SERVERS"
        action={canEdit && <button className={styles.addSmBtn} onClick={addServer}><Plus size={11} /> Add Server</button>}>
        {form.servers.length === 0 && <div className={styles.emptyHintText}>Chưa có server</div>}
        {form.servers.map((s, i) => (
          <div key={s.id} className={styles.routeBox}>
            <div className={styles.routeBoxHeader}>
              <span className={styles.routeNum}>Server {i + 1}</span>
              {canEdit && <button className={styles.removeSmBtn} onClick={() => removeServer(s.id)}><X size={11} /></button>}
            </div>
            <div className={styles.routeBoxBody}>
              <div className={styles.inlineRow}>
                <span className={styles.inlineLabel}>Port</span>
                <input className={styles.inputSm} type="number" value={s.port} disabled={!canEdit}
                  onChange={e => updateServer(s.id, 'port', e.target.value)} />
                <select className={styles.selectSm} value={s.protocol} disabled={!canEdit}
                  onChange={e => updateServer(s.id, 'protocol', e.target.value)}>
                  {['HTTP','HTTPS','HTTP2','GRPC','TCP','TLS','MONGO'].map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div className={styles.inlineRow}>
                <span className={styles.inlineLabel}>Hosts</span>
                <input className={styles.inputFlex} value={s.hosts} disabled={!canEdit}
                  onChange={e => updateServer(s.id, 'hosts', e.target.value)} placeholder="*.example.com" />
              </div>
              {['HTTPS','TLS'].includes(s.protocol) && (
                <div className={styles.inlineRow}>
                  <span className={styles.inlineLabel}>TLS Mode</span>
                  <select className={styles.selectSm} value={s.tlsMode} disabled={!canEdit}
                    onChange={e => updateServer(s.id, 'tlsMode', e.target.value)}>
                    {['PASSTHROUGH','SIMPLE','MUTUAL','AUTO_PASSTHROUGH','ISTIO_MUTUAL'].map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
              )}
            </div>
          </div>
        ))}
      </DS>
    </div>
  )
}

// ── PeerAuthentication Form ────────────────────────────────────────────────────
function PeerAuthForm({ form, setF, canEdit, isCreate }) {
  return (
    <div className={styles.formContent}>
      <DS title="METADATA">
        <FRow label="NAME">
          <input className={styles.input} value={form.name} disabled={!isCreate}
            onChange={e => setF('name', e.target.value)} placeholder="default-mtls" />
        </FRow>
      </DS>

      <DS title="MTLS MODE"
        hint="STRICT = yêu cầu mTLS, PERMISSIVE = chấp nhận cả mTLS và plain text">
        <div className={styles.mtlsModeGrid}>
          {['UNSET', 'PERMISSIVE', 'STRICT', 'DISABLE'].map(m => (
            <button key={m}
              className={`${styles.mtlsModeBtn} ${form.mtlsMode === m ? styles.mtlsModeBtnActive : ''}`}
              style={form.mtlsMode === m ? {
                borderColor: m === 'STRICT' ? 'var(--accent-green)'
                  : m === 'DISABLE' ? 'var(--accent-red)'
                  : 'var(--accent-amber)',
                color: m === 'STRICT' ? 'var(--accent-green)'
                  : m === 'DISABLE' ? 'var(--accent-red)'
                  : 'var(--accent-amber)',
              } : {}}
              disabled={!canEdit}
              onClick={() => canEdit && setF('mtlsMode', m)}
            >
              {m === 'STRICT' && <Shield size={11} />}
              {m}
            </button>
          ))}
        </div>
      </DS>

      <DS title="SELECTOR (optional)"
        hint="Để trống = áp dụng cho toàn bộ namespace">
        <FRow label="MATCH LABELS (key=value)">
          <input className={styles.input} value={form.selectorLabels} disabled={!canEdit}
            onChange={e => setF('selectorLabels', e.target.value)}
            placeholder="app=reviews (để trống = all pods)" />
        </FRow>
      </DS>
    </div>
  )
}

// ── ServiceEntry Form ──────────────────────────────────────────────────────────
function ServiceEntryForm({ form, setF, canEdit, isCreate }) {
  const addPort = () => setF('ports', [...form.ports, { id: Date.now(), number: 443, name: 'https', protocol: 'HTTPS' }])
  const removePort = id => setF('ports', form.ports.filter(p => p.id !== id))
  const updatePort = (id, k, v) => setF('ports', form.ports.map(p => p.id === id ? { ...p, [k]: v } : p))

  return (
    <div className={styles.formContent}>
      <DS title="METADATA">
        <FRow label="NAME">
          <input className={styles.input} value={form.name} disabled={!isCreate}
            onChange={e => setF('name', e.target.value)} placeholder="external-svc" />
        </FRow>
      </DS>

      <DS title="HOSTS">
        <FRow label="HOSTS (comma separated)">
          <input className={styles.input} value={form.hosts} disabled={!canEdit}
            onChange={e => setF('hosts', e.target.value)} placeholder="api.external.com, *.googleapis.com" />
        </FRow>
      </DS>

      <DS title="TRAFFIC SETTINGS">
        <FRow label="LOCATION">
          <select className={styles.input} value={form.location} disabled={!canEdit}
            onChange={e => setF('location', e.target.value)}>
            <option value="MESH_EXTERNAL">MESH_EXTERNAL</option>
            <option value="MESH_INTERNAL">MESH_INTERNAL</option>
          </select>
        </FRow>
        <FRow label="RESOLUTION">
          <select className={styles.input} value={form.resolution} disabled={!canEdit}
            onChange={e => setF('resolution', e.target.value)}>
            <option value="DNS">DNS</option>
            <option value="STATIC">STATIC</option>
            <option value="NONE">NONE</option>
          </select>
        </FRow>
      </DS>

      <DS title="PORTS"
        action={canEdit && <button className={styles.addSmBtn} onClick={addPort}><Plus size={11} /> Add</button>}>
        {form.ports.length === 0 && <div className={styles.emptyHintText}>Chưa có port</div>}
        {form.ports.map(p => (
          <div key={p.id} className={styles.portRow}>
            <input className={styles.inputSm} type="number" value={p.number} disabled={!canEdit} placeholder="443"
              onChange={e => updatePort(p.id, 'number', Number(e.target.value))} />
            <input className={styles.subsetInput} value={p.name} disabled={!canEdit} placeholder="https"
              onChange={e => updatePort(p.id, 'name', e.target.value)} />
            <select className={styles.selectSm} value={p.protocol} disabled={!canEdit}
              onChange={e => updatePort(p.id, 'protocol', e.target.value)}>
              {['HTTP','HTTPS','HTTP2','GRPC','TCP','TLS','MONGO','MYSQL','REDIS'].map(pr => <option key={pr}>{pr}</option>)}
            </select>
            {canEdit && <button className={styles.removeSmBtn} onClick={() => removePort(p.id)}><X size={11} /></button>}
          </div>
        ))}
      </DS>
    </div>
  )
}

// ── Section + Field helpers ────────────────────────────────────────────────────
function DS({ title, hint, action, children }) {
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

function FRow({ label, children }) {
  return (
    <div className={styles.fRow}>
      <label className={styles.fLabel}>{label}</label>
      {children}
    </div>
  )
}

// ── Default form builders ──────────────────────────────────────────────────────
function buildDefaultForm(type, item) {
  if (type === 'virtualservice') {
    if (!item) return { name: '', hosts: '', gateways: '', httpRoutes: [] }
    return {
      name: item.name,
      hosts: (item.hosts || []).join(', '),
      gateways: (item.gateways || []).join(', '),
      httpRoutes: (item.http || []).map(r => ({
        id: Date.now() + Math.random(),
        matchUri: r.match?.[0]?.uri ? Object.values(r.match[0].uri)[0] : '',
        matchType: r.match?.[0]?.uri ? Object.keys(r.match[0].uri)[0] : 'prefix',
        destinations: (r.route || []).map(d => ({ host: d.destination?.host || '', subset: d.destination?.subset || '', weight: d.weight ?? 100 })),
        timeout: r.timeout || '',
        retries: r.retries?.attempts || null,
      })),
    }
  }
  if (type === 'destinationrule') {
    if (!item) return { name: '', host: '', lbPolicy: '', tlsMode: '', enableCB: false, cbErrors: '5', cbInterval: '1s', cbEjectTime: '30s', cbMaxEject: '50', subsets: [] }
    const tp = item.trafficPolicy || {}
    return {
      name: item.name, host: item.host || '',
      lbPolicy: tp.loadBalancer?.simple || '',
      tlsMode: tp.tls?.mode || '',
      enableCB: !!tp.outlierDetection,
      cbErrors: String(tp.outlierDetection?.consecutiveErrors || 5),
      cbInterval: tp.outlierDetection?.interval || '1s',
      cbEjectTime: tp.outlierDetection?.baseEjectionTime || '30s',
      cbMaxEject: String(tp.outlierDetection?.maxEjectionPercent || 50),
      subsets: (item.subsets || []).map(s => ({
        id: Date.now() + Math.random(), name: s.name,
        labelKey: Object.keys(s.labels || {})[0] || '',
        labelValue: Object.values(s.labels || {})[0] || '',
      })),
    }
  }
  if (type === 'gateway') {
    if (!item) return { name: '', selector: 'istio=ingressgateway', servers: [] }
    const selStr = Object.entries(item.selector || {}).map(([k,v]) => `${k}=${v}`).join(', ')
    return {
      name: item.name, selector: selStr,
      servers: (item.servers || []).map(s => ({
        id: Date.now() + Math.random(),
        port: s.port?.number || 80,
        protocol: s.port?.protocol || 'HTTP',
        hosts: (s.hosts || []).join(', '),
        tlsMode: s.tls?.mode || '',
      })),
    }
  }
  if (type === 'peerauthentication') {
    if (!item) return { name: '', mtlsMode: 'STRICT', selectorLabels: '' }
    const ml = item.selector?.matchLabels || {}
    return {
      name: item.name,
      mtlsMode: item.mtls?.mode || 'UNSET',
      selectorLabels: Object.entries(ml).map(([k,v]) => `${k}=${v}`).join(', '),
    }
  }
  if (type === 'serviceentry') {
    if (!item) return { name: '', hosts: '', location: 'MESH_EXTERNAL', resolution: 'DNS', ports: [] }
    return {
      name: item.name,
      hosts: (item.hosts || []).join(', '),
      location: item.location || 'MESH_EXTERNAL',
      resolution: item.resolution || 'DNS',
      ports: (item.ports || []).map(p => ({ id: Date.now() + Math.random(), number: p.number, name: p.name || '', protocol: p.protocol || 'HTTP' })),
    }
  }
  return { name: '' }
}

// ── Manifest builders ──────────────────────────────────────────────────────────
function buildManifestFromForm(type, form, namespace) {
  const meta = {
    apiVersion: type === 'peerauthentication' ? 'security.istio.io/v1beta1' : 'networking.istio.io/v1beta1',
    kind: {
      virtualservice: 'VirtualService', destinationrule: 'DestinationRule',
      gateway: 'Gateway', peerauthentication: 'PeerAuthentication', serviceentry: 'ServiceEntry',
    }[type],
    metadata: { name: form.name.trim(), namespace, labels: { 'app.kubernetes.io/managed-by': 'ms-manager' } },
  }

  if (type === 'virtualservice') {
    const http = form.httpRoutes.map(r => {
      const obj = { route: r.destinations.map(d => ({ destination: { host: d.host, ...(d.subset ? { subset: d.subset } : {}), }, ...(r.destinations.length > 1 ? { weight: Number(d.weight) } : {}) })) }
      if (r.matchUri) obj.match = [{ uri: { [r.matchType]: r.matchUri } }]
      if (r.timeout) obj.timeout = r.timeout
      if (r.retries) obj.retries = { attempts: Number(r.retries), perTryTimeout: r.timeout || '5s' }
      return obj
    })
    return { ...meta, spec: {
      hosts: form.hosts.split(',').map(s => s.trim()).filter(Boolean),
      ...(form.gateways ? { gateways: form.gateways.split(',').map(s => s.trim()).filter(Boolean) } : {}),
      ...(http.length ? { http } : {}),
    }}
  }

  if (type === 'destinationrule') {
    const tp = {}
    if (form.lbPolicy) tp.loadBalancer = { simple: form.lbPolicy }
    if (form.tlsMode)  tp.tls = { mode: form.tlsMode }
    if (form.enableCB) tp.outlierDetection = {
      consecutiveErrors: Number(form.cbErrors),
      interval: form.cbInterval,
      baseEjectionTime: form.cbEjectTime,
      maxEjectionPercent: Number(form.cbMaxEject),
    }
    const subsets = form.subsets.filter(s => s.name).map(s => ({
      name: s.name, ...(s.labelKey ? { labels: { [s.labelKey]: s.labelValue } } : {})
    }))
    return { ...meta, spec: { host: form.host, ...(Object.keys(tp).length ? { trafficPolicy: tp } : {}), ...(subsets.length ? { subsets } : {}) } }
  }

  if (type === 'gateway') {
    const [selKey, selVal] = (form.selector || '').split('=')
    const servers = form.servers.map(s => ({
      port: { number: Number(s.port), name: `${s.protocol.toLowerCase()}-${s.port}`, protocol: s.protocol },
      hosts: s.hosts.split(',').map(h => h.trim()).filter(Boolean),
      ...(s.tlsMode ? { tls: { mode: s.tlsMode } } : {}),
    }))
    return { ...meta, spec: { selector: selKey ? { [selKey.trim()]: selVal?.trim() || '' } : {}, servers } }
  }

  if (type === 'peerauthentication') {
    const spec = { mtls: { mode: form.mtlsMode } }
    if (form.selectorLabels?.trim()) {
      const [k, v] = form.selectorLabels.split('=')
      spec.selector = { matchLabels: { [k.trim()]: v?.trim() || '' } }
    }
    return { ...meta, spec }
  }

  if (type === 'serviceentry') {
    return { ...meta, spec: {
      hosts: form.hosts.split(',').map(s => s.trim()).filter(Boolean),
      location: form.location, resolution: form.resolution,
      ports: form.ports.map(p => ({ number: p.number, name: p.name, protocol: p.protocol })),
    }}
  }

  return meta
}
