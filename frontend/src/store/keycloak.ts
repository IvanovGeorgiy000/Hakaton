/**
 * Вход через Keycloak (OpenID Connect). Включается, когда бэкенд в /meta сообщает authMode=keycloak.
 *
 * keycloak-js сам ведёт поток авторизации (redirect + PKCE) и обновляет токен; мы кладём свежий access-token
 * туда же, откуда его берёт API-клиент (setToken), поэтому остальной код запросов не меняется.
 */
import Keycloak from 'keycloak-js'
import { setToken, setTokenRefresher } from '@/api'

export interface KeycloakConfig {
  url: string
  realm: string
  clientId: string
}

let instance: Keycloak | null = null
let ready: Promise<boolean> | null = null
let unavailable = false  // проверка сессии не удалась: Keycloak не отвечает или браузер не может войти

/** Инициализировать один раз: тихо проверить активную сессию и подключить продление токена */
export function initKeycloak(cfg: KeycloakConfig): Promise<boolean> {
  if (ready) return ready
  const kc = new Keycloak({ url: cfg.url, realm: cfg.realm, clientId: cfg.clientId })
  instance = kc
  ready = kc
    .init({
      onLoad: 'check-sso',
      pkceMethod: 'S256',
      silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
      checkLoginIframe: false,
    })
    .then((authenticated) => {
      if (authenticated && kc.token) {
        setToken(kc.token)
        // Перед каждым запросом: осталось меньше 30 с — обновляем. Обновление ровно в момент истечения опаздывало:
        // опрос, ушедший в эту долю секунды, получал 401 и выкидывал из системы.
        setTokenRefresher(async () => {
          if ((await kc.updateToken(30)) && kc.token) setToken(kc.token)
        })
      }
      return authenticated
    })
    .catch(() => {
      unavailable = true
      return false
    })
  return ready
}

/** Перейти на страницу входа Keycloak. Если отсюда войти нельзя — понятная ошибка вместо молчащей кнопки. */
export async function keycloakLogin(): Promise<void> {
  // PKCE требует Web Crypto, а он есть только на https и localhost: по http://192.168.… с телефона вход не заработает
  if (!window.isSecureContext) throw new Error('Вход через Keycloak работает только по https или прямо на сервере (localhost).')
  if (!instance || unavailable) throw new Error('Сервер входа Keycloak не отвечает. Проверьте, что он запущен, и обновите страницу.')
  await instance.login()
}

/** Выход по кнопке: завершаем и сессию Keycloak, иначе следующий вход прошёл бы без пароля */
export function keycloakLogout() {
  setTokenRefresher(null)
  if (instance?.authenticated) instance.logout({ redirectUri: window.location.origin })
}
