"""Public daemon distribution endpoints (no ``/api`` prefix, no auth).

Serves the one-line installer script, the version manifest, and the
single-file daemon bundle so that::

    curl -fsSL <SERVER>/daemon/install.sh | bash -s -- --server-url <SERVER>

works end-to-end. These routes are intentionally mounted without the ``/api``
prefix to match the contract encoded in ``sillyhub-daemon/scripts/install.sh``
(which fetches ``/daemon/latest.json`` and ``/daemon/latest/sillyhub-daemon.js``).

The distributed files (``install.sh`` + ``sillyhub-daemon.js``) are baked into
the backend image at ``settings.daemon_dist_dir`` (default ``/app/daemon-dist``)
via the Docker build (see ``deploy/docker-compose.yml`` ``additional_contexts``).
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.core.config import get_settings
from app.modules.daemon.router import DAEMON_DOWNLOAD_URL, get_daemon_latest_version

router = APIRouter(prefix="/daemon", tags=["daemon-distribution"])


@router.get("/install.sh")
async def get_install_script() -> FileResponse:
    """Return the daemon installer shell script (``text/x-shellscript``)."""
    path = get_settings().daemon_dist_dir / "install.sh"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="install.sh not bundled in image")
    return FileResponse(path, media_type="text/x-shellscript", filename="install.sh")


@router.get("/latest.json")
async def get_latest_manifest() -> dict[str, str]:
    """Return ``{version, downloadUrl}`` consumed by ``install.sh``'s ``fetch_latest``.

    Field names: ``version``（BUILD_ID / git SHA）+ ``url``（preflight.ts 消费）+ ``downloadUrl``
    （install.sh 消费）。同时返回两种字段名以兼容两个消费方。
    """
    version = get_daemon_latest_version()
    download_url = DAEMON_DOWNLOAD_URL
    return {
        "version": version,
        "url": download_url,
        "downloadUrl": download_url,
    }


@router.get("/latest/sillyhub-daemon.js")
async def get_daemon_bundle() -> FileResponse:
    """Return the single-file ncc bundle (``application/javascript``)."""
    path = get_settings().daemon_dist_dir / "sillyhub-daemon.js"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="daemon bundle not bundled in image")
    return FileResponse(path, media_type="application/javascript", filename="sillyhub-daemon.js")
