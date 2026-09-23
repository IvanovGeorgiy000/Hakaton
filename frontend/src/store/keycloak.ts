/**
 * Вход через Keycloak (OpenID Connect). Включается, когда бэкенд в /meta сообщает authMode=keycloak.
 *
 * keycloak-js сам ведёт поток авторизации (redirect + PKCE) и обновляет токен; мы кладём свежий access-token
 * туда же, откуда его берёт API-клиент (setToken), поэтому остальной код запросов не меняется.
 */
import Keycloak from 'keycloak-js'
import { setToken } from '@/api'

export interface KeycloakConfig {
  url: string
  realm: string
  clientId: string
}

let instance: Keycloak | null = null
let ready: Promise<boolean> | null = null

/** Инициализировать один раз: тихо проверить активную сессию, наладить авто-обновление токена */
export function initKeycloak(cfg: KeycloakConfig): Promise<boolean> {
  if (ready) return ready
  instance = new Keycloak({ url: cfg.url, realm: cfg.realm, clientId: cfg.clientId })
  ready = instance
    .init({
      onLoad: 'check-sso',
      pkceMethod: 'S256',
      silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
      checkLoginIframe: false,
    })
    .then((authenticated) => {
      if (authenticated && instance!.token) setToken(instance!.token)
      // за минуту до истечения обновляем токен; если не вышло — отправляем на повторный вход
      instance!.onTokenExpired = () => {
        instance!
          .updateToken(60)
          .then((refreshed) => { if (refreshed && instance!.token) setToken(instance!.token) })
          .catch(() => instance!.login())
      }
      return authenticated
    })
    .catch(() => false)
  return ready
}

export function keycloakLogin() {
  instance?.login()
}

export function keycloakLogout() {
  setToken(null)
  instance?.logout({ redirectUri: window.location.origin })
}
