"""只读 workspace skills / .mcp.json 查看 service（task-06，变更 2026-07-07-skills-mcp-management-ui）。

D-006@V1：经 SpecPathResolver 定位 specDir，**只读**列出 workspace specDir/skills/
下的自定义 skill 名 + 各 skill 文件清单；读 specDir/.mcp.json（env secret 脱敏）。

NFR-05：daemon-client 模式 backend 容器不可达宿主 specDir，经 HostFsDelegate RPC
（list_dir / read_file / stat）读；server-local 直接容器 Path 读。两种 path_source
共用同一返回结构，调用方（router）不感知分流。

参考：
- runtime/service.py 的 ``_resolver_for`` + ``_read_text`` 分流模式（task-16 fix）
- daemon skill-manager.ts：workspace 自定义 skills 源 = ``specDir/skills/``
- settings/router.py 的 ``_redact_mcp_env``（D-008 env secret 遮蔽，复用）
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.spec_paths import SpecPathResolver
from app.modules.settings.router import _redact_mcp_env
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace
from app.modules.workspace.service import (
    WorkspaceService,
    _rewrite_path,
    is_daemon_client_path_source,
)


class SkillFileEntry(BaseModel):
    """单个 workspace 自定义 skill 的只读视图（design §7）。"""

    name: str
    files: list[str] = Field(default_factory=list)


class SkillsViewResponse(BaseModel):
    """``GET /api/workspaces/{id}/skills`` 响应。"""

    skills: list[SkillFileEntry]


class McpConfigViewResponse(BaseModel):
    """``GET /api/workspaces/{id}/mcp-config`` 响应（env secret 已脱敏）。

    无 ``.mcp.json`` 或解析失败时返回空 ``{mcpServers: {}}``，不抛错（task-06 验收 D）。
    """

    mcpServers: dict = Field(default_factory=dict)  # noqa: N815 - wire 格式与 MCP 标准 key 一致


class SkillsViewService:
    """只读 workspace skills / .mcp.json 查看器。

    路径解析与 :class:`RuntimeService` 对齐（task-16 fix）：

    - **daemon-client**：强制用 ``spec_ws.spec_root``（宿主侧路径），``platform_managed=True``
      扁平布局。backend 容器不可达 → 经 HostFsDelegate RPC 读。
    - **server-local / 其他**：``spec_ws.strategy != "repo-native"`` 时用 ``spec_ws.spec_root``
      （平台镜像，容器可达）；否则回退 ``_rewrite_path(ws.root_path)``。容器 Path 直读。
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── 路径解析（镜像 RuntimeService._resolver_for，task-16 fix）──────────────

    @staticmethod
    def _resolver_for(
        workspace: Workspace, spec_ws: SpecWorkspace | None
    ) -> SpecPathResolver | None:
        """构造正确 root + mode 的 resolver（与 :class:`RuntimeService._resolver_for` 同逻辑）。

        root 与 mode 是**正交**的两个维度（task-16 fix）：

        - **root 选择**：
          1. **daemon-client** → 强制 ``spec_ws.spec_root``（服务器/宿主侧可读路径），
             忽略 ``strategy``。无 spec_ws → None。
          2. 其余且 ``spec_ws.strategy != "repo-native"``（platform-managed）→ ``spec_ws.spec_root``。
          3. 其余（repo-native / 无 spec_ws）→ ``workspace.root_path``。
        - **mode 选择**：daemon-client → ``platform_managed=True``（扁平，daemon spec-sync
          产物无 ``.sillyspec`` 包裹）；其余 → False（包裹 ``.sillyspec/``）。

        返回 None 表示无可用 specDir；caller 据此返回空视图。
        """
        is_daemon_client = is_daemon_client_path_source(workspace.path_source)

        if is_daemon_client:
            if spec_ws and spec_ws.spec_root:
                root = spec_ws.spec_root
            else:
                return None
        elif spec_ws and spec_ws.strategy != "repo-native":
            root = spec_ws.spec_root
        elif workspace.root_path:
            root = _rewrite_path(workspace.root_path)
        else:
            return None

        return SpecPathResolver(
            root,
            platform_managed=is_daemon_client,
        )

    async def _get_base(self, workspace_id: uuid.UUID) -> tuple[Workspace, SpecWorkspace | None]:
        """取 workspace + 关联 spec_ws（无 spec_ws 返 None，不抛）。"""
        ws = await WorkspaceService(self._session).get(workspace_id)
        stmt = select(SpecWorkspace).where(SpecWorkspace.workspace_id == workspace_id)
        spec_ws = (await self._session.execute(stmt)).scalars().first()
        return ws, spec_ws

    # ── HostFsDelegate 构造（daemon-client RPC 读，仿 SpecWorkspaceService）────

    @staticmethod
    def _make_host_fs_delegate(session: AsyncSession):
        """构造 HostFsDelegate（server-local 分支用 list_dir/read_file/stat 原语）。

        lazy 构造 + 复用进程级 ws_hub 单例；server-local workspace 调 delegate 方法
        时 ``is_daemon_client_path_source`` 为 False，直接走容器 Path 分支不经 RPC。
        """
        from app.modules.daemon.host_fs import HostFsDelegate, HostFsWsRpc
        from app.modules.daemon.ws_hub import get_daemon_ws_hub

        hub = get_daemon_ws_hub()
        return HostFsDelegate(session, hub, HostFsWsRpc(hub))

    # ── 公开 API ─────────────────────────────────────────────────────────────

    async def list_skills(self, workspace_id: uuid.UUID) -> SkillsViewResponse:
        """列 specDir/skills/ 下自定义 skill 名 + 各 skill 文件清单（只读）。

        specDir 不存在 / 无 skills/ 子目录 → 返回空列表（task-06 验收 D）。
        每个 skill 子目录递归列文件（relpath 相对 ``skills/<name>/``），仅含文件，
        不递归子目录的 skill 结构（v1 平铺文件清单足够 UI 展示）。
        """
        ws, spec_ws = await self._get_base(workspace_id)
        resolver = self._resolver_for(ws, spec_ws)
        if resolver is None:
            return SkillsViewResponse(skills=[])

        skills_dir = resolver._spec_root() / "skills"

        delegate = self._make_host_fs_delegate(self._session)
        # daemon-client 经 RPC list_dir；server-local 直接容器 Path。
        # HostFsDelegate 内部按 workspace.path_source 分流。
        if is_daemon_client_path_source(ws.path_source):
            names = await delegate.list_dir(ws, str(skills_dir))
        else:
            names = sorted(p.name for p in skills_dir.iterdir()) if skills_dir.is_dir() else []

        skills: list[SkillFileEntry] = []
        for name in names:
            skill_path = skills_dir / name
            # 仅列目录型 skill（SKILL.md-centric，与 daemon skill-manager 同语义）。
            if is_daemon_client_path_source(ws.path_source):
                st = await delegate.stat(ws, str(skill_path))
                if not st.get("exists") or not st.get("is_dir"):
                    continue
                files = await self._list_files_rpc(delegate, ws, skill_path)
            else:
                if not skill_path.is_dir():
                    continue
                files = self._list_files_local(skill_path)
            skills.append(SkillFileEntry(name=name, files=files))

        return SkillsViewResponse(skills=skills)

    async def get_mcp_config(self, workspace_id: uuid.UUID) -> McpConfigViewResponse:
        """读 specDir/.mcp.json（只读，env secret 脱敏）。

        无文件 / 解析失败 → 返回空 ``{mcpServers: {}}``，不抛错（task-06 验收 D）。
        env secret 脱敏复用 settings/router 的 ``_redact_mcp_env``（D-008）。
        """
        ws, spec_ws = await self._get_base(workspace_id)
        resolver = self._resolver_for(ws, spec_ws)
        if resolver is None:
            return McpConfigViewResponse(mcpServers={})

        mcp_path = resolver._spec_root() / ".mcp.json"

        delegate = self._make_host_fs_delegate(self._session)
        if is_daemon_client_path_source(ws.path_source):
            st = await delegate.stat(ws, str(mcp_path))
            if not st.get("exists") or st.get("is_dir"):
                return McpConfigViewResponse(mcpServers={})
            try:
                raw = await delegate.read_file(ws, str(mcp_path))
            except Exception:
                return McpConfigViewResponse(mcpServers={})
        else:
            if not mcp_path.is_file():
                return McpConfigViewResponse(mcpServers={})
            try:
                raw = mcp_path.read_text(encoding="utf-8")
            except OSError:
                return McpConfigViewResponse(mcpServers={})

        try:
            data = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return McpConfigViewResponse(mcpServers={})

        if not isinstance(data, dict):
            return McpConfigViewResponse(mcpServers={})

        mcp_servers = data.get("mcpServers")
        if not isinstance(mcp_servers, dict):
            mcp_servers = {}

        return McpConfigViewResponse(mcpServers=_redact_mcp_env(mcp_servers))

    # ── 文件清单 helper（server-local vs daemon-client RPC）──────────────────

    @staticmethod
    def _list_files_local(skill_dir: Path) -> list[str]:
        """server-local：平铺列 skill_dir 下所有文件的 relpath（相对 skill_dir）。

        v1 平铺（不深度递归子目录中的子目录）—— 顶层文件 + 一层子目录内文件，
        覆盖典型 SKILL.md + helper scripts 布局。深度结构留后续按需扩展。
        """
        files: list[str] = []
        for child in sorted(skill_dir.iterdir()):
            if child.is_file():
                files.append(child.name)
            elif child.is_dir():
                for grandchild in sorted(child.iterdir()):
                    if grandchild.is_file():
                        files.append(f"{child.name}/{grandchild.name}")
        return files

    async def _list_files_rpc(self, delegate, ws: Workspace, skill_dir: Path) -> list[str]:
        """daemon-client：经 HostFsDelegate list_dir + stat 平铺列文件 relpath。

        与 ``_list_files_local`` 同结构（顶层文件 + 一层子目录内文件）。
        """
        files: list[str] = []
        names = await delegate.list_dir(ws, str(skill_dir))
        for name in names:
            child_path = skill_dir / name
            st = await delegate.stat(ws, str(child_path))
            if not st.get("exists"):
                continue
            if st.get("is_dir"):
                sub_names = await delegate.list_dir(ws, str(child_path))
                for sub in sub_names:
                    sub_path = child_path / sub
                    sub_st = await delegate.stat(ws, str(sub_path))
                    if sub_st.get("exists") and not sub_st.get("is_dir"):
                        files.append(f"{name}/{sub}")
            else:
                files.append(name)
        return files
