import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy.engine import make_url

import app.auth
from app.auth import REFRESH_COOKIE
from app.config import Settings
from app.main import create_app
from app.models import Base, utcnow
from app.security import encode_token
from tests.conftest import PASSWORD, ClientFactory, error_code, login, make_settings, register


def refresh_cookie(client) -> str | None:
    return client.cookies.get(REFRESH_COOKIE, path="/api/auth")


def use_refresh_token(client, token: str | None) -> None:
    """Replaces the browser's refresh cookie, e.g. with an old (copied) token."""
    client.cookies.clear()
    client.cookies.set(REFRESH_COOKIE, token, domain="testserver.local", path="/api/auth")


async def test_register_logs_in_and_sets_refresh_cookie(client):
    response = await client.post(
        "/api/auth/register", json={"email": "  Anna@Example.COM", "password": PASSWORD}
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["tokenType"] == "bearer"
    assert body["expiresIn"] == 15 * 60
    assert body["user"]["email"] == "anna@example.com"
    assert body["user"]["displayName"] == "anna"

    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f"{REFRESH_COOKIE}=")
    assert "HttpOnly" in cookie
    assert "Path=/api/auth" in cookie
    assert "SameSite=strict" in cookie
    assert "Secure" not in cookie  # plain HTTP

    me = await client.get("/api/users/me", headers={"authorization": f"Bearer {body['accessToken']}"})
    assert me.status_code == 200
    assert me.json()["id"] == body["user"]["id"]


async def test_register_rejects_taken_email_case_insensitively(client, make_client: ClientFactory):
    await register(client, "anna@example.com")
    other = await make_client()
    response = await other.post(
        "/api/auth/register", json={"email": "ANNA@example.com", "password": PASSWORD}
    )
    assert response.status_code == 409
    assert error_code(response) == "email_taken"


@pytest.mark.parametrize(
    "payload",
    [
        {"email": "anna@example.com", "password": "short"},
        {"email": "not-an-email", "password": PASSWORD},
        {"email": "anna@example.com", "password": PASSWORD, "isAdmin": True},
    ],
)
async def test_register_validates_input(client, payload):
    response = await client.post("/api/auth/register", json=payload)
    assert response.status_code == 422


async def test_registration_can_be_closed(tmp_path: Path):

    closed = create_app(make_settings(tmp_path, registration_open=False))
    async with closed.router.lifespan_context(closed):
        transport = httpx.ASGITransport(app=closed)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.post(
                "/api/auth/register", json={"email": "anna@example.com", "password": PASSWORD}
            )
    assert response.status_code == 403
    assert error_code(response) == "registration_closed"


async def test_login_does_not_reveal_whether_the_email_exists(client, make_client: ClientFactory):
    await register(client)
    other = await make_client()
    wrong_password = await other.post(
        "/api/auth/login", json={"email": "anna@example.com", "password": "nope"}
    )
    unknown_email = await other.post("/api/auth/login", json={"email": "bob@example.com", "password": "nope"})
    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json() == unknown_email.json()
    assert error_code(wrong_password) == "invalid_credentials"

    await login(other, "ANNA@example.com")
    assert (await other.get("/api/users/me")).status_code == 200


async def test_protected_routes_need_a_valid_access_token(client, settings: Settings):
    await register(client)
    refresh_token = refresh_cookie(client)

    missing = await client.get("/api/users/me", headers={"authorization": ""})
    assert missing.status_code == 401
    assert error_code(missing) == "not_authenticated"
    assert missing.headers["www-authenticate"] == "Bearer"

    garbage = await client.get("/api/users/me", headers={"authorization": "Bearer abc.def.ghi"})
    assert error_code(garbage) == "invalid_token"

    # A refresh token is not an access token.
    confused = await client.get("/api/users/me", headers={"authorization": f"Bearer {refresh_token}"})
    assert error_code(confused) == "invalid_token"

    forged = encode_token(
        make_settings(Path("."), jwt_secret="another-secret-0123456789abcdef0123456789"),
        "access",
        user_id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        jti="x",
        expires_at=utcnow() + timedelta(minutes=5),
    )
    assert error_code(await client.get("/api/users/me", headers={"authorization": f"Bearer {forged}"})) == (
        "invalid_token"
    )


async def test_expired_access_token_asks_for_refresh(client, settings: Settings):
    await register(client)
    me = (await client.get("/api/users/me")).json()
    sessions = (await client.get("/api/auth/sessions")).json()
    expired = encode_token(
        settings,
        "access",
        user_id=uuid.UUID(me["id"]),
        session_id=uuid.UUID(sessions[0]["id"]),
        jti="x",
        expires_at=utcnow() - timedelta(minutes=1),
    )
    response = await client.get("/api/users/me", headers={"authorization": f"Bearer {expired}"})
    assert response.status_code == 401
    assert error_code(response) == "token_expired"


async def test_refresh_rotates_the_refresh_token(client):
    first_access = await register(client)
    first_refresh = refresh_cookie(client)

    response = await client.post("/api/auth/refresh")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["accessToken"] != first_access
    assert body["user"]["email"] == "anna@example.com"
    assert refresh_cookie(client) not in (None, first_refresh)

    me = await client.get("/api/users/me", headers={"authorization": f"Bearer {body['accessToken']}"})
    assert me.status_code == 200


async def test_refresh_without_cookie(client):
    response = await client.post("/api/auth/refresh")
    assert response.status_code == 401
    assert error_code(response) == "no_refresh_token"


async def test_previous_refresh_token_is_honoured_within_grace_period(client):
    """Two tabs refresh at once: the one that loses the race must not log the user out."""
    await register(client)
    old = refresh_cookie(client)
    assert (await client.post("/api/auth/refresh")).status_code == 200
    current = refresh_cookie(client)

    use_refresh_token(client, old)
    response = await client.post("/api/auth/refresh")
    assert response.status_code == 200, response.text
    # The late tab receives the current token instead of rotating again.
    assert refresh_cookie(client) == current


async def test_parallel_refreshes_with_the_same_token_all_succeed(make_client: ClientFactory):
    """Several tabs restored at once: they all send the same cookie."""
    first = await make_client()
    await register(first)
    token = refresh_cookie(first)
    tabs = [await make_client() for _ in range(5)]
    for tab in tabs:
        use_refresh_token(tab, token)

    responses = await asyncio.gather(*(tab.post("/api/auth/refresh") for tab in tabs))
    assert [r.status_code for r in responses] == [200] * 5
    # Exactly one of them rotated the token, the others received the result.
    assert len({refresh_cookie(tab) for tab in tabs}) == 1
    assert refresh_cookie(tabs[0]) != token


async def test_a_late_tab_survives_another_refresh_in_between(client, make_client: ClientFactory):
    """A tab sends the old token after another tab already refreshed twice with the new one."""
    await register(client)
    old = refresh_cookie(client)
    assert (await client.post("/api/auth/refresh")).status_code == 200
    current = refresh_cookie(client)
    # Within the grace period the token is not rotated again, so `old` stays the previous one.
    assert (await client.post("/api/auth/refresh")).status_code == 200
    assert refresh_cookie(client) == current

    late = await make_client()
    use_refresh_token(late, old)
    response = await late.post("/api/auth/refresh")
    assert response.status_code == 200, response.text
    assert refresh_cookie(late) == current
    assert (await client.post("/api/auth/refresh")).status_code == 200


async def test_refresh_rotates_again_after_the_grace_period(client, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(app.auth, "REFRESH_REUSE_GRACE", timedelta(0))
    await register(client)
    seen = {refresh_cookie(client)}
    for _ in range(3):
        assert (await client.post("/api/auth/refresh")).status_code == 200
        seen.add(refresh_cookie(client))
    assert len(seen) == 4


async def test_reused_refresh_token_ends_the_session(client, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(app.auth, "REFRESH_REUSE_GRACE", timedelta(0))
    await register(client)
    stolen = refresh_cookie(client)
    rotated = await client.post("/api/auth/refresh")
    access = rotated.json()["accessToken"]
    current = refresh_cookie(client)

    use_refresh_token(client, stolen)
    reused = await client.post("/api/auth/refresh")
    assert reused.status_code == 401
    assert error_code(reused) == "refresh_token_reused"
    assert 'loader3d_refresh=""' in reused.headers["set-cookie"]

    # Both the attacker and the legitimate holder are logged out.
    use_refresh_token(client, current)
    assert error_code(await client.post("/api/auth/refresh")) == "session_expired"
    me = await client.get("/api/users/me", headers={"authorization": f"Bearer {access}"})
    assert error_code(me) == "session_expired"


async def test_logout_ends_the_session_immediately(client):
    access = await register(client)
    response = await client.post("/api/auth/logout")
    assert response.status_code == 204
    assert refresh_cookie(client) is None

    me = await client.get("/api/users/me", headers={"authorization": f"Bearer {access}"})
    assert error_code(me) == "session_expired"
    assert (await client.post("/api/auth/refresh")).status_code == 401
    # Logging out twice is harmless.
    assert (await client.post("/api/auth/logout")).status_code == 204


async def test_sessions_can_be_listed_and_revoked(make_client: ClientFactory):
    laptop = await make_client("Laptop")
    phone = await make_client("Phone")
    tablet = await make_client("Tablet")
    await register(laptop)
    await login(phone)
    await login(tablet)

    sessions = (await laptop.get("/api/auth/sessions")).json()
    assert [s["userAgent"] for s in sessions] == ["Tablet", "Phone", "Laptop"]
    assert [s["current"] for s in sessions] == [False, False, True]
    assert sessions[0]["ipAddress"] == "127.0.0.1"

    phone_id = sessions[1]["id"]
    assert (await laptop.delete(f"/api/auth/sessions/{phone_id}")).status_code == 204
    assert error_code(await phone.get("/api/users/me")) == "session_expired"
    assert (await laptop.delete(f"/api/auth/sessions/{phone_id}")).status_code == 404

    assert (await laptop.delete("/api/auth/sessions")).status_code == 204
    assert error_code(await tablet.get("/api/users/me")) == "session_expired"
    remaining = (await laptop.get("/api/auth/sessions")).json()
    assert [s["userAgent"] for s in remaining] == ["Laptop"]


async def test_sessions_of_other_users_cannot_be_revoked(make_client: ClientFactory):
    anna = await make_client()
    bob = await make_client()
    await register(anna)
    await register(bob, "bob@example.com")
    anna_session = (await anna.get("/api/auth/sessions")).json()[0]["id"]
    assert (await bob.delete(f"/api/auth/sessions/{anna_session}")).status_code == 404
    assert (await anna.get("/api/users/me")).status_code == 200


async def test_change_password_ends_other_sessions(make_client: ClientFactory):
    laptop = await make_client("Laptop")
    phone = await make_client("Phone")
    await register(laptop)
    await login(phone)

    wrong = await laptop.post(
        "/api/users/me/password", json={"currentPassword": "nope", "newPassword": "new password 123"}
    )
    assert wrong.status_code == 400
    assert error_code(wrong) == "wrong_password"

    changed = await laptop.post(
        "/api/users/me/password", json={"currentPassword": PASSWORD, "newPassword": "new password 123"}
    )
    assert changed.status_code == 204
    assert (await laptop.get("/api/users/me")).status_code == 200
    assert error_code(await phone.get("/api/users/me")) == "session_expired"

    fresh = await make_client()
    old = await fresh.post("/api/auth/login", json={"email": "anna@example.com", "password": PASSWORD})
    assert old.status_code == 401
    await login(fresh, password="new password 123")


async def test_update_profile(client):
    await register(client, display_name="Анна")
    assert (await client.get("/api/users/me")).json()["displayName"] == "Анна"
    response = await client.patch("/api/users/me", json={"displayName": "  Анна К.  "})
    assert response.status_code == 200
    assert response.json()["displayName"] == "Анна К."
    assert (await client.patch("/api/users/me", json={"displayName": "   "})).status_code == 422


async def test_delete_account_removes_plans_and_sessions(client, make_client: ClientFactory):
    await register(client)
    plan = (await client.post("/api/plans", json={"name": "Рейс"})).json()

    wrong = await client.request("DELETE", "/api/users/me", json={"password": "nope"})
    assert wrong.status_code == 400
    response = await client.request("DELETE", "/api/users/me", json={"password": PASSWORD})
    assert response.status_code == 204
    assert error_code(await client.get(f"/api/plans/{plan['id']}")) == "session_expired"

    other = await make_client()
    gone = await other.post("/api/auth/login", json={"email": "anna@example.com", "password": PASSWORD})
    assert gone.status_code == 401
    # The e-mail is free again, and the new account does not see the old plans.
    await register(other)
    assert (await other.get("/api/plans")).json()["total"] == 0


def test_production_requires_a_real_jwt_secret():
    with pytest.raises(ValidationError, match="JWT_SECRET"):
        Settings(_env_file=None, environment="production")  # type: ignore[call-arg]
    with pytest.raises(ValidationError, match="JWT_SECRET"):
        Settings(_env_file=None, environment="production", jwt_secret="short")  # type: ignore[call-arg]
    Settings(_env_file=None, environment="production", jwt_secret="x" * 32)  # type: ignore[call-arg]


@pytest.mark.parametrize(
    ("base_url", "origin", "secure"),
    [
        # The site opened by IP over plain HTTP: a Secure cookie would be dropped by the browser.
        ("http://testserver", "http://203.0.113.7", False),
        # HTTPS terminated by a proxy in front: the backend itself is reached over HTTP.
        ("http://testserver", "https://loader.example.com", True),
        ("https://testserver", "https://loader.example.com", True),
        # No Origin (not a browser page): the scheme of the request decides.
        ("https://testserver", None, True),
        ("http://testserver", None, False),
    ],
)
async def test_refresh_cookie_is_secure_exactly_on_https(
    tmp_path: Path, base_url: str, origin: str | None, secure: bool
):
    async with production_client(tmp_path, base_url, origin) as client:
        response = await client.post(
            "/api/auth/register", json={"email": "a@example.com", "password": PASSWORD}
        )
        assert response.status_code == 201, response.text
        assert ("; Secure" in response.headers["set-cookie"]) is secure
        logout = await client.post("/api/auth/logout")
        assert ("; Secure" in logout.headers["set-cookie"]) is secure


async def test_login_survives_a_reload_on_a_plain_http_production_site(tmp_path: Path):
    """The default deployment (SITE_ADDRESS=:80, opened by IP) used to lose the login on every reload."""
    async with production_client(tmp_path, "http://testserver", "http://203.0.113.7") as client:
        await register(client)
        del client.headers["authorization"]  # a reload: the access token in memory is gone
        refreshed = await client.post("/api/auth/refresh")
        assert refreshed.status_code == 200, refreshed.text


@asynccontextmanager
async def production_client(
    tmp_path: Path, base_url: str, origin: str | None
) -> AsyncIterator[httpx.AsyncClient]:
    api = create_app(make_settings(tmp_path, environment="production", jwt_secret="x" * 32))
    async with api.router.lifespan_context(api):
        async with api.state.engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=api),
            base_url=base_url,
            headers={"origin": origin} if origin else {},
        ) as client:
            yield client


def test_database_password_may_contain_any_characters():
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None,
        database_url="postgresql+asyncpg://loader3d@db:5432/loader3d",
        database_password="p@ss:w/rd%#",
    )
    url = make_url(settings.sqlalchemy_url)
    assert url.password == "p@ss:w/rd%#"
    assert (url.username, url.host, url.port, url.database) == ("loader3d", "db", 5432, "loader3d")


def test_cors_origins_are_comma_separated(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CORS_ORIGINS", "https://a.example, https://b.example")
    assert Settings(_env_file=None).cors_origins == ["https://a.example", "https://b.example"]  # type: ignore[call-arg]
