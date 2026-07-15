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

import re

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response

from app.core.config import get_settings
from app.modules.daemon.router import DAEMON_DOWNLOAD_URL, get_daemon_latest_version

router = APIRouter(prefix="/daemon", tags=["daemon-distribution"])

# Host 白名单（DG-03 注入防护）：仅允字母数字及常见 host/port 字符，
# 阻断伪造 Host 头注入 PowerShell（如换行 / 引号 / `;` 管道等）。
_HOST_ALLOWLIST = re.compile(r"^[a-zA-Z0-9._:/-]+$")


def _parse_forwarded(header_value: str | None) -> dict[str, str]:
    """从 ``Forwarded`` 头解析 ``proto=`` / ``host=`` 键值对（RFC 7239）。

    Forwarded: for=1.2.3.4; proto=https; host=hub.example.com
    → {"proto": "https", "host": "hub.example.com"}
    """
    if not header_value:
        return {}
    result: dict[str, str] = {}
    for pair in header_value.split(";"):
        for entry in pair.split(","):
            entry = entry.strip()
            if "=" not in entry:
                continue
            key, _, value = entry.partition("=")
            key = key.strip().lower()
            value = value.strip().strip('"')
            if key in ("proto", "host"):
                result.setdefault(key, value)
    return result


def _derive_server_url(request: Request) -> str:
    """据请求头推导对外暴露的 ``server_url``（DG-01 scheme + DG-03 host 白名单）。

    scheme 优先级：``X-Forwarded-Proto`` → ``Forwarded: proto=`` → ``request.url.scheme``。
    host 优先级：``X-Forwarded-Host`` → ``Forwarded: host=`` → ``Host`` 头 → ``request.url.netloc``。
    host 经白名单校验，不合规回退 ``str(request.base_url).rstrip("/")``（避免注入）。
    """
    forwarded = _parse_forwarded(request.headers.get("forwarded"))

    scheme = (
        request.headers.get("x-forwarded-proto") or forwarded.get("proto") or request.url.scheme
    )

    host = (
        request.headers.get("x-forwarded-host")
        or forwarded.get("host")
        or request.headers.get("host")
        or request.url.netloc
    )

    if not host or not _HOST_ALLOWLIST.match(host):
        # 白名单不合规 → 回退 base_url（DG-03），避免伪造 Host 头注入 PowerShell。
        return str(request.base_url).rstrip("/")

    return f"{scheme}://{host}"


@router.get("/install.sh")
async def get_install_script() -> FileResponse:
    """Return the daemon installer shell script (``text/x-shellscript``)."""
    path = get_settings().daemon_dist_dir / "install.sh"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="install.sh not bundled in image")
    return FileResponse(path, media_type="text/x-shellscript", filename="install.sh")


@router.get("/install.ps1")
async def get_install_ps1(request: Request) -> Response:
    """动态生成 PowerShell 安装脚本，内嵌 server_url（方案 A，DG-01/03）。

    读 ``daemon-dist/install.ps1`` 模板，把 ``{{SERVER_URL}}`` 占位替换为据请求头
    推导出的对外地址（scheme 经 X-Forwarded-Proto 还原、host 经白名单校验），
    返回 ``application/x-powershell``。镜像未打包则 404。
    """
    path = get_settings().daemon_dist_dir / "install.ps1"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="install.ps1 not bundled in image")
    server_url = _derive_server_url(request)
    body = path.read_text(encoding="utf-8").replace("{{SERVER_URL}}", server_url)
    return Response(
        content=body,
        media_type="application/x-powershell",
        headers={"Content-Disposition": 'attachment; filename="install.ps1"'},
    )


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


@router.get("/latest/mcp-server.js")
async def get_mcp_server_bundle() -> FileResponse:
    """Return the daemon MCP server single-file bundle (task-05/06, e2e 2026-07-12).

    主 agent MCP server 子进程入口，install.sh 下载到与 sillyhub-daemon.js 同目录
    （``buildDaemonMcpServerConfig`` 的 ``defaultMcpServerModulePath`` 据此定位）。
    缺失则主 agent session 注入的 MCP server spawn 失败 → team 5 tool 链路断。
    """
    path = get_settings().daemon_dist_dir / "mcp-server.js"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="mcp-server bundle not bundled in image")
    return FileResponse(path, media_type="application/javascript", filename="mcp-server.js")
