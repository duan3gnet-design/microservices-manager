import { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Info, ZoomIn, ZoomOut, Maximize2, X, Network,
} from 'lucide-react'
import styles from './NetworkPolicyGraph.module.css'

// ── Layout constants ───────────────────────────────────────────────────────────

const NODE_W = 160
const NODE_H = 54
const GAP_X  = 220
const GAP_Y  = 90
const COLS   = 3

// ── Helpers ────────────────────────────────────────────────────────────────────

function selectorLabel(sel) {
  if (!sel || Object.keys(sel).length === 0) return 'All Pods'
  const ml = sel.matchLabels || {}
  const parts = Object.entries(ml).map(([k, v]) => `${k}=${v}`)
  return parts.join(', ') || 'All Pods'
}

function peerLabel(peer) {
  if (peer.podSelector !== undefined)
    return { type: 'pod', label: selectorLabel(peer.podSelector) }
  if (peer.namespaceSelector !== undefined)
    return { type: 'ns', label: `ns: ${selectorLabel(peer.namespaceSelector)}` }
  if (peer.ipBlock)
    return { type: 'ip', label: peer.ipBlock.cidr }
  return { type: 'unknown', label: '?' }
}

function portsLabel(ports = []) {
  if (ports.length === 0) return 'all ports'
  return ports.map(p => `${p.protocol || 'TCP'}/${p.port || '*'}`).join(', ')
}

/** Build graph nodes and edges from policy list */
function buildGraph(policies) {
  const nodes   = []
  const edges   = []
  const nodeMap = {}

  const ensureNode = (id, kind, label, sub = '') => {
    if (!nodeMap[id]) {
      const idx = nodes.length
      const col = idx % COLS
      const row = Math.floor(idx / COLS)
      nodeMap[id] = {
        id, kind, label, sub,
        x: 60 + col * (NODE_W + GAP_X),
        y: 60 + row * (NODE_H + GAP_Y),
      }
      nodes.push(nodeMap[id])
    }
    return nodeMap[id]
  }

  policies.forEach(policy => {
    const targetId = `policy:${policy.name}`
    ensureNode(targetId, 'policy', policy.name, selectorLabel(policy.podSelector))

    // ── Ingress ──
    ;(policy.ingress || []).forEach((rule, ri) => {
      if (policy.isDenyAllIngress) return
      const peers = rule.from || []
      if (peers.length === 0) {
        const srcId = `any:ingress:${policy.name}`
        ensureNode(srcId, 'any', 'Any Source', '')
        edges.push({
          id: `e-${srcId}-${targetId}-${ri}`,
          from: srcId, to: targetId,
          dir: 'ingress', type: 'allow',
          ports: portsLabel(rule.ports),
        })
      } else {
        peers.forEach((peer, pi) => {
          const pl = peerLabel(peer)
          const srcId = `peer:${pl.type}:${pl.label}`
          ensureNode(srcId, pl.type, pl.label, '')
          edges.push({
            id: `e-${srcId}-${targetId}-${ri}-${pi}`,
            from: srcId, to: targetId,
            dir: 'ingress', type: 'allow',
            ports: portsLabel(rule.ports),
          })
        })
      }
    })

    if (policy.isDenyAllIngress) {
      edges.push({
        id: `deny-in-${targetId}`,
        from: null, to: targetId,
        dir: 'ingress', type: 'deny',
        ports: 'all ports', synthetic: true,
      })
    }

    // ── Egress ──
    ;(policy.egress || []).forEach((rule, ri) => {
      if (policy.isDenyAllEgress) return
      const peers = rule.to || []
      if (peers.length === 0) {
        const dstId = `any:egress:${policy.name}`
        ensureNode(dstId, 'any', 'Any Destination', '')
        edges.push({
          id: `e-${targetId}-${dstId}-${ri}`,
          from: targetId, to: dstId,
          dir: 'egress', type: 'allow',
          ports: portsLabel(rule.ports),
        })
      } else {
        peers.forEach((peer, pi) => {
          const pl = peerLabel(peer)
          const dstId = `peer:${pl.type}:${pl.label}:dst`
          ensureNode(dstId, pl.type, pl.label, '')
          edges.push({
            id: `e-${targetId}-${dstId}-${ri}-${pi}`,
            from: targetId, to: dstId,
            dir: 'egress', type: 'allow',
            ports: portsLabel(rule.ports),
          })
        })
      }
    })

    if (policy.isDenyAllEgress) {
      edges.push({
        id: `deny-out-${targetId}`,
        from: targetId, to: null,
        dir: 'egress', type: 'deny',
        ports: 'all ports', synthetic: true,
      })
    }
  })

  return { nodes, edges }
}

// ── Colour maps ────────────────────────────────────────────────────────────────

const KIND_COLORS = {
  policy:  { stroke: 'rgba(74,158,255,0.7)',  fill: 'rgba(74,158,255,0.08)',  text: 'var(--accent-blue)'   },
  pod:     { stroke: 'rgba(16,185,129,0.6)',  fill: 'rgba(16,185,129,0.07)',  text: 'var(--accent-green)'  },
  ns:      { stroke: 'rgba(139,92,246,0.6)',  fill: 'rgba(139,92,246,0.07)',  text: 'var(--accent-purple)' },
  ip:      { stroke: 'rgba(245,158,11,0.65)', fill: 'rgba(245,158,11,0.07)', text: 'var(--accent-amber)'  },
  any:     { stroke: 'rgba(100,116,139,0.5)', fill: 'rgba(100,116,139,0.06)', text: 'var(--text-muted)'    },
  unknown: { stroke: 'rgba(100,116,139,0.5)', fill: 'rgba(100,116,139,0.06)', text: 'var(--text-muted)'    },
}

const EDGE_COLORS = {
  ingress_allow: { stroke: 'rgba(74,158,255,0.55)',  glow: '#4a9eff' },
  egress_allow:  { stroke: 'rgba(16,185,129,0.55)',  glow: '#10b981' },
  deny:          { stroke: 'rgba(239,68,68,0.6)',    glow: '#ef4444' },
}

function edgeColor(edge) {
  if (edge.type === 'deny') return EDGE_COLORS.deny
  return edge.dir === 'ingress' ? EDGE_COLORS.ingress_allow : EDGE_COLORS.egress_allow
}

// ── Bezier path between two nodes ─────────────────────────────────────────────

function arrowPath(from, to, nodeMap) {
  const fn = nodeMap[from]
  const tn = nodeMap[to]
  if (!fn || !tn) return null

  const fx = fn.x + NODE_W / 2, fy = fn.y + NODE_H / 2
  const tx = tn.x + NODE_W / 2, ty = tn.y + NODE_H / 2

  const dx = tx - fx, dy = ty - fy
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const ex = dx / len, ey = dy / len

  const startX = fx + ex * (NODE_W / 2), startY = fy + ey * (NODE_H / 2)
  const endX   = tx - ex * (NODE_W / 2 + 2), endY = ty - ey * (NODE_H / 2 + 2)

  const mid = { x: (startX + endX) / 2, y: (startY + endY) / 2 }
  const perp = { x: -ey * 36, y: ex * 36 }
  const cp1  = { x: startX + (mid.x - startX) * 0.6 + perp.x, y: startY + (mid.y - startY) * 0.6 + perp.y }
  const cp2  = { x: endX   - (endX - mid.x) * 0.6 + perp.x,   y: endY   - (endY - mid.y) * 0.6 + perp.y }

  return `M ${startX} ${startY} C ${cp1.x} ${cp1.y} ${cp2.x} ${cp2.y} ${endX} ${endY}`
}

// ── Synthetic deny shield ──────────────────────────────────────────────────────

function DenyShield({ edge, nodeMap }) {
  const anchor = edge.to ? nodeMap[edge.to] : edge.from ? nodeMap[edge.from] : null
  if (!anchor) return null
  const cx = anchor.x + (edge.dir === 'egress' ? NODE_W + 52 : -52)
  const cy = anchor.y + NODE_H / 2

  return (
    <g>
      <circle cx={cx} cy={cy} r={22} fill="rgba(239,68,68,0.12)"
        stroke="rgba(239,68,68,0.4)" strokeWidth={1.5} />
      <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
        fill="rgba(239,68,68,0.85)" fontSize={15}>🛡</text>
      <text x={cx} y={cy + 30} textAnchor="middle"
        fill="rgba(239,68,68,0.7)" fontSize={9} fontFamily="monospace">
        {edge.dir === 'ingress' ? 'deny in' : 'deny out'}
      </text>
      <line
        x1={edge.dir === 'egress' ? anchor.x + NODE_W : anchor.x}
        y1={anchor.y + NODE_H / 2}
        x2={edge.dir === 'egress' ? cx - 22 : cx + 22}
        y2={cy}
        stroke="rgba(239,68,68,0.45)" strokeWidth={1.5} strokeDasharray="4 3"
      />
    </g>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function NetworkPolicyGraph({ policies, selectedPolicy }) {
  const containerRef = useRef(null)
  const [zoom, setZoom]         = useState(1)
  const [pan,  setPan]          = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStart               = useRef(null)
  const [hoveredEdge, setHoveredEdge]   = useState(null)
  const [hoveredNode, setHoveredNode]   = useState(null)
  const [selectedNode, setSelectedNode] = useState(null)
  const [tooltip, setTooltip]           = useState(null)

  // Build graph
  const { nodes, edges } = useMemo(() => {
    const filtered = selectedPolicy
      ? policies.filter(p => p.name === selectedPolicy)
      : policies
    return buildGraph(filtered)
  }, [policies, selectedPolicy])

  const nodeMap = useMemo(() => {
    const m = {}
    nodes.forEach(n => { m[n.id] = n })
    return m
  }, [nodes])

  const svgW = useMemo(() =>
    nodes.length === 0 ? 600 : Math.max(...nodes.map(n => n.x + NODE_W)) + 100,
  [nodes])
  const svgH = useMemo(() =>
    nodes.length === 0 ? 400 : Math.max(...nodes.map(n => n.y + NODE_H)) + 100,
  [nodes])

  // Fit on mount / change
  const fitView = useCallback(() => {
    if (!containerRef.current) return
    const { width, height } = containerRef.current.getBoundingClientRect()
    const s = Math.min((width - 40) / svgW, (height - 40) / svgH, 1.4)
    setZoom(s)
    setPan({ x: (width - svgW * s) / 2, y: (height - svgH * s) / 2 })
  }, [svgW, svgH])

  useEffect(() => { fitView() }, [fitView])

  // Pan drag handlers
  const onMouseDown = (e) => {
    if (e.target.closest('[data-node]')) return
    setDragging(true)
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }
  const onMouseMove = useCallback((e) => {
    if (!dragging || !dragStart.current) return
    setPan({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y })
  }, [dragging])
  const onMouseUp = useCallback(() => setDragging(false), [])

  const onWheel = (e) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.1 : 0.91
    setZoom(z => Math.min(Math.max(z * factor, 0.15), 3))
  }

  // Highlighted edges for active node
  const activeNodeId = selectedNode || hoveredNode
  const highlightedEdgeIds = useMemo(() => {
    if (!activeNodeId) return new Set()
    return new Set(
      edges.filter(e => e.from === activeNodeId || e.to === activeNodeId).map(e => e.id)
    )
  }, [activeNodeId, edges])

  if (nodes.length === 0) {
    return (
      <div className={styles.emptyGraph}>
        <Network size={36} color="var(--text-muted)" style={{ opacity: 0.3 }} />
        <span>Không có policy nào để hiển thị</span>
      </div>
    )
  }

  return (
    <div className={styles.graphRoot}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <span className={styles.toolbarTitle}>
            <Network size={12} color="var(--accent-blue)" />
            Graph View
          </span>
          <span className={styles.toolbarHint}>
            {nodes.length} nodes · {edges.filter(e => !e.synthetic).length} connections
            {selectedPolicy && (
              <span className={styles.filterBadge}>· {selectedPolicy}</span>
            )}
          </span>
        </div>
        <div className={styles.toolbarRight}>
          <Legend />
          <button className={styles.toolBtn} onClick={() => setZoom(z => Math.min(z * 1.2, 3))} title="Zoom in">
            <ZoomIn size={13} />
          </button>
          <button className={styles.toolBtn} onClick={() => setZoom(z => Math.max(z * 0.83, 0.15))} title="Zoom out">
            <ZoomOut size={13} />
          </button>
          <button className={styles.toolBtn} onClick={fitView} title="Fit to view">
            <Maximize2 size={13} />
          </button>
          {selectedNode && (
            <button className={styles.toolBtn} onClick={() => setSelectedNode(null)} title="Bỏ chọn">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className={`${styles.canvas} ${dragging ? styles.canvasDragging : ''}`}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
      >
        <svg
          width={svgW}
          height={svgH}
          style={{
            transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            overflow: 'visible',
          }}
        >
          <defs>
            {['ingress_allow', 'egress_allow', 'deny'].map(t => (
              <marker key={t} id={`arrow-${t}`}
                markerWidth="8" markerHeight="8"
                refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L0,6 L8,3 z" fill={EDGE_COLORS[t].stroke} />
              </marker>
            ))}
            {[['glow-blue','#4a9eff'],['glow-green','#10b981'],['glow-red','#ef4444']].map(([id, c]) => (
              <filter key={id} id={id} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
                <feFlood floodColor={c} floodOpacity="0.5" result="color" />
                <feComposite in="color" in2="blur" operator="in" result="shadow" />
                <feMerge><feMergeNode in="shadow" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            ))}
          </defs>

          {/* ── Edges ── */}
          {edges.map(edge => {
            if (edge.synthetic) return <DenyShield key={edge.id} edge={edge} nodeMap={nodeMap} />
            const d = arrowPath(edge.from, edge.to, nodeMap)
            if (!d) return null
            const ec  = edgeColor(edge)
            const isActive  = highlightedEdgeIds.size === 0 || highlightedEdgeIds.has(edge.id)
            const isHovered = hoveredEdge === edge.id
            const markerId  = edge.type === 'deny' ? 'deny'
              : edge.dir === 'ingress' ? 'ingress_allow' : 'egress_allow'
            const glowId    = edge.type === 'deny' ? 'glow-red'
              : edge.dir === 'ingress' ? 'glow-blue' : 'glow-green'

            return (
              <g key={edge.id}>
                {/* Wide invisible hit area */}
                <path d={d} stroke="transparent" strokeWidth={14} fill="none"
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={e => {
                    setHoveredEdge(edge.id)
                    const rect = containerRef.current?.getBoundingClientRect()
                    if (rect) setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, edge })
                  }}
                  onMouseLeave={() => { setHoveredEdge(null); setTooltip(null) }}
                />
                {/* Glow layer */}
                {isHovered && (
                  <path d={d} stroke={ec.glow} strokeWidth={4} fill="none"
                    opacity={0.3} filter={`url(#${glowId})`} />
                )}
                {/* Visible line */}
                <path
                  d={d}
                  stroke={ec.stroke}
                  strokeWidth={isHovered ? 2 : 1.5}
                  fill="none"
                  strokeDasharray={edge.type === 'deny' ? '5 4' : undefined}
                  opacity={isActive ? 1 : 0.1}
                  markerEnd={`url(#arrow-${markerId})`}
                  style={{ transition: 'opacity 0.15s, stroke-width 0.1s' }}
                />
                {/* Port label */}
                {isHovered && <PortLabel d={d} label={edge.ports} />}
              </g>
            )
          })}

          {/* ── Nodes ── */}
          {nodes.map(node => {
            const c = KIND_COLORS[node.kind] || KIND_COLORS.unknown
            const isSelected = selectedNode === node.id
            const isActive   = activeNodeId === node.id
            const dimmed     = !!activeNodeId && !isActive

            return (
              <g key={node.id}
                data-node="1"
                style={{ cursor: 'pointer', opacity: dimmed ? 0.2 : 1, transition: 'opacity 0.15s' }}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                onClick={() => setSelectedNode(s => s === node.id ? null : node.id)}
              >
                {/* Selection ring */}
                {isSelected && (
                  <rect
                    x={node.x - 4} y={node.y - 4}
                    width={NODE_W + 8} height={NODE_H + 8}
                    rx={10} fill="none"
                    stroke={c.stroke} strokeWidth={1.5} strokeDasharray="5 3"
                    opacity={0.7}
                  />
                )}
                {/* Card */}
                <rect
                  x={node.x} y={node.y}
                  width={NODE_W} height={NODE_H}
                  rx={7}
                  fill={isActive ? c.fill.replace('0.07', '0.18').replace('0.08', '0.18').replace('0.06', '0.15') : c.fill}
                  stroke={c.stroke}
                  strokeWidth={isActive ? 1.8 : 1}
                  style={{ transition: 'fill 0.12s, stroke-width 0.1s' }}
                />
                {/* Kind badge row */}
                <text
                  x={node.x + 10} y={node.y + 16}
                  fontFamily="var(--font-mono, monospace)"
                  fontSize={9} fontWeight={700} letterSpacing={0.8}
                  fill={c.text} opacity={0.65}
                  style={{ userSelect: 'none', pointerEvents: 'none' }}
                >
                  {kindIcon(node.kind)} {kindLabel(node.kind)}
                </text>
                {/* Main label */}
                <text
                  x={node.x + 10} y={node.y + 31}
                  fontFamily="var(--font-mono, monospace)"
                  fontSize={11}
                  fontWeight={node.kind === 'policy' ? 700 : 500}
                  fill={c.text}
                  style={{ userSelect: 'none', pointerEvents: 'none' }}
                >
                  {truncate(node.label, NODE_W - 20)}
                </text>
                {/* Sub label */}
                {node.sub && (
                  <text
                    x={node.x + 10} y={node.y + 45}
                    fontFamily="var(--font-mono, monospace)"
                    fontSize={9} fill="var(--text-muted)"
                    style={{ userSelect: 'none', pointerEvents: 'none' }}
                  >
                    {truncate(node.sub, NODE_W - 20)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>

        {/* Edge tooltip */}
        <AnimatePresence>
          {tooltip && <EdgeTooltip tooltip={tooltip} />}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ── Small helpers ──────────────────────────────────────────────────────────────

function kindIcon(kind) {
  return { policy: '⬡', pod: '◉', ns: '◈', ip: '◎', any: '∗', unknown: '?' }[kind] || '?'
}
function kindLabel(kind) {
  return { policy: 'POLICY', pod: 'POD', ns: 'NS', ip: 'IP', any: 'ANY', unknown: '?' }[kind] || '?'
}
function truncate(text = '', maxPx = 140) {
  const maxChars = Math.floor(maxPx / 7.2)
  return text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text
}

// ── Port label at edge midpoint ────────────────────────────────────────────────

function PortLabel({ d, label }) {
  try {
    const parts = d.replace(/[MCL]/g, '').trim().split(/\s+/)
    const nums  = parts.map(Number).filter(n => !isNaN(n))
    if (nums.length < 4) return null
    const mx = (nums[0] + nums[nums.length - 2]) / 2
    const my = (nums[1] + nums[nums.length - 1]) / 2
    const display = label.length > 20 ? label.slice(0, 19) + '…' : label
    const bw = display.length * 6.5 + 16
    return (
      <g>
        <rect x={mx - bw / 2} y={my - 9} width={bw} height={16} rx={4}
          fill="rgba(8,12,20,0.9)" stroke="rgba(74,158,255,0.3)" strokeWidth={0.8} />
        <text x={mx} y={my + 2.5} textAnchor="middle"
          fontFamily="monospace" fontSize={9} fill="rgba(74,158,255,0.9)">
          {display}
        </text>
      </g>
    )
  } catch { return null }
}

// ── Edge tooltip (DOM overlay) ─────────────────────────────────────────────────

function EdgeTooltip({ tooltip }) {
  const { x, y, edge } = tooltip
  const dirColor = edge.dir === 'ingress' ? 'var(--accent-blue)'
    : edge.type === 'deny' ? 'var(--accent-red)' : 'var(--accent-green)'
  const dirLabel = edge.dir === 'ingress' ? '↓ Ingress' : '↑ Egress'
  const typeLabel = edge.type === 'allow' ? 'Allow' : 'Deny'

  return (
    <motion.div
      className={styles.edgeTooltip}
      style={{ left: x + 14, top: y - 14 }}
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.1 }}
    >
      <div className={styles.tooltipDir} style={{ color: dirColor }}>
        {dirLabel} · <span className={styles.tooltipType}
          style={{ color: edge.type === 'deny' ? 'var(--accent-red)' : dirColor }}>
          {typeLabel}
        </span>
      </div>
      <div className={styles.tooltipPorts}>
        <span className={styles.tooltipLabel}>Ports:</span> {edge.ports}
      </div>
    </motion.div>
  )
}

// ── Legend ─────────────────────────────────────────────────────────────────────

function Legend() {
  const [open, setOpen] = useState(false)

  const nodeItems = [
    { color: 'var(--accent-blue)',   label: 'Policy node' },
    { color: 'var(--accent-green)',  label: 'Pod selector' },
    { color: 'var(--accent-purple)', label: 'Namespace' },
    { color: 'var(--accent-amber)',  label: 'IP Block' },
    { color: 'var(--text-muted)',    label: 'Any (wildcard)' },
  ]
  const edgeItems = [
    { color: 'rgba(74,158,255,0.75)',  label: 'Ingress allow', dash: false },
    { color: 'rgba(16,185,129,0.75)',  label: 'Egress allow',  dash: false },
    { color: 'rgba(239,68,68,0.75)',   label: 'Deny all',      dash: true  },
  ]

  return (
    <div className={styles.legendWrap}>
      <button className={styles.toolBtn} onClick={() => setOpen(v => !v)} title="Chú thích">
        <Info size={13} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className={styles.legend}
            initial={{ opacity: 0, y: -6, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.95 }}
            transition={{ duration: 0.12 }}>
            <div className={styles.legendSection}>NODES</div>
            {nodeItems.map(it => (
              <div key={it.label} className={styles.legendItem}>
                <span className={styles.legendDot} style={{ background: it.color }} />
                <span>{it.label}</span>
              </div>
            ))}
            <div className={styles.legendSection} style={{ marginTop: 8 }}>CONNECTIONS</div>
            {edgeItems.map(it => (
              <div key={it.label} className={styles.legendItem}>
                <svg width={24} height={8} style={{ flexShrink: 0 }}>
                  <line x1={0} y1={4} x2={24} y2={4}
                    stroke={it.color} strokeWidth={2}
                    strokeDasharray={it.dash ? '4 3' : undefined} />
                </svg>
                <span>{it.label}</span>
              </div>
            ))}
            <div className={styles.legendTip}>
              Click node để highlight connections
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
