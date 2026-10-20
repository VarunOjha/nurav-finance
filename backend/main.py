import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

import nurav_creds
from database import SessionLocal
from dependencies import get_current_user
from routers import accounts, agent, analytics, auth, portfolios, tags, tenants, wealth
from services.crypto import CryptoConfigError

logging.basicConfig(level=logging.INFO, format="%(levelname)s [%(name)s] %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log = logging.getLogger("nurav_creds")
    if nurav_creds.is_configured():
        log.info("nurav-creds vault active: %d keys loaded", len(nurav_creds.get_secrets()))
    else:
        log.warning("nurav-creds vault NOT configured — running on local env only")
    yield


app = FastAPI(
    title="Nurav Finance API",
    description="Personal finance tracker: tenants, accounts, balances, portfolios, analytics.",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)


@app.exception_handler(CryptoConfigError)
async def _crypto_error(_: Request, exc: CryptoConfigError) -> JSONResponse:
    # Message is key-free by construction (see services/crypto.py).
    return JSONResponse(status_code=500, content={"detail": str(exc)})


_auth = [Depends(get_current_user)]
app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(tenants.router, prefix="/api/tenants", tags=["Tenants"], dependencies=_auth)
app.include_router(tags.router, prefix="/api/tags", tags=["Tags"], dependencies=_auth)
app.include_router(accounts.router, prefix="/api/accounts", tags=["Accounts"], dependencies=_auth)
app.include_router(portfolios.router, prefix="/api/portfolios", tags=["Portfolios"], dependencies=_auth)
app.include_router(analytics.router, prefix="/api/analytics", tags=["Analytics"], dependencies=_auth)
app.include_router(agent.router, prefix="/api/agent", tags=["Wealth Agent"], dependencies=_auth)
app.include_router(wealth.router, prefix="/api/wealth", tags=["Wealth plans"], dependencies=_auth)


@app.get("/health", tags=["Health"])
def health() -> JSONResponse:
    """Pings Postgres so the Docker healthcheck catches a dead database."""
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        return JSONResponse({"status": "ok", "db": "ok"})
    except Exception:
        return JSONResponse({"status": "degraded", "db": "fail"}, status_code=503)


# ── Frontend SPA ──────────────────────────────────────────────────────────────
# The Docker image copies the built frontend into static/. Without it (bare
# backend runs, tests) only the API is served and Vite runs separately.
_static = Path(__file__).parent / "static"
if (_static / "assets").exists():

    class HashedStaticFiles(StaticFiles):
        """Vite asset filenames are content-hashed, so a long immutable cache is safe."""

        async def get_response(self, path: str, scope):  # type: ignore[override]
            response = await super().get_response(path, scope)
            if response.status_code in (200, 206):
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return response

    app.mount("/assets", HashedStaticFiles(directory=_static / "assets"), name="assets")
    _static_root = _static.resolve()
    _no_cache = {"Cache-Control": "no-cache"}

    @app.get("/{full_path:path}", include_in_schema=False)
    async def _serve_spa(full_path: str) -> FileResponse:
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = (_static / full_path).resolve()
        # Containment check: never serve anything outside static/.
        if candidate.is_file() and candidate.is_relative_to(_static_root):
            return FileResponse(candidate, headers=_no_cache)
        return FileResponse(_static_root / "index.html", headers=_no_cache)
