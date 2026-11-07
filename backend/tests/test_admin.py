import pytest

from app.__main__ import set_admin
from tests.conftest import PASSWORD, ClientFactory, error_code, login, make_admin, make_settings, register


@pytest.fixture
def settings(tmp_path):
    """Tiers are off by default (TIERS_ENABLED): this module tests them switched on."""
    return make_settings(tmp_path, tiers_enabled=True)


@pytest.fixture
async def admin(app, client):
    await register(client, "admin@example.com")
    await make_admin(app, "admin@example.com")
    return client


@pytest.fixture
async def bob(make_client: ClientFactory):
    client = await make_client("bob's phone")
    await register(client, "bob@example.com", displayName="Боб")
    return client


async def bob_id(admin) -> str:
    users = (await admin.get("/api/admin/users", params={"q": "bob"})).json()["items"]
    return users[0]["id"]


async def test_admin_api_needs_the_admin_role(client, bob):
    assert (await client.get("/api/admin/users")).status_code == 401
    response = await bob.get("/api/admin/users")
    assert response.status_code == 403
    assert error_code(response) == "forbidden"
    assert (await bob.get("/api/users/me")).json()["isAdmin"] is False


async def test_users_list_with_search_filters_and_counts(admin, bob):
    await bob.post("/api/plans", json={"name": "Рейс"})
    page = (await admin.get("/api/admin/users")).json()
    assert page["total"] == 2
    assert {u["email"] for u in page["items"]} == {"admin@example.com", "bob@example.com"}

    found = (await admin.get("/api/admin/users", params={"q": "Боб"})).json()["items"]
    assert [u["email"] for u in found] == ["bob@example.com"]
    assert found[0]["planCount"] == 1
    assert found[0]["sessionCount"] == 1
    assert found[0]["lastActiveAt"] is not None
    assert found[0]["subscription"]["tier"] == "free"

    admins = (await admin.get("/api/admin/users", params={"status": "admins"})).json()["items"]
    assert [u["email"] for u in admins] == ["admin@example.com"]
    assert (await admin.get("/api/admin/users", params={"tier": "pro"})).json()["total"] == 0
    assert (await admin.get("/api/admin/users", params={"sort": "-lastActiveAt"})).status_code == 200


async def test_blocking_ends_sessions_and_refuses_login(admin, bob, make_client: ClientFactory):
    uid = await bob_id(admin)
    blocked = await admin.patch(f"/api/admin/users/{uid}", json={"isActive": False})
    assert blocked.json()["isActive"] is False
    assert blocked.json()["sessionCount"] == 0
    assert (await bob.get("/api/plans")).status_code == 401

    again = await make_client()
    response = await again.post("/api/auth/login", json={"email": "bob@example.com", "password": PASSWORD})
    assert response.status_code == 403
    assert error_code(response) == "account_disabled"
    # A wrong password does not reveal that the account exists and is blocked.
    wrong = await again.post("/api/auth/login", json={"email": "bob@example.com", "password": "nope"})
    assert error_code(wrong) == "invalid_credentials"

    await admin.patch(f"/api/admin/users/{uid}", json={"isActive": True})
    await login(again, "bob@example.com")


async def test_admin_cannot_lock_themselves_out(admin):
    me = (await admin.get("/api/users/me")).json()
    for change in ({"isActive": False}, {"isAdmin": False}):
        assert (
            error_code(await admin.patch(f"/api/admin/users/{me['id']}", json=change)) == "cannot_change_self"
        )
    assert error_code(await admin.delete(f"/api/admin/users/{me['id']}")) == "cannot_change_self"
    # Renaming oneself is fine.
    assert (
        await admin.patch(f"/api/admin/users/{me['id']}", json={"displayName": "Админ"})
    ).status_code == 200


async def test_custom_subscription_with_its_own_limits(admin, bob):
    uid = await bob_id(admin)
    response = await admin.put(
        f"/api/admin/users/{uid}/subscription",
        json={"tier": "custom", "limits": {"plans": 50, "vehicles": 4}, "note": "Договор № 7"},
    )
    assert response.status_code == 200, response.text
    sub = response.json()["subscription"]
    assert sub == {
        "tier": "custom",
        "effectiveTier": "custom",
        "expiresAt": None,
        "trial": False,
        "trialUsed": False,
        "limits": {"plans": 50, "vehicles": 4, "items": None},
        "note": "Договор № 7",
    }
    mine = (await bob.get("/api/users/me")).json()["subscription"]
    assert mine["name"] == "Индивидуальный"
    assert mine["limits"] == {"plans": 50, "vehicles": 4, "items": 5000, "autoload": True, "pdfSteps": True}


async def test_pro_with_an_end_date(admin, bob):
    uid = await bob_id(admin)
    response = await admin.put(
        f"/api/admin/users/{uid}/subscription", json={"tier": "pro", "expiresAt": "2099-01-01T00:00:00Z"}
    )
    assert response.json()["subscription"]["effectiveTier"] == "pro"
    assert (await bob.get("/api/users/me")).json()["subscription"]["expiresAt"].startswith("2099-01-01")
    naive = await admin.put(
        f"/api/admin/users/{uid}/subscription", json={"tier": "pro", "expiresAt": "2099-01-01T00:00:00"}
    )
    assert naive.status_code == 422
    trial_custom = await admin.put(
        f"/api/admin/users/{uid}/subscription", json={"tier": "custom", "trial": True}
    )
    assert trial_custom.status_code == 422


async def test_create_reset_password_and_delete(admin, make_client: ClientFactory):
    created = await admin.post(
        "/api/admin/users",
        json={"email": "Carol@Example.com", "password": PASSWORD, "tier": "custom", "isAdmin": False},
    )
    assert created.status_code == 201, created.text
    carol = created.json()
    assert carol["email"] == "carol@example.com"
    assert carol["subscription"]["tier"] == "custom"
    duplicate = await admin.post(
        "/api/admin/users", json={"email": "carol@example.com", "password": PASSWORD}
    )
    assert error_code(duplicate) == "email_taken"

    device = await make_client()
    await login(device, "carol@example.com")
    reset = await admin.post(
        f"/api/admin/users/{carol['id']}/password", json={"newPassword": "another secret"}
    )
    assert reset.status_code == 204
    assert (await device.get("/api/users/me")).status_code == 401
    await login(device, "carol@example.com", "another secret")

    assert (await admin.delete(f"/api/admin/users/{carol['id']}/sessions")).status_code == 204
    assert (await device.get("/api/users/me")).status_code == 401
    assert (await admin.delete(f"/api/admin/users/{carol['id']}")).status_code == 204
    assert error_code(await admin.get(f"/api/admin/users/{carol['id']}")) == "user_not_found"


async def test_stats(admin, bob):
    await bob.post("/api/plans", json={"name": "Рейс"})
    await bob.post("/api/leads", json={"name": "Боб", "email": "bob@example.com", "tier": "custom"})
    stats = (await admin.get("/api/admin/stats")).json()
    assert stats["users"] == 2
    assert stats["newLast7Days"] == 2
    assert stats["activeLast7Days"] == 2
    assert stats["admins"] == 1
    assert stats["blocked"] == 0
    assert stats["byTier"] == {"free": 2, "pro": 0, "custom": 0}
    assert stats["plans"] == 1
    assert stats["newLeads"] == 1


async def test_leads_inbox(admin, bob):
    await bob.post(
        "/api/leads", json={"name": "Боб", "phone": "+7 900 000-00-00", "message": "Нужно 30 машин"}
    )
    page = (await admin.get("/api/admin/leads", params={"status": "new"})).json()
    assert page["total"] == 1
    lead = page["items"][0]
    assert lead["message"] == "Нужно 30 машин"
    assert lead["userId"] == (await bob.get("/api/users/me")).json()["id"]

    done = await admin.patch(f"/api/admin/leads/{lead['id']}", json={"status": "done"})
    assert done.json()["status"] == "done"
    assert (await admin.get("/api/admin/leads", params={"status": "new"})).json()["total"] == 0
    assert (await admin.delete(f"/api/admin/leads/{lead['id']}")).status_code == 204
    assert error_code(await admin.delete(f"/api/admin/leads/{lead['id']}")) == "lead_not_found"


async def test_make_admin_command(settings, client):
    """`python -m app make-admin EMAIL [--revoke]`."""
    await register(client)
    assert await set_admin(settings, "nobody@example.com", True) is False
    assert await set_admin(settings, " Anna@Example.com ", True) is True
    assert (await client.get("/api/users/me")).json()["isAdmin"] is True
    assert await set_admin(settings, "anna@example.com", False) is True
    assert (await client.get("/api/admin/users")).status_code == 403
