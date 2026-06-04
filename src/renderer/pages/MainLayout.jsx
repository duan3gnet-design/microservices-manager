import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Layers, FileCode, LogOut, User, Server,
  ChevronDown, Shield, Settings, ChevronRight,
  ShieldCheck, KeyRound, Network, GitBranch,
} from 'lucide-react'
import { useAuthStore, useK8sStore } from '@/store'
import { useTokenRefresh } from '@/hooks/useAuth'
import TokenInfoPanel from '../components/TokenInfoPanel'
import styles from './MainLayout.module.css'

export default function MainLayout() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const { activeCluster, clusters, setActiveCluster } = useK8sStore()
  const [showTokenPanel, setShowTokenPanel] = useState(false)

  useTokenRefresh()

  const handleLogout = () => { logout(); navigate('/login') }

  const NAV_GROUPS = [
    {
      label: 'KUBERNETES',
      items: [
        { to: '/namespaces',       icon: Layers,      label: 'Namespaces' },
        { to: '/secrets',          icon: KeyRound,    label: 'Secrets' },
        { to: '/network-policies', icon: Network,     label: 'Network Policies' },
        { to: '/apply',            icon: FileCode,    label: 'Apply YAML' },
      ],
    },
    {
      label: 'SERVICE MESH',
      items: [
        { to: '/istio', icon: GitBranch, label: 'Istio' },
      ],
    },
    {
      label: 'TOOLS',
      items: [
        { to: '/certs', icon: ShieldCheck, label: 'Certificates' },
      ],
    },
  ]

  return (
    <div className={styles.root}>
      <aside className={styles.sidebar}>

        {/* Brand */}
        <div className={styles.brand}>
          <div className={styles.brandIcon}>
            <Server size={16} color="var(--accent-blue)" />
          </div>
          <div>
            <div className={styles.brandName}>MS Manager</div>
            <div className={styles.brandVersion}>v1.0.0</div>
          </div>
        </div>

        {/* Cluster selector */}
        <div className={styles.clusterSelector}>
          <div className={styles.clusterLabel}>CLUSTER</div>
          <div className={styles.clusterSelect}>
            <span className={`status-dot ${activeCluster ? 'active' : 'error'}`} />
            <select
              className={styles.clusterDropdown}
              value={activeCluster?.name || ''}
              onChange={e => {
                const c = clusters.find(cl => cl.name === e.target.value)
                if (c) setActiveCluster(c)
              }}
            >
              {clusters.length === 0
                ? <option value="">Chưa có cluster</option>
                : clusters.map(c => <option key={c.name} value={c.name}>{c.name}</option>)
              }
            </select>
            <ChevronDown size={12} color="var(--text-muted)" style={{ flexShrink: 0 }} />
          </div>
          {activeCluster?.apiServer && (
            <div className={styles.apiServer} title={activeCluster.apiServer}>
              {activeCluster.apiServer}
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className={styles.nav}>
          {NAV_GROUPS.map(group => (
            <div key={group.label} className={styles.navGroup}>
              <div className={styles.navGroupLabel}>{group.label}</div>
              {group.items.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `${styles.navItem} ${isActive ? styles.navActive : ''}`
                  }
                >
                  <Icon size={15} />
                  <span>{label}</span>
                  <ChevronRight size={11} className={styles.navArrow} />
                </NavLink>
              ))}
            </div>
          ))}

          {/* Settings */}
          <div className={styles.navGroup}>
            <div className={styles.navGroupLabel}>SETTINGS</div>
            <button className={styles.navItem} onClick={() => navigate('/oidc-config')}>
              <Settings size={15} />
              <span>OIDC Config</span>
              <ChevronRight size={11} className={styles.navArrow} />
            </button>
          </div>
        </nav>

        {/* Token info */}
        <button
          className={`${styles.tokenBtn} ${showTokenPanel ? styles.tokenBtnActive : ''}`}
          onClick={() => setShowTokenPanel(v => !v)}
        >
          <Shield size={13} />
          <span>Token Info</span>
          <span className={styles.tokenDot} />
        </button>

        {/* User */}
        <div className={styles.userSection}>
          <div className={styles.userInfo}>
            <div className={styles.userAvatar}>
              <User size={14} color="var(--accent-blue)" />
            </div>
            <div className={styles.userDetails}>
              <div className={styles.username} title={user?.username}>
                {user?.username || 'Unknown'}
              </div>
              <div className={styles.userRoles}>
                {user?.roles?.slice(0, 2).join(', ') || 'No roles'}
              </div>
            </div>
          </div>
          <button className={styles.logoutBtn} onClick={handleLogout} title="Đăng xuất">
            <LogOut size={14} />
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className={styles.contentArea}>
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          style={{ height: '100%' }}
        >
          <Outlet />
        </motion.div>
      </div>

      <AnimatePresence>
        {showTokenPanel && (
          <TokenInfoPanel onClose={() => setShowTokenPanel(false)} />
        )}
      </AnimatePresence>
    </div>
  )
}
