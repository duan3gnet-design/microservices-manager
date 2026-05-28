import { useEffect, useRef, useCallback } from 'react'
import { useAuthStore, useK8sStore } from '../store'
import { OidcService, K8sService } from '../services/oidcService'

/**
 * Hook tự động refresh access token khi sắp hết hạn.
 * Đặt ở root layout (MainLayout) để session luôn sống.
 */
export function useTokenRefresh() {
  const { tokens, oidcConfig, setTokens, logout } = useAuthStore()
  const timerRef = useRef(null)

  const scheduleRefresh = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const at = tokens?.access_token
    if (!at) return

    try {
      const payload = JSON.parse(
        atob(at.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
      )
      const msUntilExpiry = payload.exp * 1000 - Date.now()
      // Refresh khi còn 2 phút
      const delay = Math.max(msUntilExpiry - 2 * 60 * 1000, 30_000)

      timerRef.current = setTimeout(async () => {
        if (!tokens?.refresh_token || !oidcConfig?.issuerUri) {
          logout()
          return
        }
        try {
          const svc = new OidcService(oidcConfig)
          const newTokens = await svc.refreshToken(tokens.refresh_token)
          setTokens(newTokens)
        } catch {
          logout()
        }
      }, delay)
    } catch { /* invalid token */ }
  }, [tokens, oidcConfig, setTokens, logout])

  useEffect(() => {
    scheduleRefresh()
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [scheduleRefresh])
}

/**
 * Hook decode và trả về thông tin từ các OIDC tokens.
 */
export function useTokenInfo() {
  const { tokens } = useAuthStore()

  const decode = (token) => {
    if (!token) return null
    try {
      const [h, p] = token.split('.')
      return {
        header: JSON.parse(atob(h.replace(/-/g, '+').replace(/_/g, '/'))),
        payload: JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/'))),
      }
    } catch { return null }
  }

  const accessDecoded = decode(tokens?.access_token)
  const idDecoded = decode(tokens?.id_token)
  const now = Math.floor(Date.now() / 1000)
  const expTs = accessDecoded?.payload?.exp
  const expiresIn = expTs ? expTs - now : null

  const fmtExpiry = (s) => {
    if (s === null) return null
    if (s <= 0) return 'Đã hết hạn'
    if (s > 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
    if (s > 60) return `${Math.floor(s / 60)}m ${s % 60}s`
    return `${s}s`
  }

  return {
    accessToken: tokens?.access_token || null,
    refreshToken: tokens?.refresh_token || null,
    idToken: tokens?.id_token || null,
    accessDecoded,
    idDecoded,
    expiresIn,
    isExpired: expiresIn !== null && expiresIn <= 0,
    expiresInHuman: fmtExpiry(expiresIn),
  }
}

/**
 * Hook để lấy K8sService đã được khởi tạo với token hiện tại.
 */
export function useK8sService() {
  const { tokens } = useAuthStore()
  const { activeCluster } = useK8sStore()

  return useCallback(() => {
    if (!activeCluster?.apiServer || !tokens?.access_token) return null
    return new K8sService(activeCluster.apiServer, tokens.access_token)
  }, [activeCluster, tokens])
}
