"""Subscriptions (app/tiers.py), display settings and requests from the landing page."""

import copy
from datetime import timedelta

import pytest
from sqlalchemy import update

from app.models import User, utcnow
from tests.conftest import ClientFactory, error_code, login, make_settings, register
from tests.test_plans import plan_data


@pytest.fixture
def settings(tmp_path):
    """Tiers are off by default (TIERS_ENABLED): this module tests them switched on."""
    return make_settings(tmp_path, tiers_enabled=True)


async def test_new_account_starts_on_the_free_tier(client):
    await register(client)
    sub = (await client.get("/api/users/me")).json()["subscription"]
    assert sub["tier"] == "free"
    assert sub["name"] == "Старт"
    assert sub["expiresAt"] is None
    assert sub["trialAvailable"] is True
    assert sub["limits"] == {"plans": 3, "vehicles": 1, "items": 100, "autoload": False, "pdfSteps": False}


async def test_registering_for_pro_starts_its_trial_once(client):
    response = await client.post(
        "/api/auth/register", json={"email": "anna@example.com", "password": "correct horse", "tier": "pro"}
    )
    sub = response.json()["user"]["subscription"]
    assert sub["tier"] == "pro"
    assert sub["trial"] is True
    assert sub["trialAvailable"] is False
    assert sub["limits"]["autoload"] is True
    client.headers["authorization"] = f"Bearer {response.json()['accessToken']}"
    assert error_code(await client.post("/api/users/me/trial")) == "trial_used"


async def test_custom_tier_cannot_be_chosen_on_registration(client):
    response = await client.post(
        "/api/auth/register",
        json={"email": "anna@example.com", "password": "correct horse", "tier": "custom"},
    )
    assert response.status_code == 422


async def test_trial_from_the_account_page(client):
    await register(client)
    sub = (await client.post("/api/users/me/trial")).json()["subscription"]
    assert sub["tier"] == "pro"
    assert sub["trial"] is True
    assert error_code(await client.post("/api/users/me/trial")) == "trial_used"


async def test_free_tier_limits_plans_vehicles_and_items(client):
    await register(client)
    for n in range(3):
        assert (await client.post("/api/plans", json={"name": f"Рейс {n}"})).status_code == 201
    response = await client.post("/api/plans", json={"name": "Четвёртый"})
    assert response.status_code == 403
    assert error_code(response) == "plan_limit"
    assert response.json()["detail"]["message"].startswith(
        "На тарифе «Старт» можно сохранить не больше 3 схем"
    )

    plans = (await client.get("/api/plans")).json()["items"]
    assert error_code(await client.post(f"/api/plans/{plans[0]['id']}/duplicate", json={})) == "plan_limit"

    plan = (await client.get(f"/api/plans/{plans[0]['id']}")).json()
    two = plan_data()
    second = copy.deepcopy(two["vehicles"][0])
    second.update(id="veh-2", name="Машина 2")
    second["bodies"][0]["id"] = "body-2"
    two["vehicles"].append(second)
    response = await client.patch(f"/api/plans/{plan['id']}", json={"version": plan["version"], "data": two})
    assert error_code(response) == "vehicle_limit"
    assert "не больше 1 машины" in response.json()["detail"]["message"]
    response = await client.patch(
        f"/api/plans/{plan['id']}", json={"version": plan["version"], "data": plan_data(101)}
    )
    assert error_code(response) == "item_limit"
    ok = await client.patch(
        f"/api/plans/{plan['id']}", json={"version": plan["version"], "data": plan_data(100)}
    )
    assert ok.status_code == 200


async def test_expired_pro_works_as_free_and_big_plans_stay_editable(app, client):
    await register(client, tier="pro")
    plan = (await client.post("/api/plans", json={"name": "Большой", "data": plan_data(150)})).json()
    async with app.state.sessionmaker() as db:
        await db.execute(update(User).values(tier_expires_at=utcnow() - timedelta(minutes=1)))
        await db.commit()

    sub = (await client.get("/api/users/me")).json()["subscription"]
    assert sub["tier"] == "free"
    assert sub["expiredTier"] == "pro"
    # Over the limit already: it may shrink or stay, not grow.
    url = f"/api/plans/{plan['id']}"
    saved = await client.patch(url, json={"version": plan["version"], "data": plan_data(140)})
    assert saved.status_code == 200
    grown = await client.patch(url, json={"version": saved.json()["version"], "data": plan_data(141)})
    assert error_code(grown) == "item_limit"


async def test_display_settings_follow_the_account(client, make_client: ClientFactory):
    await register(client)
    assert (await client.get("/api/users/me")).json()["settings"] is None
    saved = await client.patch("/api/users/me/settings", json={"units": "m", "showBodyWalls": False})
    assert saved.json() == {"units": "m", "showBodyWalls": False}
    merged = await client.patch("/api/users/me/settings", json={"xray": "auto", "xrayOpacity": 0.3})
    assert merged.json() == {"units": "m", "showBodyWalls": False, "xray": "auto", "xrayOpacity": 0.3}

    other_device = await make_client()
    await login(other_device)
    me = (await other_device.get("/api/users/me")).json()
    assert me["settings"]["units"] == "m"


async def test_display_settings_are_validated(client):
    await register(client)
    for bad in ({"units": "inch"}, {"xrayOpacity": 2}, {"unknownSetting": True}, {"snapping": "maybe"}):
        assert (await client.patch("/api/users/me/settings", json=bad)).status_code == 422


async def test_lead_from_the_landing_page(client):
    response = await client.post(
        "/api/leads",
        json={"name": "Иван", "phone": "+7 (900) 123-45-67", "company": "ООО Ромашка", "tier": "custom"},
    )
    assert response.status_code == 204


async def test_lead_needs_a_contact_and_drops_bots(client):
    assert (await client.post("/api/leads", json={"name": "Иван"})).status_code == 422
    assert (await client.post("/api/leads", json={"name": "Иван", "phone": "звоните"})).status_code == 422
    bot = await client.post("/api/leads", json={"name": "Bot", "email": "bot@example.com", "website": "x"})
    assert bot.status_code == 204


async def test_leads_are_rate_limited(client):
    for _ in range(5):
        assert (
            await client.post("/api/leads", json={"name": "Иван", "email": "i@example.com"})
        ).status_code == 204
    response = await client.post("/api/leads", json={"name": "Иван", "email": "i@example.com"})
    assert response.status_code == 429
