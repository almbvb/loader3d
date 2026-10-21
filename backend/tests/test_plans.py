import copy
from typing import Any

import pytest

from tests.conftest import ClientFactory, error_code, register


def plan_data(item_count: int = 2) -> dict[str, Any]:
    """A plan exactly as the frontend exports it (exportPlan in src/store/useStore.ts)."""
    return {
        "vehicles": [
            {
                "id": "veh-1a2b3c4d",
                "name": "Машина 1",
                "bodies": [
                    {
                        "id": "body-1a2b3c4d",
                        "kind": "semi",
                        "name": "Полуприцеп",
                        "dims": {"l": 1360, "w": 245, "h": 270},
                        "maxLoad": 20000,
                    }
                ],
            }
        ],
        "dockMode": "shared",
        "items": [
            {
                "id": f"cargo-{n}",
                "seq": n,
                "name": "Европаллета",
                "dims": {"l": 120, "w": 80, "h": 150},
                "orientation": {"yaw": 90 if n % 2 else 0},
                "pos": {"x": 1360 - 120 * n, "y": 0, "z": 0},
                "color": "#f0a35e",
                "weight": 400 + n,
            }
            for n in range(1, item_count + 1)
        ],
        "nextSeq": item_count + 1,
    }


@pytest.fixture
async def anna(client):
    await register(client)
    return client


async def test_plans_require_login(client):
    response = await client.get("/api/plans")
    assert response.status_code == 401


async def test_create_empty_plan_with_default_vehicle(anna):
    response = await anna.post("/api/plans", json={"name": "  Рейс Москва — Казань "})
    assert response.status_code == 201, response.text
    plan = response.json()
    assert plan["name"] == "Рейс Москва — Казань"
    assert plan["version"] == 1
    assert (plan["vehicleCount"], plan["bodyCount"], plan["itemCount"]) == (1, 1, 0)
    assert plan["data"]["vehicles"][0]["bodies"][0]["dims"] == {"l": 1360, "w": 245, "h": 270}
    assert plan["data"]["dockMode"] == "shared"
    assert plan["data"]["items"] == []
    assert plan["data"]["nextSeq"] == 1


async def test_plan_data_round_trips(anna):
    data = plan_data(3)
    created = (await anna.post("/api/plans", json={"name": "Рейс", "data": data})).json()
    assert (created["bodyCount"], created["itemCount"]) == (1, 3)

    loaded = await anna.get(f"/api/plans/{created['id']}")
    assert loaded.status_code == 200
    assert loaded.json()["data"] == data


async def test_weight_and_payload_are_optional(anna):
    """Plans made before weights existed have neither field; they must come back without nulls."""
    data = plan_data(2)
    del data["vehicles"][0]["bodies"][0]["maxLoad"]
    for item in data["items"]:
        del item["weight"]
    created = (await anna.post("/api/plans", json={"name": "Старый план", "data": data})).json()
    assert created["data"] == data
    assert "maxLoad" not in created["data"]["vehicles"][0]["bodies"][0]
    assert all("weight" not in item for item in created["data"]["items"])

    default = (await anna.post("/api/plans", json={"name": "Новый"})).json()
    assert default["data"]["vehicles"][0]["bodies"][0]["maxLoad"] == 20000


async def test_plans_from_before_vehicles_are_read_as_one_vehicle(anna):
    """Plans saved with `bodies` (one vehicle, no dock mode) come back in the current format."""
    data = plan_data(2)
    old = {"bodies": data["vehicles"][0]["bodies"], "items": data["items"], "nextSeq": data["nextSeq"]}
    created = (await anna.post("/api/plans", json={"name": "Старый формат", "data": old})).json()
    assert created["data"]["vehicles"] == [{"id": "veh-1", "name": "Машина 1", "bodies": old["bodies"]}]
    assert created["data"]["dockMode"] == "shared"
    assert "bodies" not in created["data"]
    assert (created["vehicleCount"], created["bodyCount"]) == (1, 1)


async def test_several_vehicles_and_tilted_cargo(anna):
    data = plan_data(2)
    second = copy.deepcopy(data["vehicles"][0])
    second.update(id="veh-2", name="Машина 2")
    second["bodies"][0]["id"] = "body-2"
    second["bodies"].append({**second["bodies"][0], "id": "body-3", "kind": "trailer", "name": "Прицеп"})
    data["vehicles"].append(second)
    data["dockMode"] = "own"
    data["items"][0]["orientation"] = {"yaw": 90, "up": "w"}
    created = (await anna.post("/api/plans", json={"name": "Две машины", "data": data})).json()
    assert created["data"] == data
    assert (created["vehicleCount"], created["bodyCount"]) == (2, 3)
    listed = (await anna.get("/api/plans")).json()["items"][0]
    assert (listed["vehicleCount"], listed["bodyCount"]) == (2, 3)
    copied = (await anna.post(f"/api/plans/{created['id']}/duplicate", json={})).json()
    assert copied["vehicleCount"] == 2


async def test_next_seq_is_never_behind_the_items(anna):
    data = plan_data(3)
    data["nextSeq"] = 1
    created = (await anna.post("/api/plans", json={"name": "Рейс", "data": data})).json()
    assert created["data"]["nextSeq"] == 4


async def test_list_is_the_home_page(anna):
    for name in ["Москва — Казань", "Склад МОСКВА", "Минск", "100% загрузка"]:
        assert (await anna.post("/api/plans", json={"name": name, "data": plan_data(1)})).status_code == 201

    page = (await anna.get("/api/plans")).json()
    assert page["total"] == 4
    # Most recently changed first by default; the list has no plan contents.
    assert [p["name"] for p in page["items"]] == ["100% загрузка", "Минск", "Склад МОСКВА", "Москва — Казань"]
    assert "data" not in page["items"][0]
    assert page["items"][0]["itemCount"] == 1

    # Search is case-insensitive for Cyrillic too, and % is a literal character.
    found = (await anna.get("/api/plans", params={"q": "москва"})).json()
    assert sorted(p["name"] for p in found["items"]) == ["Москва — Казань", "Склад МОСКВА"]
    assert [p["name"] for p in (await anna.get("/api/plans", params={"q": "%"})).json()["items"]] == [
        "100% загрузка"
    ]

    by_name = (await anna.get("/api/plans", params={"sort": "name", "limit": 2, "offset": 1})).json()
    assert by_name["total"] == 4
    assert [p["name"] for p in by_name["items"]] == ["Минск", "Москва — Казань"]

    assert (await anna.get("/api/plans", params={"sort": "size"})).status_code == 422
    assert (await anna.get("/api/plans", params={"limit": 1000})).status_code == 422


async def test_save_uses_optimistic_locking(anna):
    plan = (await anna.post("/api/plans", json={"name": "Рейс", "data": plan_data(1)})).json()

    saved = await anna.patch(
        f"/api/plans/{plan['id']}", json={"version": 1, "name": "Рейс 2", "data": plan_data(4)}
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["version"] == 2
    assert body["name"] == "Рейс 2"
    assert body["itemCount"] == 4
    assert body["updatedAt"] > plan["updatedAt"]

    # A second tab still holding version 1 must not overwrite the save.
    stale = await anna.patch(f"/api/plans/{plan['id']}", json={"version": 1, "data": plan_data(0)})
    assert stale.status_code == 409
    assert error_code(stale) == "version_conflict"
    assert stale.json()["detail"]["currentVersion"] == 2
    assert (await anna.get(f"/api/plans/{plan['id']}")).json()["itemCount"] == 4

    renamed = await anna.patch(f"/api/plans/{plan['id']}", json={"version": 2, "name": "Рейс 3"})
    assert renamed.json()["version"] == 3
    assert renamed.json()["itemCount"] == 4


async def test_duplicate_and_delete(anna):
    plan = (await anna.post("/api/plans", json={"name": "Рейс", "data": plan_data(2)})).json()

    copy_ = await anna.post(f"/api/plans/{plan['id']}/duplicate", json={})
    assert copy_.status_code == 201
    duplicate = copy_.json()
    assert duplicate["id"] != plan["id"]
    assert duplicate["name"] == "Рейс (копия)"
    assert duplicate["version"] == 1
    assert duplicate["data"] == plan["data"]

    named = (await anna.post(f"/api/plans/{plan['id']}/duplicate", json={"name": "Вариант Б"})).json()
    assert named["name"] == "Вариант Б"

    assert (await anna.delete(f"/api/plans/{plan['id']}")).status_code == 204
    assert error_code(await anna.get(f"/api/plans/{plan['id']}")) == "plan_not_found"
    assert (await anna.get("/api/plans")).json()["total"] == 2


async def test_plans_of_other_users_are_invisible(anna, make_client: ClientFactory):
    plan = (await anna.post("/api/plans", json={"name": "Секретный рейс"})).json()
    bob = await make_client()
    await register(bob, "bob@example.com")

    assert (await bob.get("/api/plans")).json()["total"] == 0
    url = f"/api/plans/{plan['id']}"
    assert error_code(await bob.get(url)) == "plan_not_found"
    assert error_code(await bob.patch(url, json={"version": 1, "name": "x"})) == "plan_not_found"
    assert error_code(await bob.post(f"{url}/duplicate", json={})) == "plan_not_found"
    assert error_code(await bob.delete(url)) == "plan_not_found"
    assert (await anna.get(url)).json()["name"] == "Секретный рейс"


def _broken(change) -> dict[str, Any]:
    data = copy.deepcopy(plan_data(2))
    change(data)
    return data


@pytest.mark.parametrize(
    "data",
    [
        pytest.param(_broken(lambda d: d["items"][0]["orientation"].update(yaw=45)), id="yaw"),
        pytest.param(_broken(lambda d: d["items"][1].update(id="cargo-1")), id="duplicate-item-id"),
        pytest.param(
            _broken(lambda d: d["vehicles"][0].update(bodies=d["vehicles"][0]["bodies"] * 4)),
            id="too-many-bodies",
        ),
        pytest.param(_broken(lambda d: d["vehicles"][0].update(bodies=[])), id="no-bodies"),
        pytest.param(_broken(lambda d: d.update(vehicles=[])), id="no-vehicles"),
        pytest.param(_broken(lambda d: d.update(vehicles=d["vehicles"] * 11)), id="too-many-vehicles"),
        pytest.param(_broken(lambda d: d.update(vehicles=d["vehicles"] * 2)), id="duplicate-vehicle-id"),
        pytest.param(
            _broken(lambda d: d["vehicles"].append({**d["vehicles"][0], "id": "veh-2"})),
            id="duplicate-body-id",
        ),
        pytest.param(_broken(lambda d: d["vehicles"][0].update(name="")), id="vehicle-without-name"),
        pytest.param(_broken(lambda d: d.update(dockMode="roof")), id="dock-mode"),
        pytest.param(_broken(lambda d: d["items"][0]["orientation"].update(up="x")), id="tilt"),
        pytest.param(_broken(lambda d: d["items"][0]["dims"].update(l=1)), id="item-too-small"),
        pytest.param(
            _broken(lambda d: d["vehicles"][0]["bodies"][0]["dims"].update(w=900)), id="body-too-wide"
        ),
        pytest.param(_broken(lambda d: d["vehicles"][0]["bodies"][0].update(kind="ship")), id="body-kind"),
        pytest.param(_broken(lambda d: d["items"][0]["pos"].update(y=-10)), id="below-floor"),
        pytest.param(_broken(lambda d: d["items"][0].update(color="red")), id="color"),
        pytest.param(_broken(lambda d: d["items"][0].update(fragile=True)), id="unknown-field"),
        pytest.param(_broken(lambda d: d.pop("nextSeq")), id="missing-next-seq"),
        pytest.param(_broken(lambda d: d["items"][0].update(weight=-1)), id="negative-weight"),
        pytest.param(_broken(lambda d: d["items"][0].update(weight=31_000)), id="item-too-heavy"),
        pytest.param(
            _broken(lambda d: d["vehicles"][0]["bodies"][0].update(maxLoad=70_000)), id="payload-too-big"
        ),
    ],
)
async def test_invalid_plan_data_is_rejected(anna, data):
    response = await anna.post("/api/plans", json={"name": "Рейс", "data": data})
    assert response.status_code == 422, response.text


@pytest.mark.parametrize("name", ["", "   ", "x" * 201])
async def test_plan_name_is_validated(anna, name):
    assert (await anna.post("/api/plans", json={"name": name})).status_code == 422
