import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FileCode, Play, CheckCircle, XCircle, Upload, Trash2, AlertCircle, Copy, Check } from 'lucide-react'
import { useK8sStore } from '../store'
import { useK8sService } from '../hooks/useAuth'
import styles from './YamlApplyPage.module.css'

const EXAMPLES = {
  namespace: `apiVersion: v1
kind: Namespace
metadata:
  name: my-app
  labels:
    env: staging
    app.kubernetes.io/managed-by: ms-manager`,

  deployment: `apiVersion: v1
kind: Namespace
metadata:
  name: demo
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-demo
  namespace: demo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: nginx-demo
  template:
    metadata:
      labels:
        app: nginx-demo
    spec:
      containers:
      - name: nginx
        image: nginx:alpine
        ports:
        - containerPort: 80
        resources:
          requests:
            cpu: 50m
            memory: 64Mi
          limits:
            cpu: 200m
            memory: 128Mi`,

  configmap: `apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: default
data:
  APP_ENV: production
  LOG_LEVEL: info
  AUTH_ISSUER: http://localhost:8081`,
}

export default function YamlApplyPage() {
  const getService = useK8sService()
  const { activeCluster } = useK8sStore()

  const [yaml, setYaml] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [activeExample, setActiveExample] = useState(null)
  const fileInputRef = useRef()

  const handleApply = async () => {
    if (!yaml.trim()) { setError('YAML không được để trống'); return }
    const svc = getService()
    if (!svc) { setError(!activeCluster ? 'Chưa chọn cluster' : 'Chưa đăng nhập'); return }

    setLoading(true)
    setError('')
    setResults([])

    try {
      const res = await svc.applyYamlString(yaml)
      setResults(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => { setYaml(ev.target.result); setResults([]); setActiveExample(null) }
    reader.readAsText(file)
  }

  const loadExample = (key) => {
    setYaml(EXAMPLES[key])
    setResults([])
    setActiveExample(key)
  }

  const handleCopyYaml = async () => {
    if (!yaml) return
    await navigator.clipboard.writeText(yaml)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const lineCount = yaml ? yaml.split('\n').length : 0
  const docCount = yaml ? yaml.split(/^---$/m).filter(Boolean).length : 0

  return (
    <div className={styles.root}>
      {/* Header */}
      <div className={styles.pageHeader}>
        <div className={styles.pageTitle}>
          <FileCode size={16} color="var(--accent-blue)" />
          <span>Apply YAML Manifest</span>
          {activeCluster && (
            <span className={styles.clusterPill}>→ {activeCluster.name}</span>
          )}
        </div>
        <div className={styles.headerActions}>
          {/* Example presets */}
          <div className={styles.exampleGroup}>
            <span className={styles.exampleLabel}>Examples:</span>
            {Object.keys(EXAMPLES).map(k => (
              <button
                key={k}
                className={`${styles.exampleBtn} ${activeExample === k ? styles.exampleActive : ''}`}
                onClick={() => loadExample(k)}
              >
                {k}
              </button>
            ))}
          </div>

          <div className={styles.divider} />

          <button className={styles.ghostBtn} onClick={() => fileInputRef.current?.click()}>
            <Upload size={13} /> Upload
          </button>
          <input
            ref={fileInputRef} type="file" accept=".yaml,.yml,.json"
            style={{ display: 'none' }} onChange={handleFileUpload}
          />

          {yaml && (
            <>
              <button className={styles.ghostBtn} onClick={handleCopyYaml}>
                {copied ? <><Check size={12} /> Đã copy</> : <><Copy size={12} /> Copy</>}
              </button>
              <button className={styles.ghostBtn} onClick={() => { setYaml(''); setResults([]); setActiveExample(null) }}>
                <Trash2 size={13} />
              </button>
            </>
          )}

          <button
            className={styles.applyBtn}
            onClick={handleApply}
            disabled={loading || !yaml.trim() || !getService()}
          >
            {loading
              ? <><span className={styles.spinner} /> Đang apply...</>
              : <><Play size={13} fill="currentColor" /> Apply</>
            }
          </button>
        </div>
      </div>

      {/* Body: editor + results */}
      <div className={styles.body}>

        {/* Editor panel */}
        <div className={styles.editorPanel}>
          <div className={styles.editorToolbar}>
            <span className={styles.toolbarItem}>YAML</span>
            {yaml && (
              <>
                <span className={styles.toolbarSep}>·</span>
                <span className={styles.toolbarItem}>{lineCount} dòng</span>
                {docCount > 1 && (
                  <>
                    <span className={styles.toolbarSep}>·</span>
                    <span className={styles.toolbarItem}>{docCount} documents</span>
                  </>
                )}
              </>
            )}
          </div>
          <div className={styles.editorWrap}>
            <div className={styles.lineNumbers} aria-hidden>
              {(yaml || ' ').split('\n').map((_, i) => (
                <span key={i}>{i + 1}</span>
              ))}
            </div>
            <textarea
              className={styles.editor}
              value={yaml}
              onChange={e => { setYaml(e.target.value); setResults([]) }}
              placeholder={`# Paste YAML manifest ở đây\n# Dùng --- để phân tách nhiều documents\n\napiVersion: v1\nkind: Namespace\nmetadata:\n  name: my-app`}
              spellCheck={false}
              onKeyDown={e => {
                // Tab → 2 spaces
                if (e.key === 'Tab') {
                  e.preventDefault()
                  const s = e.target.selectionStart
                  const val = yaml.substring(0, s) + '  ' + yaml.substring(s)
                  setYaml(val)
                  requestAnimationFrame(() => {
                    e.target.selectionStart = e.target.selectionEnd = s + 2
                  })
                }
              }}
            />
          </div>
        </div>

        {/* Results panel */}
        <div className={styles.resultsPanel}>
          <div className={styles.resultsToolbar}>
            <span className={styles.toolbarItem}>RESULTS</span>
            {results.length > 0 && (
              <>
                <span className={styles.toolbarSep}>·</span>
                <span className={styles.toolbarItem} style={{ color: 'var(--accent-green)' }}>
                  ✓ {results.filter(r => r.ok).length}
                </span>
                {results.some(r => !r.ok) && (
                  <>
                    <span className={styles.toolbarSep}>·</span>
                    <span className={styles.toolbarItem} style={{ color: 'var(--accent-red)' }}>
                      ✗ {results.filter(r => !r.ok).length}
                    </span>
                  </>
                )}
              </>
            )}
          </div>

          <div className={styles.resultsBody}>
            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  className={styles.errorBanner}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <AlertCircle size={13} />
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Empty state */}
            {results.length === 0 && !error && (
              <div className={styles.emptyResults}>
                <FileCode size={28} color="var(--text-muted)" />
                <p>Kết quả sẽ hiển thị ở đây sau khi apply</p>
                {!activeCluster && (
                  <p style={{ fontSize: 11, color: 'var(--accent-amber)' }}>
                    ⚠ Chưa chọn cluster
                  </p>
                )}
              </div>
            )}

            {/* Result items */}
            <AnimatePresence>
              {results.map((r, i) => (
                <motion.div
                  key={i}
                  className={`${styles.resultItem} ${r.ok ? styles.resultOk : styles.resultFail}`}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06 }}
                >
                  <div className={styles.resultRow}>
                    {r.ok
                      ? <CheckCircle size={13} color="var(--accent-green)" />
                      : <XCircle size={13} color="var(--accent-red)" />
                    }
                    <span className={styles.resultKind}>{r.kind}</span>
                    <span className={styles.resultName}>{r.name}</span>
                    <span className={styles.resultOp}>
                      {r.ok
                        ? (r.result?.metadata?.resourceVersion ? 'configured' : 'created')
                        : 'failed'
                      }
                    </span>
                  </div>
                  {r.error && (
                    <div className={styles.resultError}>{r.error}</div>
                  )}
                  {r.ok && r.result?.metadata?.namespace && (
                    <div className={styles.resultMeta}>
                      ns: {r.result.metadata.namespace}
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}
