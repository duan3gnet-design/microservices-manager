# Microservices Manager

Desktop app **Electron + React** quản lý Kubernetes với OIDC tích hợp auth-service Spring Boot từ `rbac-gateway`. Hỗ trợ quản lý toàn diện tài nguyên K8s, Istio service mesh, certificate generation và secret management.

---

## Mục lục

- [Cài đặt & chạy](#cài-đặt--chạy)
- [Cấu hình OIDC](#cấu-hình-oidc)
- [Tính năng](#tính-năng)
- [Kiến trúc](#kiến-trúc)
- [Tích hợp K8s API Server](#tích-hợp-k8s-api-server)
- [Tech stack](#tech-stack)

---

## Cài đặt & chạy

```bash
cd E:\Projects\microservices-manager
npm install
npm run dev
```

Build production:

```bash
npm run build
```

Output binary tại `dist-electron/`.

---

## Cấu hình OIDC

Khi mở app lần đầu, vào **Settings → OIDC Config** hoặc click gear icon trên Login page:

| Field          | Mặc định                 | Mô tả                                 |
|----------------|--------------------------|---------------------------------------|
| Issuer URI     | `https://localhost`      | URL public của auth-service           |
| Client ID      | kubernetes               | OAuth2 client ID                      |
| Client Secret  | _(tùy chọn)_             | Chỉ cần với `authorization_code` flow |
| K8s API Server | `https://localhost:6443` | URL của Kubernetes API server         |
| Cluster Name   | `local-k8s`              | Tên hiển thị trong sidebar            |

### Login modes

**Password Grant** — nhập username/password, gọi `POST /oauth2/token` trực tiếp. Phù hợp dev local (minikube, kind).

**Browser Flow** — mở browser → user đăng nhập → callback về `http://localhost:8989/callback`. Cần auth-service hỗ trợ `authorization_code` grant.

---

## Tính năng

### 🔐 OIDC Authentication
- Password Grant và Authorization Code Flow
- Auto token refresh — schedule refresh 2 phút trước khi access token hết hạn
- **Token Inspector panel** — decode JWT claims, hiện thời gian còn lại, copy lệnh `kubectl --token=...`
- Discovery document test khi cấu hình OIDC

### ☸️ Namespace Manager
- List namespaces với status, labels, created time
- Tạo namespace mới với label editor và YAML preview
- Xoá namespace với confirm dialog

### 🔒 Secret Manager
- List secrets filter theo type (Opaque, TLS, Docker, Basic Auth, SSH, SA Token)
- **Drawer view/edit** với mask/reveal từng value
- TLS secrets: nút **Chọn file** mở native Open Dialog đọc `.crt`/`.key`/`.pem`
- Auto base64 encode khi save, auto decode khi hiển thị
- Tạo mới với preset fields theo type

### 🌐 Network Policy Manager
- List policies hiển thị dạng card với ingress/egress badges
- **Form editor**: Pod Selector với autocomplete từ labels thực tế, toggle Ingress/Egress, Deny All
- Rule builder: thêm peers (Pod Selector / Namespace Selector / IP Block) và ports
- YAML preview realtime khi edit form
- Xoá policy với confirm dialog

### 🔀 Istio Service Mesh
Hỗ trợ 5 Istio CRD types qua tab navigation:

| Resource               | API Group                     | Tính năng                                                                          |
|------------------------|-------------------------------|------------------------------------------------------------------------------------|
| **VirtualService**     | `networking.istio.io/v1beta1` | Traffic routing, HTTP routes, timeout, retry, traffic splitting theo weight        |
| **DestinationRule**    | `networking.istio.io/v1beta1` | Load balancing, mTLS mode, Circuit Breaker (outlier detection), subsets            |
| **Gateway**            | `networking.istio.io/v1beta1` | Ingress/egress gateway, servers với port/protocol/TLS mode                         |
| **PeerAuthentication** | `security.istio.io/v1beta1`   | mTLS policy: STRICT / PERMISSIVE / DISABLE / UNSET per namespace hoặc pod selector |
| **ServiceEntry**       | `networking.istio.io/v1beta1` | Đăng ký external services vào mesh, DNS/STATIC resolution                          |

- Badge **Istio installed / not found** trên header
- Warning banner + lệnh install khi cluster chưa có Istio CRD
- Form editor + YAML preview cho từng resource type

### 📄 Apply YAML
- Monaco-like textarea editor với line numbers, Tab support
- Upload file `.yaml`/`.yml`/`.json`
- Multi-document support (phân tách bằng `---`)
- 3 example presets: Namespace, Deployment, ConfigMap
- Result panel hiện `created`/`configured`/`failed` cho từng document

### 🔑 Certificate Generator
Tạo X.509 certificate **không cần `openssl` CLI**, dùng thuần Node.js `crypto`:

**CA Store + 3-mode generation:**
- **Root CA** — `basicConstraints CA:true`, `keyCertSign`, `cRLSign`, validity 10 năm
- **Leaf Certificate** — ký bởi Root CA từ CA Store, thêm AKI extension
- **Self-Signed** — tự ký, phù hợp local dev

**Features:**
- 4 presets: K8s API Server, OIDC/auth-service, mTLS Client, Localhost Dev
- Subject Alternative Names: DNS / IP / Email
- Key Usage + Extended Key Usage checkboxes
- RSA 2048 / 4096 bit
- Fingerprint SHA-256, PEM viewer, copy/save file
- **Chain export** (leaf + CA cert) cho nginx/k8s TLS secret
- Snippet `kubectl create secret tls` tự động điền tên

---

## Kiến trúc

```
src/
├── main/
│   ├── main.js              # Electron main process
│   │                        #   ├─ OIDC callback server (localhost:8989)
│   │                        #   ├─ k8s:fetch  — HTTP proxy bypass CORS/SSL
│   │                        #   ├─ cert:generate-ca / cert:sign-leaf / cert:generate
│   │                        #   ├─ cert:save-file  — native Save Dialog
│   │                        #   └─ file:open-text  — native Open Dialog
│   └── preload.js           # Context bridge — expose electronAPI to renderer
│
└── renderer/
    ├── App.jsx              # Router (BrowserRouter)
    ├── index.css            # Design tokens (CSS vars)
    ├── services/
    │   └── oidcService.js   # OidcService + K8sService (all API calls)
    ├── store/
    │   └── index.js         # Zustand — useAuthStore, useK8sStore
    ├── hooks/
    │   └── useAuth.js       # useTokenRefresh, useTokenInfo, useK8sService
    ├── components/
    │   ├── TokenInfoPanel   # Slide panel decode JWT
    │   └── CreateNsDialog   # Dialog tạo namespace
    └── pages/
        ├── LoginPage        # Password Grant + Browser Flow
        ├── OidcConfigPage   # Config + test discovery
        ├── MainLayout       # Sidebar navigation + token refresh
        ├── NamespacePage    # Namespace CRUD
        ├── SecretPage       # Secret CRUD với file pick cho TLS
        ├── NetworkPolicyPage # NetworkPolicy editor
        ├── IstioPolicyPage  # VirtualService / DestinationRule / Gateway / PeerAuth / ServiceEntry
        ├── YamlApplyPage    # Apply YAML manifest
        └── CertPage         # Certificate generator (Root CA + Leaf + Self-Signed)
```

---

## Tích hợp K8s API Server

JWT từ auth-service chứa `roles` và `permissions` claims. Cấu hình K8s API server với OIDC:

```
--oidc-issuer-url=http://localhost:8081
--oidc-client-id=kubernetes
--oidc-username-claim=sub
--oidc-groups-claim=roles
```

Sau đó tạo ClusterRoleBinding để map roles từ JWT:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: oidc-devops-binding
subjects:
- kind: Group
  # Nếu bạn dùng prefix (ví dụ oidc_), hãy thêm vào đây
  name: oidc_ROLE_ADMIN
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: cluster-admin
  apiGroup: rbac.authorization.k8s.io
```

Tham khảo thêm: `rbac-gateway\auth-service\OIDC_K8S_GUIDE.md`

---

## Tech stack

| Layer            | Technology                                   |
|------------------|----------------------------------------------|
| Desktop shell    | Electron 33                                  |
| UI framework     | React 18 + React Router 7                    |
| Styling          | CSS Modules + CSS custom properties          |
| State management | Zustand 5                                    |
| Animation        | Framer Motion                                |
| Icons            | Lucide React                                 |
| YAML             | js-yaml                                      |
| Build            | Vite 6                                       |
| Crypto (certs)   | Node.js built-in `crypto` (ASN.1 DER manual) |

---

## Notes

- **SSL**: App dùng `rejectUnauthorized: false` cho K8s API và OIDC calls — phù hợp local dev với self-signed cert. Production nên import CA cert vào trust store.
- **CA Store**: Chỉ tồn tại trong session, không persist. Export CA cert/key trước khi đóng app nếu cần dùng lại.
- **Istio**: Cần Istio ≥ 1.17 (API group `networking.istio.io/v1beta1`). Kiểm tra với `istioctl version`.
- **Token storage**: Access/refresh token lưu trong `sessionStorage` (xoá khi đóng tab), OIDC config lưu trong `localStorage`.
