"""Проверка токенов Keycloak (OpenID Connect).

Включается настройкой SK_KEYCLOAK_ISSUER. Тогда бэкенд принимает и свои токены (HS256), и токены Keycloak (RS256):
подпись Keycloak-токена проверяется публичными ключами realm (JWKS), которые скачиваются один раз и кэшируются.
Роль берётся из realm-ролей токена, привязка к объектам — из базы по логину (preferred_username).
"""

import asyncio
import json
import time

import httpx
import jwt

from app.config import get_settings

settings = get_settings()

# Наши роли в порядке приоритета: если Keycloak выдал пользователю несколько, берём старшую
ROLE_PRIORITY = ("admin", "inspector", "manager", "foreman")
_JWKS_TTL = 3600.0


class KeycloakError(Exception):
    """Токен Keycloak не прошёл проверку."""


class KeycloakVerifier:
    def __init__(self, issuer: str, client_id: str, timeout: float = 8.0) -> None:
        self.issuer = issuer.rstrip("/")
        self.client_id = client_id
        self.timeout = timeout
        self._keys: dict[str, object] = {}
        self._fetched_at = 0.0
        self._lock = asyncio.Lock()

    async def _load_keys(self, *, force: bool = False) -> None:
        if not force and self._keys and time.monotonic() - self._fetched_at < _JWKS_TTL:
            return
        async with self._lock:
            if not force and self._keys and time.monotonic() - self._fetched_at < _JWKS_TTL:
                return
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    conf = (await client.get(f"{self.issuer}/.well-known/openid-configuration")).json()
                    jwks = (await client.get(conf["jwks_uri"])).json()
            except (httpx.HTTPError, ValueError, KeyError) as exc:
                raise KeycloakError(f"Не удалось получить ключи Keycloak: {exc}") from exc
            keys: dict[str, object] = {}
            for k in jwks.get("keys", []):
                if k.get("kty") == "RSA" and k.get("use", "sig") == "sig":
                    keys[k["kid"]] = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(k))
            if keys:
                self._keys = keys
                self._fetched_at = time.monotonic()

    async def verify(self, token: str) -> dict:
        try:
            kid = jwt.get_unverified_header(token).get("kid")
        except jwt.PyJWTError as exc:
            raise KeycloakError("Плохой заголовок токена") from exc

        await self._load_keys()
        key = self._keys.get(kid)
        if key is None:  # ключи Keycloak могли смениться — перечитаем один раз
            await self._load_keys(force=True)
            key = self._keys.get(kid)
        if key is None:
            raise KeycloakError("Неизвестный ключ подписи")

        try:
            claims = jwt.decode(token, key, algorithms=["RS256"], issuer=self.issuer, options={"verify_aud": False})
        except jwt.PyJWTError as exc:
            raise KeycloakError(f"Токен недействителен: {exc}") from exc

        # принимаем только токены нашего клиента (иначе токен другого приложения того же realm подошёл бы)
        aud = claims.get("aud")
        aud_ok = self.client_id in (aud if isinstance(aud, list) else [aud])
        if claims.get("azp") != self.client_id and not aud_ok:
            raise KeycloakError("Токен выдан другому приложению")
        return claims


def select_role(roles: set[str]) -> str | None:
    return next((r for r in ROLE_PRIORITY if r in roles), None)


def roles_from_claims(claims: dict) -> set[str]:
    realm = claims.get("realm_access", {}).get("roles", [])
    client = claims.get("resource_access", {}).get(settings.keycloak_client_id, {}).get("roles", [])
    return set(realm) | set(client)


_verifier: KeycloakVerifier | None = None


def get_verifier() -> KeycloakVerifier | None:
    global _verifier
    if not settings.keycloak_issuer:
        return None
    if _verifier is None:
        _verifier = KeycloakVerifier(settings.keycloak_issuer, settings.keycloak_client_id)
    return _verifier
