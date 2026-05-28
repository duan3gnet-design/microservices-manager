import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus } from 'lucide-react'
import styles from './CreateNsDialog.module.css'

const NAMESPACE_YAML_TEMPLATE = (name) => `apiVersion: v1
kind: Namespace
metadata:
  name: ${name}
  labels:
    app.kubernetes.io/managed-by: ms-manager`

export default function CreateNsDialog({ open, onClose, onCreated, getService }) {
  const [name, setName] = useState('')
  const [labels, setLabels] = useState([{ key: '', value: '' }])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async () => {
    if (!name.trim()) { setError('Tên namespace không được để trống'); return }
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(name)) {
      setError('Tên chỉ được chứa chữ thường, số và dấu gạch ngang')
      return
    }

    const svc = getService()
    if (!svc) { setError('Chưa kết nối cluster'); return }

    const extraLabels = labels
      .filter(l => l.key.trim())
      .reduce((acc, l) => ({ ...acc, [l.key]: l.value }), {})

    const manifest = {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: {
        name: name.trim(),
        labels: {
          'app.kubernetes.io/managed-by': 'ms-manager',
          ...extraLabels,
        },
      },
    }

    setLoading(true)
    setError('')
    try {
      await svc.createNamespaceFromYaml(manifest)
      onCreated?.()
      handleClose()
    } catch (e) {
      console.log(e);      
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setName('')
    setLabels([{ key: '', value: '' }])
    setError('')
    onClose()
  }

  const addLabel = () => setLabels(l => [...l, { key: '', value: '' }])
  const removeLabel = (i) => setLabels(l => l.filter((_, idx) => idx !== i))
  const updateLabel = (i, field, val) => setLabels(l => l.map((item, idx) => idx === i ? { ...item, [field]: val } : item))

  return (
    <AnimatePresence>
      {open && (
        <motion.div className={styles.overlay} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div
            className={styles.dialog}
            initial={{ scale: 0.95, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 10 }}
          >
            <div className={styles.header}>
              <h3 className={styles.title}>Tạo Namespace mới</h3>
              <button className={styles.closeBtn} onClick={handleClose}><X size={14} /></button>
            </div>

            <div className={styles.body}>
              {/* Name */}
              <div className={styles.field}>
                <label className={styles.label}>NAMESPACE NAME *</label>
                <input
                  className={styles.input}
                  placeholder="my-namespace"
                  value={name}
                  onChange={e => setName(e.target.value.toLowerCase())}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                  autoFocus
                />
              </div>

              {/* Labels */}
              <div className={styles.field}>
                <div className={styles.labelRow}>
                  <label className={styles.label}>LABELS</label>
                  <button className={styles.addLabelBtn} onClick={addLabel}>
                    <Plus size={11} /> Thêm
                  </button>
                </div>
                {labels.map((l, i) => (
                  <div key={i} className={styles.labelInputRow}>
                    <input
                      className={styles.inputSm}
                      placeholder="key"
                      value={l.key}
                      onChange={e => updateLabel(i, 'key', e.target.value)}
                    />
                    <span className={styles.eq}>=</span>
                    <input
                      className={styles.inputSm}
                      placeholder="value"
                      value={l.value}
                      onChange={e => updateLabel(i, 'value', e.target.value)}
                    />
                    {labels.length > 1 && (
                      <button className={styles.removeLabelBtn} onClick={() => removeLabel(i)}>
                        <X size={11} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Preview YAML */}
              {name && (
                <div className={styles.yamlPreview}>
                  <div className={styles.yamlTitle}>YAML Preview</div>
                  <pre className={styles.yaml}>{NAMESPACE_YAML_TEMPLATE(name)}</pre>
                </div>
              )}

              {error && <div className={styles.error}>⚠ {error}</div>}
            </div>

            <div className={styles.footer}>
              <button className={styles.cancelBtn} onClick={handleClose}>Huỷ</button>
              <button className={styles.createBtn} onClick={handleCreate} disabled={loading}>
                {loading ? <span className={styles.spinner} /> : <><Plus size={13} /> Tạo Namespace</>}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
