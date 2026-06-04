/**
 * OIDC Service – tích hợp với auth-service Spring Boot của rbac-gateway.
 */

export class OidcService {
  constructor(config) {
    this.config = config
    this.discoveryDoc = null
  }

  async fetchDiscovery() {
    if (this.discoveryDoc) return this.discoveryDoc
    const url = `${this.config.issuerUri}/.well-known/openid-configuration`
    const res = await this._fetch(url)
    if (!res.ok) throw new Error(`Discovery failed: ${res.status}`)
    this.discoveryDoc = await res.json()
    return this.discoveryDoc
  }

  async loginWithPassword(username, password) {
    const doc = await this.fetchDiscovery()
    const body = new URLSearchParams({ grant_type: 'password', username, password })
    if (this.config.clientId) body.set('client_id', this.config.clientId)
    doc.token_endpoint = `${this.config.issuerUri}/oauth2/token`
    const res = await this._fetch(doc.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Token request failed ${res.status}: ${err}`)
    }
    return await res.json()
  }

  async buildAuthorizationUrl(state, redirectUri) {
    const doc = await this.fetchDiscovery()
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId || 'k8s-desktop',
      redirect_uri: redirectUri,
      scope: 'openid profile email',
      state,
    })
    return `${doc.authorization_endpoint}?${params}`
  }

  async exchangeCode(code, redirectUri) {
    const doc = await this.fetchDiscovery()
    const body = new URLSearchParams({
      grant_type: 'authorization_code', code,
      redirect_uri: redirectUri,
      client_id: this.config.clientId || 'k8s-desktop',
    })
    if (this.config.clientSecret) body.set('client_secret', this.config.clientSecret)
    const res = await this._fetch(doc.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) throw new Error(`Code exchange failed: ${res.status}`)
    return await res.json()
  }

  async refreshToken(refreshToken) {
    const doc = await this.fetchDiscovery()
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken })
    if (this.config.clientId) body.set('client_id', this.config.clientId)
    const res = await this._fetch(doc.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) throw new Error(`Refresh failed: ${res.status}`)
    return await res.json()
  }

  async clientCredentials(clientId, clientSecret) {
    const doc = await this.fetchDiscovery()
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret })
    const res = await this._fetch(doc.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) throw new Error(`Client credentials failed: ${res.status}`)
    return await res.json()
  }

  async userInfo(accessToken) {
    const doc = await this.fetchDiscovery()
    const res = await this._fetch(doc.userinfo_endpoint, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) throw new Error(`UserInfo failed: ${res.status}`)
    return await res.json()
  }

  async fetchJwks() {
    const doc = await this.fetchDiscovery()
    const res = await this._fetch(doc.jwks_uri)
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`)
    return await res.json()
  }

  async _fetch(url, options = {}) {
    return fetch(url, { ...options, mode: 'cors' })
  }
}

// ── K8s API Service ────────────────────────────────────────────────────────────

export class K8sService {
  constructor(apiServerUrl, accessToken) {
    this.baseUrl = apiServerUrl.replace(/\/$/, '')
    this.token = accessToken
  }

  _headers(extra = {}) {
    return { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...extra }
  }

  async _call(path, method = 'GET', body = null, extraHeaders = {}) {
    const url = `${this.baseUrl}${path}`
    const contentTypeHeader = body ? { 'Content-Type': extraHeaders['Content-Type'] || 'application/json' } : {}
    const headers = this._headers({ ...contentTypeHeader, ...extraHeaders })
    const bodyStr = body ? JSON.stringify(body) : undefined

    if (window.electronAPI?.k8sFetch) {
      const result = await window.electronAPI.k8sFetch({ url, method, headers, body: bodyStr })
      if (result.status === 0) throw new Error(result.error?.trim() || `Không thể kết nối tới ${this.baseUrl}`)
      let data
      try { data = result.data ? JSON.parse(result.data) : {} }
      catch { data = { rawText: result.data } }
      if (result.status >= 400) throw new Error(data?.message || data?.reason || `HTTP ${result.status}`)
      return data
    } else {
      const res = await fetch(url, { method, headers, body: bodyStr })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.message || `HTTP ${res.status}`) }
      return await res.json()
    }
  }

  // ── Namespaces ─────────────────────────────────────────────────────────────

  async getNamespaces() {
    const data = await this._call('/api/v1/namespaces')
    return (data.items || []).map(ns => ({
      name: ns.metadata.name,
      status: ns.status?.phase || 'Unknown',
      labels: ns.metadata.labels || {},
      createdAt: ns.metadata.creationTimestamp,
    }))
  }

  async createNamespaceFromYaml(yamlObj) {
    return await this._call('/api/v1/namespaces', 'POST', yamlObj)
  }

  async deleteNamespace(name) {
    return await this._call(`/api/v1/namespaces/${name}`, 'DELETE')
  }

  // ── Secrets ────────────────────────────────────────────────────────────────

  async getSecrets(namespace = 'default') {
    const data = await this._call(`/api/v1/namespaces/${namespace}/secrets`)
    return (data.items || []).map(s => ({
      name: s.metadata.name, namespace: s.metadata.namespace,
      type: s.type || 'Opaque', dataKeys: Object.keys(s.data || {}),
      data: s.data || {}, metadata: s.metadata,
      resourceVersion: s.metadata.resourceVersion, uid: s.metadata.uid,
      createdAt: s.metadata.creationTimestamp,
    }))
  }

  async deleteSecret(name, namespace = 'default') {
    return await this._call(`/api/v1/namespaces/${namespace}/secrets/${name}`, 'DELETE')
  }

  // ── Services (k8s core) ────────────────────────────────────────────────────

  async getServices(namespace = 'default') {
    const data = await this._call(`/api/v1/namespaces/${namespace}/services`)
    return (data.items || []).map(s => ({
      name: s.metadata.name,
      namespace: s.metadata.namespace,
      labels: s.metadata.labels || {},
      ports: s.spec?.ports || [],
      selector: s.spec?.selector || {},
      clusterIP: s.spec?.clusterIP,
      type: s.spec?.type || 'ClusterIP',
    }))
  }

  // ── NetworkPolicy ──────────────────────────────────────────────────────────

  async getNetworkPolicies(namespace = 'default') {
    const data = await this._call(`/apis/networking.k8s.io/v1/namespaces/${namespace}/networkpolicies`)
    return (data.items || []).map(p => this._mapNetworkPolicy(p))
  }

  async createNetworkPolicy(manifest, namespace = 'default') {
    return await this._call(`/apis/networking.k8s.io/v1/namespaces/${namespace}/networkpolicies`, 'POST', manifest)
  }

  async updateNetworkPolicy(name, manifest, namespace = 'default') {
    return await this._call(`/apis/networking.k8s.io/v1/namespaces/${namespace}/networkpolicies/${name}`, 'PUT', manifest)
  }

  async deleteNetworkPolicy(name, namespace = 'default') {
    return await this._call(`/apis/networking.k8s.io/v1/namespaces/${namespace}/networkpolicies/${name}`, 'DELETE')
  }

  async getPodLabels(namespace = 'default') {
    const data = await this._call(`/api/v1/namespaces/${namespace}/pods`)
    const labelMap = {}
    for (const pod of (data.items || [])) {
      for (const [k, v] of Object.entries(pod.metadata?.labels || {})) {
        if (!labelMap[k]) labelMap[k] = new Set()
        labelMap[k].add(v)
      }
    }
    return Object.fromEntries(Object.entries(labelMap).map(([k, v]) => [k, [...v]]))
  }

  _mapNetworkPolicy(p) {
    const spec = p.spec || {}
    const policyTypes = spec.policyTypes || []
    const ingress = spec.ingress || []
    const egress  = spec.egress  || []
    return {
      name: p.metadata.name, namespace: p.metadata.namespace,
      uid: p.metadata.uid, createdAt: p.metadata.creationTimestamp,
      resourceVersion: p.metadata.resourceVersion, labels: p.metadata.labels || {},
      podSelector: spec.podSelector || {}, policyTypes, ingress, egress,
      hasIngress: policyTypes.includes('Ingress'), hasEgress: policyTypes.includes('Egress'),
      ingressCount: ingress.length, egressCount: egress.length,
      isDenyAllIngress: policyTypes.includes('Ingress') && ingress.length === 0,
      isDenyAllEgress:  policyTypes.includes('Egress')  && egress.length  === 0,
      raw: p,
    }
  }

  // ── Istio CRDs ─────────────────────────────────────────────────────────────
  // Base path helper cho Istio resources (networking.istio.io/v1beta1)

  _istioPath(resource, namespace, name = '') {
    const ns = namespace ? `/namespaces/${namespace}` : ''
    const suffix = name ? `/${name}` : ''
    return `/apis/networking.istio.io/v1beta1${ns}/${resource}${suffix}`
  }

  _securityIstioPath(resource, namespace, name = '') {
    const ns = namespace ? `/namespaces/${namespace}` : ''
    const suffix = name ? `/${name}` : ''
    return `/apis/security.istio.io/v1beta1${ns}/${resource}${suffix}`
  }

  _mapIstioMeta(item) {
    return {
      name:            item.metadata.name,
      namespace:       item.metadata.namespace,
      uid:             item.metadata.uid,
      createdAt:       item.metadata.creationTimestamp,
      resourceVersion: item.metadata.resourceVersion,
      labels:          item.metadata.labels || {},
      annotations:     item.metadata.annotations || {},
    }
  }

  // ── VirtualService ─────────────────────────────────────────────────────────

  async getVirtualServices(namespace = 'default') {
    const data = await this._call(this._istioPath('virtualservices', namespace))
    return (data.items || []).map(vs => ({
      ...this._mapIstioMeta(vs),
      hosts:    vs.spec?.hosts    || [],
      gateways: vs.spec?.gateways || [],
      http:     vs.spec?.http     || [],
      tcp:      vs.spec?.tcp      || [],
      tls:      vs.spec?.tls      || [],
      raw:      vs,
    }))
  }

  async createVirtualService(manifest, namespace = 'default') {
    return await this._call(this._istioPath('virtualservices', namespace), 'POST', manifest)
  }

  async updateVirtualService(name, manifest, namespace = 'default') {
    return await this._call(this._istioPath('virtualservices', namespace, name), 'PUT', manifest)
  }

  async deleteVirtualService(name, namespace = 'default') {
    return await this._call(this._istioPath('virtualservices', namespace, name), 'DELETE')
  }

  // ── DestinationRule ────────────────────────────────────────────────────────

  async getDestinationRules(namespace = 'default') {
    const data = await this._call(this._istioPath('destinationrules', namespace))
    return (data.items || []).map(dr => ({
      ...this._mapIstioMeta(dr),
      host:          dr.spec?.host || '',
      trafficPolicy: dr.spec?.trafficPolicy || null,
      subsets:       dr.spec?.subsets || [],
      exportTo:      dr.spec?.exportTo || [],
      raw:           dr,
    }))
  }

  async createDestinationRule(manifest, namespace = 'default') {
    return await this._call(this._istioPath('destinationrules', namespace), 'POST', manifest)
  }

  async updateDestinationRule(name, manifest, namespace = 'default') {
    return await this._call(this._istioPath('destinationrules', namespace, name), 'PUT', manifest)
  }

  async deleteDestinationRule(name, namespace = 'default') {
    return await this._call(this._istioPath('destinationrules', namespace, name), 'DELETE')
  }

  // ── Gateway ────────────────────────────────────────────────────────────────

  async getGateways(namespace = 'default') {
    const data = await this._call(this._istioPath('gateways', namespace))
    return (data.items || []).map(gw => ({
      ...this._mapIstioMeta(gw),
      selector: gw.spec?.selector || {},
      servers:  gw.spec?.servers  || [],
      raw:      gw,
    }))
  }

  async createGateway(manifest, namespace = 'default') {
    return await this._call(this._istioPath('gateways', namespace), 'POST', manifest)
  }

  async updateGateway(name, manifest, namespace = 'default') {
    return await this._call(this._istioPath('gateways', namespace, name), 'PUT', manifest)
  }

  async deleteGateway(name, namespace = 'default') {
    return await this._call(this._istioPath('gateways', namespace, name), 'DELETE')
  }

  // ── PeerAuthentication ─────────────────────────────────────────────────────

  async getPeerAuthentications(namespace = 'default') {
    const data = await this._call(this._securityIstioPath('peerauthentications', namespace))
    return (data.items || []).map(pa => ({
      ...this._mapIstioMeta(pa),
      selector:  pa.spec?.selector  || null,
      mtls:      pa.spec?.mtls      || null,
      portLevelMtls: pa.spec?.portLevelMtls || {},
      raw:       pa,
    }))
  }

  async createPeerAuthentication(manifest, namespace = 'default') {
    return await this._call(this._securityIstioPath('peerauthentications', namespace), 'POST', manifest)
  }

  async updatePeerAuthentication(name, manifest, namespace = 'default') {
    return await this._call(this._securityIstioPath('peerauthentications', namespace, name), 'PUT', manifest)
  }

  async deletePeerAuthentication(name, namespace = 'default') {
    return await this._call(this._securityIstioPath('peerauthentications', namespace, name), 'DELETE')
  }

  // ── ServiceEntry ───────────────────────────────────────────────────────────

  async getServiceEntries(namespace = 'default') {
    const data = await this._call(this._istioPath('serviceentries', namespace))
    return (data.items || []).map(se => ({
      ...this._mapIstioMeta(se),
      hosts:      se.spec?.hosts      || [],
      ports:      se.spec?.ports      || [],
      location:   se.spec?.location   || '',
      resolution: se.spec?.resolution || '',
      endpoints:  se.spec?.endpoints  || [],
      raw:        se,
    }))
  }

  async createServiceEntry(manifest, namespace = 'default') {
    return await this._call(this._istioPath('serviceentries', namespace), 'POST', manifest)
  }

  async updateServiceEntry(name, manifest, namespace = 'default') {
    return await this._call(this._istioPath('serviceentries', namespace, name), 'PUT', manifest)
  }

  async deleteServiceEntry(name, namespace = 'default') {
    return await this._call(this._istioPath('serviceentries', namespace, name), 'DELETE')
  }

  // ── Kiểm tra Istio đã cài chưa ────────────────────────────────────────────

  async checkIstioInstalled() {
    try {
      await this._call('/apis/networking.istio.io/v1beta1')
      return { installed: true }
    } catch (e) {
      return { installed: false, error: e.message }
    }
  }

  // ── Apply YAML manifest ────────────────────────────────────────────────────

  async applyManifest(manifest) {
    const { apiVersion = 'v1', kind, metadata } = manifest
    if (!kind) throw new Error('YAML thiếu field "kind"')
    if (!metadata?.name) throw new Error('YAML thiếu field "metadata.name"')
    const apiPath = this._buildApiPath(apiVersion, kind, metadata.namespace)
    const name = metadata.name
    try {
      return await this._call(`${apiPath}/${name}`, 'PATCH', manifest, { 'Content-Type': 'application/merge-patch+json' })
    } catch (patchErr) {
      if (patchErr.message?.includes('404') || patchErr.message?.includes('405') ||
          patchErr.message?.includes('not found') || patchErr.message?.includes('Not Found')) {
        return await this._call(apiPath, 'POST', manifest)
      }
      throw patchErr
    }
  }

  async applyYamlString(yamlString) {
    const { loadAll } = await import('js-yaml')
    const docs = loadAll(yamlString).filter(Boolean)
    if (docs.length === 0) throw new Error('YAML không chứa document nào hợp lệ')
    const results = []
    for (const doc of docs) {
      try {
        const result = await this.applyManifest(doc)
        const op = result?.metadata?.resourceVersion ? 'configured' : 'created'
        results.push({ ok: true, kind: doc.kind, name: doc.metadata?.name, op, result })
      } catch (e) {
        results.push({ ok: false, kind: doc.kind, name: doc.metadata?.name, error: e.message })
      }
    }
    return results
  }

  _buildApiPath(apiVersion, kind, namespace) {
    const kindLower = kind.toLowerCase()
    const plural = KIND_TO_PLURAL[kindLower] || kindLower + 's'
    const nsSegment = namespace ? `/namespaces/${namespace}` : ''
    if (apiVersion === 'v1') return `/api/v1${nsSegment}/${plural}`
    return `/apis/${apiVersion}${nsSegment}/${plural}`
  }

  async getVersion() {
    return await this._call('/version')
  }

  async healthCheck() {
    try { const data = await this._call('/version'); return !!data?.gitVersion }
    catch { return false }
  }
}

// Pluralisation map
const KIND_TO_PLURAL = {
  namespace: 'namespaces', deployment: 'deployments', service: 'services',
  pod: 'pods', configmap: 'configmaps', secret: 'secrets',
  serviceaccount: 'serviceaccounts', ingress: 'ingresses',
  persistentvolumeclaim: 'persistentvolumeclaims', persistentvolume: 'persistentvolumes',
  statefulset: 'statefulsets', daemonset: 'daemonsets', job: 'jobs',
  cronjob: 'cronjobs', replicaset: 'replicasets',
  horizontalpodautoscaler: 'horizontalpodautoscalers',
  clusterrole: 'clusterroles', clusterrolebinding: 'clusterrolebindings',
  role: 'roles', rolebinding: 'rolebindings',
  networkpolicy: 'networkpolicies',
  virtualservice: 'virtualservices',
  destinationrule: 'destinationrules',
  gateway: 'gateways',
  peerauthentication: 'peerauthentications',
  serviceentry: 'serviceentries',
}
