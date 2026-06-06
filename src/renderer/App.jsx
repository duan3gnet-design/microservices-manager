import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store'
import LoginPage from './pages/LoginPage'
import MainLayout from './pages/MainLayout'
import OidcConfigPage from './pages/OidcConfigPage'
import NamespacePage from './pages/NamespacePage'
import YamlApplyPage from './pages/YamlApplyPage'
import CertPage from './pages/CertPage'
import SecretPage from './pages/SecretPage'
import NetworkPolicyPage from './pages/NetworkPolicyPage'
import IstioPolicyPage from './pages/IstioPolicyPage'
import RbacPage from './pages/RbacPage'

function ProtectedRoute({ children }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  return isAuthenticated() ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/oidc-config" element={<OidcConfigPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/namespaces" replace />} />
          <Route path="namespaces"       element={<NamespacePage />} />
          <Route path="secrets"          element={<SecretPage />} />
          <Route path="network-policies" element={<NetworkPolicyPage />} />
          <Route path="istio"            element={<IstioPolicyPage />} />
          <Route path="apply"            element={<YamlApplyPage />} />
          <Route path="certs"            element={<CertPage />} />
          <Route path="rbac"             element={<RbacPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
