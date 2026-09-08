"""daemon 分发元数据与注册端点（原 router.py 版本域，task-07 拆分）。

GET /version 公开元数据（前端安装区块 / install.sh 消费）+ POST /register
per-daemon 注册。版本计算 helper（BUILD_ID / DAEMON_VERSION 提取）与进程级
缓存随域同迁；``DAEMON_DOWNLOAD_URL`` / ``get_daemon_latest_version`` 经包
``__init__`` 重导出（dist_router.py 消费面零改动）。
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, status
from pydantic import BaseModel, Field

from app.core.auth_deps import get_current_principal
from app.core.config import get_settings
from app.modules.auth.model import User
from app.modules.daemon.router import SessionDep, router
from app.modules.daemon.schema import (
    DaemonRegisterRequest,
    DaemonRegisterResponse,
    DaemonRegisterRuntimeItem,
)
from app.modules.daemon.service import DaemonService

# ── Daemon distribution metadata (public, no auth) ───────────────────────────
# GET /api/daemon/version —— 供前端安装区块 / install.sh 拉取最新版本号与下载地址。
# 当前硬编码；后续可改为读 nginx 托管的 latest.json 或配置中心。
# latest.json（install.sh 消费）字段：version / downloadUrl；本端点多返回 minRequired
# 供前端做版本门槛提示。
DAEMON_DOWNLOAD_URL = "/daemon/latest/sillyhub-daemon.js"


def _compute_daemon_version() -> str:
    """从已部署的 daemon bundle 中提取 BUILD_ID（git short SHA）。

    daemon 侧 build-id.ts 在 bundle 时注入 BUILD_ID，此处从部署的 JS 文件中
    正则提取。提取失败时回退 "unknown"。
    """
    import re

    try:
        bundle_path = get_settings().daemon_dist_dir / "sillyhub-daemon.js"
        if not bundle_path.is_file():
            return "unknown"
        text = bundle_path.read_text(errors="replace")
        m = re.search(r'BUILD_ID\s*=\s*["\x27]([^"\x27]+)', text)
        return m.group(1) if m else "unknown"
    except Exception:
        return "unknown"


def _compute_daemon_semver() -> str:
    """从已部署 bundle 提取 DAEMON_VERSION（语义版本）。

    2026-07-04-daemon-version-management D-004/D-009：与 BUILD_ID（SHA）分开提取，
    供 GET /api/daemon/version 展示语义版本（self-update 仍用 BUILD_ID 比对）。
    提取失败回退 "unknown"。
    """
    import re

    try:
        bundle_path = get_settings().daemon_dist_dir / "sillyhub-daemon.js"
        if not bundle_path.is_file():
            return "unknown"
        text = bundle_path.read_text(errors="replace")
        m = re.search(r'DAEMON_VERSION\s*=\s*["\x27]([^"\x27]+)', text)
        return m.group(1) if m else "unknown"
    except Exception:
        return "unknown"


def get_daemon_latest_version() -> str:
    """缓存 daemon latest BUILD_ID（git SHA，进程级，deploy 后不变）。

    2026-07-04-daemon-version-management D-009：返回值仍为 SHA，供 self-update 端点
    WS 推送（daemon preflight 按 BUILD_ID 比对）。语义版本走 get_daemon_latest_semver。
    """
    global _DAEMON_VERSION_CACHE
    if _DAEMON_VERSION_CACHE is None:
        _DAEMON_VERSION_CACHE = _compute_daemon_version()
    return _DAEMON_VERSION_CACHE


def get_daemon_latest_semver() -> str:
    """缓存 daemon latest 语义版本（DAEMON_VERSION，供前端展示）。"""
    global _DAEMON_SEMVER_CACHE
    if _DAEMON_SEMVER_CACHE is None:
        _DAEMON_SEMVER_CACHE = _compute_daemon_semver()
    return _DAEMON_SEMVER_CACHE


_DAEMON_VERSION_CACHE: str | None = None
_DAEMON_SEMVER_CACHE: str | None = None


class DaemonVersionResponse(BaseModel):
    """GET /api/daemon/version 响应：daemon 分发元数据（公开端点）。

    2026-07-04-daemon-version-management D-004：新增 latest_version（语义）+
    latest_build_id（SHA），供前端版本比对与升级入口。旧 latest/minRequired/
    downloadUrl 保留（install.sh 兼容）。
    """

    latest: str = Field(description="最新发布版本号（= latest_build_id 回退值，兼容 install.sh）")
    minRequired: str = Field(description="最低兼容版本号（低于则需升级）")  # noqa: N815 - JSON 契约字段名（install.sh/前端消费，不可改 snake_case）
    downloadUrl: str = Field(description="单文件 bundle 下载地址（相对站内路径）")  # noqa: N815 - JSON 契约字段名（install.sh/前端消费，不可改 snake_case）
    latest_version: str = Field(
        description="最新语义版本（DAEMON_VERSION，bundle 提取失败=unknown）"
    )
    latest_build_id: str = Field(description="最新构建标识（BUILD_ID/git SHA，前端升级比对用）")


@router.get(
    "/version",
    response_model=DaemonVersionResponse,
)
async def get_daemon_version() -> DaemonVersionResponse:
    """公开端点：返回 daemon 最新版本 / 最低要求版本 / 下载地址。

    无需认证——前端「首次安装」区块与 install.sh 都需要匿名拉取该元数据。
    downloadUrl 为相对路径（如 ``/daemon/latest/sillyhub-daemon.js``），由 nginx
    静态托管；调用方（前端/脚本）按自身已知的服务端 base URL 拼接。
    """
    return DaemonVersionResponse(
        latest=get_daemon_latest_version(),
        minRequired="0.1.0",
        downloadUrl=DAEMON_DOWNLOAD_URL,
        latest_version=get_daemon_latest_semver(),
        latest_build_id=get_daemon_latest_version(),
    )


# ── Runtime registration & heartbeat ────────────────────────────────────────


@router.post(
    "/register",
    response_model=DaemonRegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_daemon(
    data: DaemonRegisterRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> DaemonRegisterResponse:
    """Per-daemon 注册（design §5.2 / D-006）。

    daemon 启动一次性上报 daemon_local_id + 机器级字段 + provider 列表。backend
    先 upsert daemon_instances，再为每个 provider upsert daemon_runtimes，并清理
    stale runtime（provider 卸载）。返回 daemon_instance_id + 各 runtime_id。
    """
    svc = DaemonService(session)
    result = await svc.register_daemon(
        user.id,
        daemon_local_id=data.daemon_local_id,
        server_url=data.server_url,
        hostname=data.hostname,
        os=data.os,
        arch=data.arch,
        allowed_roots=data.allowed_roots,
        providers=[item.model_dump() for item in data.providers],
        daemon_version=data.daemon_version,
        daemon_build_id=data.daemon_build_id,
        started_at=data.started_at,
        # 2026-08-31-machine-sillyspec-version FR-05 / D-002@v1：register 无条件
        # 直写（含 None——本机卸载后重启收敛为 NULL，服务层注释已锚定）。
        sillyspec_version=data.sillyspec_version,
        sillyspec_latest_version=data.sillyspec_latest_version,
    )
    return DaemonRegisterResponse(
        daemon_instance_id=result.daemon_instance_id,
        runtimes=[
            DaemonRegisterRuntimeItem(
                provider=r.provider,
                runtime_id=r.runtime_id,
                allowed_roots=r.allowed_roots,
            )
            for r in result.runtimes
        ],
    )
