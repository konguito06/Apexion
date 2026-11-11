"""Formula 1 account sign-in for the F1 live-timing feed.

FastF1 sends a subscription token with its livetiming requests. Signing in here stores that token in FastF1's
own token file, so the password is used once and never kept by Apexion.
"""
from . import data

try:
    from fastf1.exceptions import F1AuthError
    from fastf1.internals import f1account
    from fastf1.internals.f1account.login import login as f1_login
except Exception:  # Keep the API available if FastF1 is absent or its auth module moves.
    F1AuthError = RuntimeError
    f1account = None
    f1_login = None


def _require_fastf1():
    if f1account is None:
        raise RuntimeError("FastF1 account sign-in is unavailable; install backend requirements")


def status() -> dict:
    if f1account is None:
        return {"available": False, "signed_in": False, "expires_at": None}
    token = f1account.token_manager.get_stored()
    signed_in = token is not None and token.is_valid()
    return {"available": True, "signed_in": signed_in, "expires_at": token.expires_at if signed_in else None}


def sign_in(username: str, password: str) -> dict:
    """Sign in, store the token, and drop sessions that were loaded without it so they reload with full data."""
    _require_fastf1()
    f1account.token_manager.get(force_renew=True, auth_func=lambda: f1_login(username, password))
    _clear_loaded_sessions()
    return status()


def sign_out() -> dict:
    _require_fastf1()
    f1account.clear_token()
    return status()


def _clear_loaded_sessions():
    for loader in (data._load, data._load_telemetry, data._load_laps_for_evaluation):
        loader.cache_clear()
