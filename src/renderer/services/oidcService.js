/**
 * OIDC Service – tích hợp với auth-service Spring Boot của rbac-gateway.
 *
 * auth-service expose:
 *   GET  /.well-known/openid-configuration  → discovery document
 *   GET  /oauth2/jwks                        → JWKS (public RSA key)
 *   POST /oauth2/token                       → token endpoint (password / refresh / client_credentials)
 *   GET  /oauth2/userinfo                    → userinfo
 *
 * Desktop app dùng "password" grant (trực tiếp nhập username/password)
 * hoặc "authorization_code" flow qua browser khi config có authorization_endpoint.
 */

export class OidcService {
  constructor(config) {
    // config = { issuerUri, clientId?, clientSecret?, redirectUri? }
    this.config = config
    this.discoveryDoc = null
  }

  // ── Discovery ──────────────────────────────────────────────────────────────

  async fetchDiscovery() {
    if (this.discoveryDoc) return this.discoveryDoc

    const url = `${this.config.issuerUri}/.well-known/openid-configuration`
    const res = await this._fetch(url)
    if (!res.ok) throw new Error(`Discovery failed: ${res.status}`)
    this.discoveryDoc = await res.json()
    return this.discoveryDoc
  }

  // ── Password Grant ─────────────────────────────────────────────────────────

  async loginWithPassword(username, password) {
    const doc = await this.fetchDiscovery()
    const body = new URLSearchParams({ grant_type: 'password', username, password })
    if (this.config.clientId) body.set('client_id', this.config.clientId)

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

  // ── Authorization Code Flow ────────────────────────────────────────────────

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
      grant_type: 'authorization_code',
      code,
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

  // ── Refresh Token ──────────────────────────────────────────────────────────

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

  // ── Client Credentials ─────────────────────────────────────────────────────

  async clientCredentials(clientId, clientSecret) {
    const doc = await this.fetchDiscovery()
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    })
    const res = await this._fetch(doc.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) throw new Error(`Client credentials failed: ${res.status}`)
    return await res.json()
  }

  // ── UserInfo / JWKS ────────────────────────────────────────────────────────

  async userInfo(accessToken) {
    const doc = await this.fetchDiscovery()
    const res = await this._fetch(doc.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
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
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
      ...extra,
    }
  }

  /**
   * Gọi Kubernetes API qua Electron IPC proxy (main.js k8s:fetch).
   *
   * Tại sao dùng IPC thay vì fetch trực tiếp từ renderer?
   *  1. K8s API server thường dùng self-signed TLS → browser fetch reject
   *  2. CORS header không được set trên k8s API server
   *  3. Main process có thể set rejectUnauthorized: false an toàn
   *
   * @param {string} path    - API path, e.g. "/api/v1/namespaces"
   * @param {string} method  - HTTP method
   * @param {object} body    - Request body (sẽ được JSON.stringify)
   * @param {object} extraHeaders - Override headers (e.g. Content-Type cho PATCH)
   */
  async _call(path, method = 'GET', body = null, extraHeaders = {}) {
    const url = `${this.baseUrl}${path}`

    // Xác định Content-Type: chỉ set khi có body
    const contentTypeHeader = body
      ? { 'Content-Type': extraHeaders['Content-Type'] || 'application/json' }
      : {}

    const headers = this._headers({ ...contentTypeHeader, ...extraHeaders })

    // Body phải là string để truyền qua IPC serialization
    const bodyStr = body ? JSON.stringify(body) : undefined

    if (window.electronAPI?.k8sFetch) {
      const result = await window.electronAPI.k8sFetch({ url, method, headers, body: bodyStr })

      // status: 0 → network error (ECONNREFUSED, timeout, SSL, …)
      if (result.status === 0) {
        const msg = result.error && result.error.trim()
          ? result.error
          : `Không thể kết nối tới ${this.baseUrl} — kiểm tra cluster đang chạy và API server URL đúng`
        throw new Error(msg)
      }

      // Parse JSON response — k8s luôn trả JSON kể cả lỗi
      let data
      try {
        data = result.data ? JSON.parse(result.data) : {}
      } catch {
        // Một số endpoint (như /healthz) trả plain text
        data = { rawText: result.data }
      }

      if (result.status >= 400) {
        // K8s error format: { kind: "Status", message: "...", reason: "..." }
        const msg = data?.message || data?.reason || `HTTP ${result.status}`
        throw new Error(msg)
      }

      return data
    } else {
      // Fallback khi chạy ngoài Electron (browser dev mode)
      const res = await fetch(url, { method, headers, body: bodyStr })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.message || `HTTP ${res.status}`)
      }
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

  // ── Apply YAML manifest ────────────────────────────────────────────────────

  /**
   * Apply một manifest object (đã parse từ YAML).
   * Logic giống `kubectl apply`:
   *  1. Thử server-side apply (PATCH với strategic-merge-patch)
   *  2. Nếu 404 (chưa tồn tại) → POST để create
   *  3. Nếu 405 (resource không support PATCH) → POST
   */
  async applyManifest(manifest) {
    const { apiVersion = 'v1', kind, metadata } = manifest
    if (!kind) throw new Error('YAML thiếu field "kind"')
    if (!metadata?.name) throw new Error('YAML thiếu field "metadata.name"')

    const apiPath = this._buildApiPath(apiVersion, kind, metadata.namespace)
    const name = metadata.name

    try {
      // Thử PATCH trước (update nếu đã tồn tại)
      return await this._call(
        `${apiPath}/${name}`,
        'PATCH',
        manifest,
        { 'Content-Type': 'application/merge-patch+json' }
      )
    } catch (patchErr) {
      // 404: chưa có → tạo mới
      // 405: resource này không support PATCH → tạo mới
      // Các lỗi khác (401, 403, 422…) → re-throw
      if (patchErr.message?.includes('404') || patchErr.message?.includes('405') ||
          patchErr.message?.includes('not found') || patchErr.message?.includes('Not Found')) {
        return await this._call(apiPath, 'POST', manifest)
      }
      throw patchErr
    }
  }

  /**
   * Apply một chuỗi YAML (có thể chứa nhiều documents phân cách bởi ---).
   * Trả về mảng kết quả cho từng document.
   */
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

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Build đúng API path cho từng resource type.
   *
   * Core API (v1): /api/v1[/namespaces/{ns}]/{resource}
   * Named API groups (apps/v1, …): /apis/{group}/{version}[/namespaces/{ns}]/{resource}
   */
  _buildApiPath(apiVersion, kind, namespace) {
    // Pluralise kind (naive, đủ cho các resource phổ biến)
    const kindLower = kind.toLowerCase()
    const plural = KIND_TO_PLURAL[kindLower] || kindLower + 's'

    const nsSegment = namespace ? `/namespaces/${namespace}` : ''

    if (apiVersion === 'v1') {
      return `/api/v1${nsSegment}/${plural}`
    }

    // e.g. apiVersion = "apps/v1" → group="apps", version="v1"
    return `/apis/${apiVersion}${nsSegment}/${plural}`
  }

  async getVersion() {
    return await this._call('/version')
  }

  async healthCheck() {
    try {
      const data = await this._call('/version')
      return !!data?.gitVersion
    } catch {
      return false
    }
  }
}

// Pluralisation map cho các resource hay gặp
const KIND_TO_PLURAL = {
  namespace: 'namespaces',
  deployment: 'deployments',
  service: 'services',
  pod: 'pods',
  configmap: 'configmaps',
  secret: 'secrets',
  serviceaccount: 'serviceaccounts',
  ingress: 'ingresses',
  persistentvolumeclaim: 'persistentvolumeclaims',
  persistentvolume: 'persistentvolumes',
  statefulset: 'statefulsets',
  daemonset: 'daemonsets',
  job: 'jobs',
  cronjob: 'cronjobs',
  replicaset: 'replicasets',
  horizontalpodautoscaler: 'horizontalpodautoscalers',
  clusterrole: 'clusterroles',
  clusterrolebinding: 'clusterrolebindings',
  role: 'roles',
  rolebinding: 'rolebindings',
}
