from tests.conftest import Api, register


def test_register_creates_default_tenant_and_tags(api: Api):
    tenants = api.tenants()
    assert [t["name"] for t in tenants] == ["DEFAULT_SELF"]
    assert tenants[0]["is_default"] is True
    assert set(api.tags()) == {"emergency-fund", "trading", "fixed-income", "savings", "retirement", "salary"}


def test_register_rejects_short_password_and_duplicate_email(client):
    res = client.post("/api/auth/register", json={"first_name": "A", "last_name": "B", "email": "a@example.com", "password": "12345"})
    assert res.status_code == 422
    register(client, email="dup@example.com")
    res = client.post("/api/auth/register", json={"first_name": "A", "last_name": "B", "email": "DUP@example.com", "password": "123456"})
    assert res.status_code == 409


def test_login_me_and_change_password(client):
    register(client, email="me@example.com", password="secret1")
    assert client.post("/api/auth/login", json={"email": "me@example.com", "password": "wrong!"}).status_code == 401
    token = client.post("/api/auth/login", json={"email": "ME@example.com", "password": "secret1"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/auth/me", headers=headers).json()["email"] == "me@example.com"
    res = client.post("/api/auth/change-password", headers=headers, json={"current_password": "secret1", "new_password": "secret2"})
    assert res.status_code == 204
    assert client.post("/api/auth/login", json={"email": "me@example.com", "password": "secret2"}).status_code == 200


def test_requests_without_token_are_rejected(client):
    assert client.get("/api/tenants").status_code == 401


def test_tenant_crud_and_rules(api: Api):
    res = api.post("/api/tenants", json={"name": "Parents", "description": "Mom & Dad"})
    assert res.status_code == 201
    parents = res.json()
    # Names are unique per user, case-insensitively.
    assert api.post("/api/tenants", json={"name": "parents"}).status_code == 409

    default = api.tenants()[0]
    assert api.delete(f"/api/tenants/{default['id']}").status_code == 400
    assert api.patch(f"/api/tenants/{default['id']}", json={"name": "ME"}).status_code == 400

    # A tenant with accounts can't be deleted; once empty it can.
    res = api.post("/api/accounts", json={"name": "Pension", "account_type": "savings", "currency": "INR"}, tenant_id=parents["id"])
    assert res.status_code == 201
    assert api.delete(f"/api/tenants/{parents['id']}").status_code == 409
    assert api.delete(f"/api/accounts/{res.json()['id']}", tenant_id=parents["id"]).status_code == 204
    assert api.delete(f"/api/tenants/{parents['id']}").status_code == 204

    # Deleted tenants vanish and their name is free again.
    assert [t["name"] for t in api.tenants()] == ["DEFAULT_SELF"]
    assert api.post("/api/tenants", json={"name": "Parents"}).status_code == 201


def test_tenant_isolation_between_users(api: Api, other_api: Api):
    acc = api.account(name="Mine")
    # Another user can't use my tenant id at all…
    assert other_api.get("/api/accounts", tenant_id=api.tenant_id).status_code == 404
    # …nor reach my account through their own tenant.
    assert other_api.get(f"/api/accounts/{acc['id']}").status_code == 404
    assert other_api.get("/api/accounts").json() == []


def test_tenant_isolation_between_own_tenants(api: Api):
    second = api.post("/api/tenants", json={"name": "Household"}).json()
    acc = api.account(name="Self only")
    assert api.get("/api/accounts", tenant_id=second["id"]).json() == []
    assert api.get(f"/api/accounts/{acc['id']}", tenant_id=second["id"]).status_code == 404


def test_tags_crud_seed_and_shared_across_tenants(api: Api):
    tags = api.tags()
    second = api.post("/api/tenants", json={"name": "Parents"}).json()
    # Tags belong to the user, so another tenant's account can use them.
    res = api.post(
        "/api/accounts",
        json={"name": "FD", "account_type": "fixed_deposit", "currency": "INR", "tag_ids": [tags["fixed-income"]]},
        tenant_id=second["id"],
    )
    assert res.status_code == 201
    listing = {t["name"]: t for t in api.get("/api/tags").json()}
    assert listing["fixed-income"]["account_count"] == 1

    assert api.post("/api/tags", json={"name": "Bad Name"}).status_code == 422
    assert api.post("/api/tags", json={"name": "travel"}).status_code == 201
    assert api.post("/api/tags", json={"name": "travel"}).status_code == 409

    # Deleting a tag removes it from accounts; seeding restores only missing defaults.
    assert api.delete(f"/api/tags/{tags['fixed-income']}").status_code == 204
    detail = api.get(f"/api/accounts/{res.json()['id']}", tenant_id=second["id"]).json()
    assert detail["tags"] == []
    names = [t["name"] for t in api.post("/api/tags/seed").json()]
    assert names.count("fixed-income") == 1 and "travel" in names
