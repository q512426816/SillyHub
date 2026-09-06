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
    返回 ``application/x-powershell; charset=utf-8``（显式 charset：非 text/* 时 starlette
    不自动补，缺失则 PowerShell ``irm`` 按 latin1 解码 UTF-8 body 致中文乱码）。镜像未打包则 404。
    """
    path = get_settings().daemon_dist_dir / "install.ps1"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="install.ps1 not bundled in image")
    server_url = _derive_server_url(request)
    # utf-8-sig：源文件 install.ps1 已带 UTF-8 BOM（供 Windows PowerShell 5.1 按 UTF-8
    # 正确解析，否则 PS5.1 对无 BOM 文件按 GBK 解码致中文乱码切碎引号）。此处须剥掉 BOM，
    # 否则 \ufeff 混入 body 首字符，``irm | iex`` 管道执行时损坏脚本。
    body = path.read_text(encoding="utf-8-sig").replace("{{SERVER_URL}}", server_url)
    return Response(
        content=body,
        # 显式 charset=utf-8：``application/x-powershell`` 非 text/* ，starlette 不自动补
        # charset；缺失则 PowerShell ``irm | iex`` 按 latin1 解码 UTF-8 body，脚本中文
        # 在执行前即损坏成 mojibake（install.ps1 源码虽已设 [Console]::OutputEncoding=UTF8，
        # 但那是执行阶段，救不回读取阶段已坏的字符串）。
        media_type="application/x-powershell; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="install.ps1"'},
    )


@router.get("/latest.json")
async def get_latest_manifest() -> dict[str, object]:
    """Return ``{version, downloadUrl, vendorFiles}`` consumed by installers/preflight.

    Field names: ``version``（BUILD_ID / git SHA）+ ``url``（preflight.ts 消费）+ ``downloadUrl``
    （install.sh 消费）。同时返回两种字段名以兼容两个消费方。``vendorFiles``
    （ql-20260906-003，审计 #10）：``vendor/`` 下相对路径清单（按需扫描
    daemon-dist，未打包 → 空列表），install.sh / install.ps1 / preflight 自更新
    据此逐文件伴生下载 vendored pi 扩展树。
    """
    version = get_daemon_latest_version()
    download_url = DAEMON_DOWNLOAD_URL
    return {
        "version": version,
        "url": download_url,
        "downloadUrl": download_url,
        "vendorFiles": _vendor_file_list(),
    }


def _vendor_file_list() -> list[str]:
    """扫描 daemon-dist/vendor 下全部文件的相对 POSIX 路径（排序稳定）。

    条目形如 ``vendor/pi-extensions/subagent/index.ts``（含 vendor/ 前缀——
    客户端 join(binDir, rel) 直落位）。目录缺失 → 空列表（旧镜像/未打包 vendor
    的兼容形态，客户端 no-op）。
    """
    root = get_settings().daemon_dist_dir / "vendor"
    if not root.is_dir():
        return []
    return sorted(p.relative_to(root.parent).as_posix() for p in root.rglob("*") if p.is_file())


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


@router.get("/latest/vendor/{file_path:path}")
async def get_vendor_file(file_path: str) -> FileResponse:
    """Serve a vendored pi-extension file（ql-20260906-003，审计 #10 分发链补口）.

    ``vendor/`` 树随 bundle 打进镜像（Dockerfile COPY），install / preflight
    自更新按 latest.json 的 vendorFiles 清单逐文件下载到 bin 目录 ``vendor/``
    下——pi-rpc-driver 的 ``piVendoredSubagentExtensionPath`` 按「bundle 同目录
    vendor/pi-extensions/...」候选定位 ``--extension`` 实参；漏分发则候选落空、
    扩展静默跳过（subagent 工具不可用）。路径双保险校验：分段白名单（拒绝
    ``..`` / 空段 / 反斜杠 / NUL）+ resolve 后 containment 复核（防符号链接逃逸）；
    不合规与缺失统一 404（不泄露存在性）。媒体类型固定 octet-stream——按扩展名
    猜测会把 .ts 判成 video/mp2t，且客户端均按字节落盘不消费类型。
    """
    segments = file_path.split("/")
    if (
        not file_path
        or any(seg in ("", ".", "..") for seg in segments)
        or "\\" in file_path
        or "\x00" in file_path
    ):
        raise HTTPException(status_code=404, detail="vendor file not found")
    root = (get_settings().daemon_dist_dir / "vendor").resolve()
    target = (root / file_path).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        raise HTTPException(status_code=404, detail="vendor file not found")
    return FileResponse(target, media_type="application/octet-stream")
