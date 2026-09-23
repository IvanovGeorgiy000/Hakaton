"""Приём токенов Keycloak (RS256) наряду со своими (HS256). Keycloak не запускается — ключи и токен делаем сами."""

import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from tests.conftest import login_as

pytestmark = pytest.mark.anyio

ISSUER = "http://kc.test/realms/stroykontrol"
CLIENT = "stroykontrol-web"
_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_KID = "test-kid"


def _make_token(**over) -> str:
    now = int(time.time())
    payload = {
        "iss": ISSUER,
        "sub": "kc-sub-1",
        "azp": CLIENT,
        "aud": "account",
        "exp": now + 300,
        "iat": now,
        "preferred_username": "prorab",
        "name": "Кузнецов Андрей",
        "realm_access": {"roles": ["foreman", "offline_access"]},
    }
    payload.update(over)
    return jwt.encode(payload, _key, algorithm="RS256", headers={"kid": _KID})


@pytest.fixture
def keycloak(monkeypatch):
    """Включаем Keycloak и подменяем загрузку публичных ключей нашим ключом."""
    from app import keycloak as kc
    from app.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "keycloak_issuer", ISSUER)
    monkeypatch.setattr(settings, "keycloak_client_id", CLIENT)
    monkeypatch.setattr(kc.settings, "keycloak_issuer", ISSUER)
    monkeypatch.setattr(kc.settings, "keycloak_client_id", CLIENT)

    verifier = kc.KeycloakVerifier(ISSUER, CLIENT)
    verifier._keys = {_KID: jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(_jwk()))}
    verifier._fetched_at = time.monotonic() + 1e6  # чтобы не ходил в сеть
    monkeypatch.setattr(kc, "_verifier", verifier)
    monkeypatch.setattr(kc, "get_verifier", lambda: verifier)
    return verifier


def _jwk() -> dict:
    from jwt.algorithms import RSAAlgorithm

    return {**json.loads(RSAAlgorithm.to_jwk(_key.public_key())), "kid": _KID, "use": "sig", "alg": "RS256"}


async def test_meta_reports_keycloak(client, keycloak):
    meta = (await client.get("/api/meta")).json()
    assert meta["authMode"] == "keycloak"
    assert meta["keycloak"] == {"url": "http://kc.test", "realm": "stroykontrol", "clientId": CLIENT}


async def test_keycloak_token_maps_to_seeded_user_with_sites(client, keycloak):
    # preferred_username=prorab совпадает с посевным логином → получает его объект s1
    headers = {"Authorization": f"Bearer {_make_token()}"}
    me = await client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    assert me.json()["role"] == "foreman" and me.json()["siteIds"] == ["s1"]
    sites = (await client.get("/api/sites", headers=headers)).json()
    assert {s["id"] for s in sites} == {"s1"}


async def test_keycloak_unknown_user_is_provisioned_by_role(client, keycloak):
    token = _make_token(
        preferred_username="newmanager", sub="kc-sub-2", realm_access={"roles": ["manager"]}, name="Новый Руководитель"
    )
    me = (await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})).json()
    assert me["role"] == "manager" and me["siteIds"] == []
    # руководителю объекты не нужны для доступа — видит все
    sites = (await client.get("/api/sites", headers={"Authorization": f"Bearer {token}"})).json()
    assert len(sites) == 4


async def test_bad_and_foreign_tokens_rejected(client, keycloak):
    assert (await client.get("/api/auth/me", headers={"Authorization": "Bearer not.a.jwt"})).status_code == 401
    other = _make_token(azp="other-app", aud="other-app")
    assert (await client.get("/api/auth/me", headers={"Authorization": f"Bearer {other}"})).status_code == 401
    norole = _make_token(preferred_username="nobody", sub="kc-x", realm_access={"roles": ["offline_access"]})
    assert (await client.get("/api/auth/me", headers={"Authorization": f"Bearer {norole}"})).status_code == 403


async def test_local_login_still_works_when_keycloak_enabled(client, keycloak):
    # свои HS256-токены принимаются одновременно с Keycloak
    foreman = await login_as(client, "foreman")
    assert (await client.get("/api/alerts", headers=foreman)).status_code == 200
