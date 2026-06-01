# Microservices Manager

Desktop app (Electron + React) quản lý Kubernetes với OIDC tích hợp **auth-service** từ `rbac-gateway`.

## Tính năng

- **OIDC Integration** – kết nối trực tiếp với auth-service Spring Boot
  - Password Grant (username/password → access_token + id_token)
  - Authorization Code Flow (mở browser, callback localhost)
  - Token refresh tự động
- **Namespace Manager** – xem, tạo, xoá Kubernetes namespaces
- **Apply YAML** – paste hoặc upload YAML manifest, apply vào cluster

## Cài đặt & chạy

```bash
npm install
npm run dev
```

## Cấu hình OIDC

Sau khi mở app, click **Settings** (gear icon) hoặc vào `/oidc-config`:

| Field | Giá trị mặc định | Mô tả |
|---|---|---|
| Issuer URI | `https://localhost` | URL của auth-service |
| Client ID | _(tùy chọn)_ | OAuth2 client ID |
| Client Secret | _(tùy chọn)_ | Chỉ cần với authorization_code flow |
| K8s API Server | `https://localhost:6443` | URL của Kubernetes API server |

### Password Grant (đơn giản nhất)

Dùng username/password để lấy token qua `POST /oauth2/token`.
Phù hợp cho dev và local k8s (minikube, kind).

### Browser Flow (authorization_code)

App mở browser → user đăng nhập → callback về `localhost:8989/callback`.
Cần `ClientID` và auth-service hỗ trợ authorization_code grant.

## Tích hợp với K8s

JWT từ auth-service chứa `roles` và `permissions` claims.
K8s API server cần được cấu hình với:

```
--oidc-issuer-url=https://localhost
--oidc-client-id=kubernetes
--oidc-username-claim=sub
--oidc-groups-claim=roles
```

Xem `E:\Projects\rbac-gateway\auth-service\OIDC_K8S_GUIDE.md` để biết thêm.

## Kiến trúc

```
src/
├── main/
│   ├── main.js        # Electron main process
│   └── preload.js     # Context bridge (IPC)
└── renderer/
    ├── App.jsx
    ├── services/
    │   └── oidcService.js   # OidcService + K8sService
    ├── store/
    │   └── index.js         # Zustand (auth + k8s state)
    └── pages/
        ├── LoginPage.jsx
        ├── OidcConfigPage.jsx
        ├── MainLayout.jsx
        ├── NamespacePage.jsx
        └── YamlApplyPage.jsx
```
