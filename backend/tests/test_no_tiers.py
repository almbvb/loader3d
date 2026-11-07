"""TIERS_ENABLED off (the default): nothing is limited and the API does not mention tiers."""

from tests.conftest import error_code, make_admin, register
from tests.test_plans import plan_data


async def test_no_subscription_and_no_limits(client):
    response = await client.post(
        "/api/auth/register", json={"email": "anna@example.com", "password": "correct horse", "tier": "pro"}
    )
    assert response.json()["user"]["subscription"] is None
    client.headers["authorization"] = f"Bearer {response.json()['accessToken']}"
    assert (await client.get("/api/users/me")).json()["subscription"] is None

    two = plan_data(150)
    second = {**two["vehicles"][0], "id": "veh-2", "name": "Машина 2"}
    second["bodies"] = [{**two["vehicles"][0]["bodies"][0], "id": "body-2"}]
    two["vehicles"].append(second)
    for n in range(5):
        assert (await client.post("/api/plans", json={"name": f"Рейс {n}", "data": two})).status_code == 201
    assert error_code(await client.post("/api/users/me/trial")) == "tiers_disabled"


async def test_admin_without_tiers(app, client):
    await register(client)
    await make_admin(app)
    stats = (await client.get("/api/admin/stats")).json()
    assert stats["byTier"] is None
    users = (await client.get("/api/admin/users", params={"tier": "pro"})).json()
    assert users["total"] == 1
    assert users["items"][0]["subscription"] is None
    uid = users["items"][0]["id"]
    response = await client.put(f"/api/admin/users/{uid}/subscription", json={"tier": "pro"})
    assert error_code(response) == "tiers_disabled"
