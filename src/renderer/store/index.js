import { create } from 'zustand'

// ── Auth Store ───────────────────────────────────────────────────────────────
export const useAuthStore = create((set, get) => ({
  // OIDC config (saved per cluster)
  oidcConfig: JSON.parse(localStorage.getItem('oidc_config') || 'null'),

  // Tokens
  tokens: JSON.parse(sessionStorage.getItem('oidc_tokens') || 'null'),
  user: JSON.parse(sessionStorage.getItem('oidc_user') || 'null'),

  setOidcConfig: (config) => {
    localStorage.setItem('oidc_config', JSON.stringify(config))
    set({ oidcConfig: config })
  },

  setTokens: (tokens) => {
    sessionStorage.setItem('oidc_tokens', JSON.stringify(tokens))
    // Parse user info từ id_token hoặc access_token
    const token = tokens?.id_token || tokens?.access_token
    let user = null
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
        user = {
          username: payload.sub || payload.email || 'unknown',
          email: payload.email || payload.sub,
          roles: payload.roles || [],
          permissions: payload.permissions || [],
          exp: payload.exp,
        }
      } catch { /* ignore parse error */ }
    }
    sessionStorage.setItem('oidc_user', JSON.stringify(user))
    set({ tokens, user })
  },

  logout: () => {
    sessionStorage.removeItem('oidc_tokens')
    sessionStorage.removeItem('oidc_user')
    set({ tokens: null, user: null })
  },

  isAuthenticated: () => {
    const { tokens } = get()
    if (!tokens?.access_token) return false
    try {
      const payload = JSON.parse(atob(tokens.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      return payload.exp * 1000 > Date.now()
    } catch { return false }
  },
}))

// ── K8s Store ────────────────────────────────────────────────────────────────
export const useK8sStore = create((set, get) => ({
  // Cluster config
  clusters: JSON.parse(localStorage.getItem('k8s_clusters') || '[]'),
  activeCluster: JSON.parse(localStorage.getItem('k8s_active_cluster') || 'null'),

  // UI state
  selectedNamespace: 'default',
  namespaces: [],

  // Resources
  namespaceYaml: '',
  applyResult: null,
  loading: false,
  error: null,

  setClusters: (clusters) => {
    localStorage.setItem('k8s_clusters', JSON.stringify(clusters))
    set({ clusters })
  },

  addCluster: (cluster) => {
    const clusters = [...get().clusters.filter(c => c.name !== cluster.name), cluster]
    localStorage.setItem('k8s_clusters', JSON.stringify(clusters))
    set({ clusters })
  },

  setActiveCluster: (cluster) => {
    localStorage.setItem('k8s_active_cluster', JSON.stringify(cluster))
    set({ activeCluster: cluster, selectedNamespace: 'default', namespaces: [] })
  },

  setNamespace: (ns) => set({ selectedNamespace: ns }),
  setNamespaces: (namespaces) => set({ namespaces }),
  setNamespaceYaml: (yaml) => set({ namespaceYaml: yaml }),
  setApplyResult: (result) => set({ applyResult: result }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}))
