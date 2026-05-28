import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Layers, RefreshCw, Plus, Trash2, Search, AlertCircle, ExternalLink } from 'lucide-react'
import { useK8sStore } from '../store'
import { useK8sService } from '../hooks/useAuth'
import CreateNsDialog from '../components/CreateNsDialog'
import styles from './NamespacePage.module.css'

export default function NamespacePage() {
  const navigate = useNavigate()
  const getService = useK8sService()
  const {
    activeCluster, selectedNamespace, setNamespace,
    namespaces, setNamespaces, loading, setLoading, error, setError,
  } = useK8sStore()

  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)

  const fetchNamespaces = useCallback(async () => {
    const svc = getService()
    if (!svc) {
      setError(!activeCluster ? 'Chưa chọn cluster — vào OIDC Config để thêm.' : 'Chưa đăng nhập')
      setNamespaces([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const ns = await svc.getNamespaces()
      setNamespaces(ns)
    } catch (e) {
      console.log(e);      
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [getService, activeCluster, setLoading, setError, setNamespaces])

  useEffect(() => { fetchNamespaces() }, [fetchNamespaces])

  const handleDelete = async (name) => {
    const svc = getService()
    if (!svc) return
    setActionLoading(true)
    try {
      await svc.deleteNamespace(name)
      await fetchNamespaces()
      setDeleteTarget(null)
      if (selectedNamespace === name) setNamespace('default')
    } catch (e) {
      setError(`Xoá namespace thất bại: ${e.message}`)
      setDeleteTarget(null)
    } finally {
      setActionLoading(false)
    }
  }

  const filtered = (namespaces || []).filter(ns =>
    ns.name.toLowerCase().includes(search.toLowerCase())
  )

  const statusClass = { Active: 'active', Terminating: 'terminating' }

  return (
    <div className={styles.root}>
      {/* Page header */}
      <div className={styles.pageHeader}>
        <div className={styles.pageTitle}>
          <Layers size={16} color="var(--accent-blue)" />
          <span>Namespaces</span>
          {(namespaces || []).length > 0 && (
            <span className={styles.countBadge}>{namespaces.length}</span>
          )}
        </div>
        <div className={styles.headerActions}>
          <div className={styles.searchWrap}>
            <Search size={12} />
            <input
              className={styles.search}
              placeholder="Tìm namespace..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button
            className={styles.iconBtn}
            onClick={fetchNamespaces}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? styles.spin : ''} />
          </button>
          <button
            className={styles.primaryBtn}
            onClick={() => setShowCreate(true)}
            disabled={!getService()}
          >
            <Plus size={13} />
            Tạo mới
          </button>
        </div>
      </div>

      {/* Error banner */}
      <AnimatePresence>
        {error && (
          <motion.div
            className={styles.errorBanner}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <AlertCircle size={13} />
            <span style={{ flex: 1 }}>{error}</span>
            {!activeCluster && (
              <button className={styles.configLink} onClick={() => navigate('/oidc-config')}>
                Cấu hình <ExternalLink size={11} />
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      <div className={styles.content}>
        {loading && (namespaces || []).length === 0 ? (
          <div className={styles.loadingState}>
            <div className={styles.loadingSpinner} />
            <span>Đang kết nối Kubernetes API...</span>
          </div>
        ) : !error && filtered.length === 0 ? (
          <div className={styles.emptyState}>
            <Layers size={32} color="var(--text-muted)" />
            <span>{search ? 'Không tìm thấy namespace nào' : 'Chưa có namespace'}</span>
          </div>
        ) : filtered.length > 0 ? (
          <div className={styles.table}>
            {/* Table head */}
            <div className={styles.tableHead}>
              <span style={{ flex: 3 }}>NAME</span>
              <span style={{ flex: 1.2 }}>STATUS</span>
              <span style={{ flex: 3 }}>LABELS</span>
              <span style={{ flex: 1.5 }}>CREATED</span>
              <span style={{ width: 52 }}></span>
            </div>

            {/* Rows */}
            <AnimatePresence initial={false}>
              {filtered.map((ns, i) => (
                <motion.div
                  key={ns.name}
                  className={`${styles.tableRow} ${selectedNamespace === ns.name ? styles.rowSelected : ''}`}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.3) }}
                  onClick={() => setNamespace(ns.name)}
                >
                  <span style={{ flex: 3 }} className={styles.nsName}>{ns.name}</span>
                  <span style={{ flex: 1.2 }}>
                    <span className={styles.statusChip}>
                      <span className={`status-dot ${statusClass[ns.status] || 'unknown'}`} />
                      {ns.status || 'Unknown'}
                    </span>
                  </span>
                  <span style={{ flex: 3 }} className={styles.labelsCell}>
                    {Object.entries(ns.labels || {})
                      .filter(([k]) => !k.startsWith('kubernetes.io'))
                      .slice(0, 3)
                      .map(([k, v]) => (
                        <span key={k} className={styles.labelChip}>{k}={v}</span>
                      ))
                    }
                  </span>
                  <span style={{ flex: 1.5 }} className={styles.date}>
                    {ns.createdAt ? new Date(ns.createdAt).toLocaleDateString('vi-VN') : '—'}
                  </span>
                  <span style={{ width: 52, display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      className={styles.deleteBtn}
                      onClick={e => { e.stopPropagation(); setDeleteTarget(ns.name) }}
                      title="Xoá namespace"
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        ) : null}
      </div>

      {/* Create dialog */}
      <CreateNsDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={fetchNamespaces}
        getService={getService}
      />

      {/* Delete confirm */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            className={styles.overlay}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <motion.div
              className={styles.dialog}
              initial={{ scale: 0.95, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 8 }}
            >
              <h3 className={styles.dialogTitle}>Xoá namespace?</h3>
              <p className={styles.dialogBody}>
                Sẽ xoá namespace{' '}
                <code className={styles.nsCode}>{deleteTarget}</code>{' '}
                và toàn bộ tài nguyên bên trong. Không thể hoàn tác.
              </p>
              <div className={styles.dialogActions}>
                <button className={styles.cancelDialogBtn} onClick={() => setDeleteTarget(null)}>
                  Huỷ
                </button>
                <button
                  className={styles.deleteDialogBtn}
                  onClick={() => handleDelete(deleteTarget)}
                  disabled={actionLoading}
                >
                  {actionLoading ? <span className={styles.spinner} /> : 'Xác nhận xoá'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
