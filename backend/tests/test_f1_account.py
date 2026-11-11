from fastapi.testclient import TestClient
from fastf1.exceptions import F1AuthError
from fastf1.internals.f1account.tokens import TokenManager

from app import f1_account
from app.main import app

client = TestClient(app)


def _fixture_token():
    import time

    import jwt
    from fastf1.internals.f1account.tokens import SubscriptionToken

    return SubscriptionToken.from_jwt(jwt.encode({"exp": int(time.time()) + 3600}, "fixture-signing-key-for-tests-only"))


def _no_credentials():
    raise F1AuthError("no credentials")


def _isolated_tokens(monkeypatch, tmp_path):
    manager = TokenManager(auth_func=_no_credentials, path=tmp_path / "token.json")
    monkeypatch.setattr(f1_account.f1account, "token_manager", manager)
    return manager


def test_account_starts_signed_out(monkeypatch, tmp_path):
    _isolated_tokens(monkeypatch, tmp_path)

    response = client.get("/api/account")

    assert response.status_code == 200
    assert response.json() == {"available": True, "signed_in": False, "expires_at": None}


def test_sign_in_stores_token_and_reloads_sessions(monkeypatch, tmp_path):
    manager = _isolated_tokens(monkeypatch, tmp_path)
    token = _fixture_token()
    seen = {}

    def fake_login(username, password):
        seen["credentials"] = (username, password)
        return token

    cleared = []
    monkeypatch.setattr(f1_account, "f1_login", fake_login)
    monkeypatch.setattr(f1_account, "_clear_loaded_sessions", lambda: cleared.append(True))

    response = client.post("/api/account/sign-in", json={"username": "fan@example.com", "password": "secret"})

    assert response.status_code == 200
    assert response.json()["signed_in"] is True
    assert seen["credentials"] == ("fan@example.com", "secret")
    assert cleared == [True]
    stored = (tmp_path / "token.json").read_text()
    assert "secret" not in stored
    assert manager.get_stored() == token


def test_rejected_sign_in_returns_f1_message(monkeypatch, tmp_path):
    _isolated_tokens(monkeypatch, tmp_path)

    def rejected(_username, _password):
        raise F1AuthError("There was a problem with your password or email address.")

    monkeypatch.setattr(f1_account, "f1_login", rejected)

    response = client.post("/api/account/sign-in", json={"username": "fan@example.com", "password": "wrong"})

    assert response.status_code == 401
    assert "password or email address" in response.json()["detail"]
    assert client.get("/api/account").json()["signed_in"] is False


def test_sign_out_removes_token(monkeypatch, tmp_path):
    manager = _isolated_tokens(monkeypatch, tmp_path)
    manager.store(_fixture_token())

    response = client.post("/api/account/sign-out")

    assert response.status_code == 200
    assert response.json()["signed_in"] is False
    assert not (tmp_path / "token.json").exists()
