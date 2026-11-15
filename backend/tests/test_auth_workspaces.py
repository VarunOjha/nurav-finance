from tests.conftest import Api, register


def test_register_creates_default_workspace_and_buckets(api: Api):
    workspaces = api.workspaces()
    assert [t["name"] for t in workspaces] == ["Personal"]
    assert workspaces[0]["is_default"] is True
    assert list(api.buckets()) == ["Growth", "Emergency fund", "Extra cash"]


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
    assert client.get("/api/workspaces").status_code == 401


def test_workspace_crud_and_rules(api: Api):
    res = api.post("/api/workspaces", json={"name": "Parents", "description": "Mom & Dad"})
    assert res.status_code == 201
    parents = res.json()
    # Names are unique per user, case-insensitively.
    assert api.post("/api/workspaces", json={"name": "parents"}).status_code == 409

    default = api.workspaces()[0]
    assert api.delete(f"/api/workspaces/{default['id']}").status_code == 400
    # The default can be renamed (not deleted).
    res = api.patch(f"/api/workspaces/{default['id']}", json={"name": "Me"})
    assert res.status_code == 200 and res.json()["name"] == "Me" and res.json()["is_default"] is True

    # A workspace with accounts can't be deleted; once empty it can.
    res = api.post("/api/accounts", json={"name": "Pension", "account_type": "savings", "currency": "INR"}, workspace_id=parents["id"])
    assert res.status_code == 201
    assert api.delete(f"/api/workspaces/{parents['id']}").status_code == 409
    assert api.delete(f"/api/accounts/{res.json()['id']}", workspace_id=parents["id"]).status_code == 204
    assert api.delete(f"/api/workspaces/{parents['id']}").status_code == 204

    # Deleted workspaces vanish and their name is free again.
    assert [t["name"] for t in api.workspaces()] == ["Me"]
    assert api.post("/api/workspaces", json={"name": "Parents"}).status_code == 201


def test_workspace_isolation_between_users(api: Api, other_api: Api):
    acc = api.account(name="Mine")
    # Another user can't use my workspace id at all…
    assert other_api.get("/api/accounts", workspace_id=api.workspace_id).status_code == 404
    # …nor reach my account through their own workspace.
    assert other_api.get(f"/api/accounts/{acc['id']}").status_code == 404
    assert other_api.get("/api/accounts").json() == []


def test_workspace_isolation_between_own_workspaces(api: Api):
    second = api.post("/api/workspaces", json={"name": "Household"}).json()
    acc = api.account(name="Self only")
    assert api.get("/api/accounts", workspace_id=second["id"]).json() == []
    assert api.get(f"/api/accounts/{acc['id']}", workspace_id=second["id"]).status_code == 404


def test_register_validates_email_and_birth_date(client):
    base = {"first_name": "A", "last_name": "B", "password": "secret1"}
    bad = [
        {"email": "not-an-email"},
        {"email": "p4@example.com", "date_of_birth": "2999-01-01"},
        {"email": "p5@example.com", "date_of_birth": "1850-01-01"},
    ]
    for extra in bad:
        assert client.post("/api/auth/register", json=base | extra).status_code == 422, extra
    ok = client.post("/api/auth/register", json=base | {"email": "ok@example.com", "phone": "+1 415 555 0123", "date_of_birth": "1990-05-17"})
    assert ok.status_code == 201, ok.text
    assert "phone" not in ok.json()["user"]  # not stored any more
