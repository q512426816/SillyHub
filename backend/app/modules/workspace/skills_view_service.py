"""只读 workspace skills / .mcp.json 查看 service（task-06，变更 2026-07-07-skills-mcp-management-ui）。

D-006@V1：经 SpecPathResolver 定位 specDir，**只读**列出 workspace specDir/skills/
下的自定义 skill 名 + 各 skill 文件清单；读 specDir/.mcp.json（env secret 脱敏）。

NFR-05：backend 容器不可达宿主 specDir，统一经 HostFsDelegate RPC
（list_dir / read_file / stat）读（2026-07-10-remove-server-local-workspace-mode
后 daemon-client 为唯一路径来源，不再有 server-local 平铺分支）。

参考：
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
from app.modules.workspace.service import WorkspaceService


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

    路径解析与 :class:`RuntimeService` 对齐（task-16 fix 后 daemon-client 唯一）：

    - **root 选择**：强制用 ``spec_ws.spec_root``（宿主侧路径，daemon sync 产物）。
      无 spec_ws → None（caller 返回空视图）。
    - **mode 选择**：``platform_managed=True``（扁平布局，daemon spec-sync 产物无
      ``.sillyspec`` 包裹）。
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── 路径解析（镜像 RuntimeService._resolver_for，task-16 fix）──────────────

    @staticmethod
    def _resolver_for(
        workspace: Workspace, spec_ws: SpecWorkspace | None
    ) -> SpecPathResolver | None:
        """构造正确 root + mode 的 resolver（与 :class:`RuntimeService._resolver_for` 同逻辑）。

        daemon-client 唯一路径（2026-07-10-remove-server-local-workspace-mode）：

        - **root**：``spec_ws.spec_root``（服务器/宿主侧可读路径）。无 spec_ws / 空
          spec_root → 返回 None，caller 返回空视图。
        - **mode**：``platform_managed=True``（扁平，daemon spec-sync 产物无
          ``.sillyspec`` 包裹）。
        """
        if spec_ws and spec_ws.spec_root:
            root = spec_ws.spec_root
        else:
            return None

        return SpecPathResolver(root, platform_managed=True)

    async def _get_base(self, workspace_id: uuid.UUID) -> tuple[Workspace, SpecWorkspace | None]:
        """取 workspace + 关联 spec_ws（无 spec_ws 返 None，不抛）。"""
        ws = await WorkspaceService(self._session).get(workspace_id)
        stmt = select(SpecWorkspace).where(SpecWorkspace.workspace_id == workspace_id)
        spec_ws = (await self._session.execute(stmt)).scalars().first()
        return ws, spec_ws

    # ── HostFsDelegate 构造（RPC 读 list_dir/read_file/stat）─────────────────

    @staticmethod
    def _make_host_fs_delegate(session: AsyncSession):
        """构造 HostFsDelegate（经 RPC list_dir/read_file/stat 原语读 daemon 宿主 specDir）。

        lazy 构造 + 复用进程级 ws_hub 单例；workspace 源码物理位于绑定 daemon 宿主，
        backend 容器不可达，统一走 RPC。
        """
        from app.modules.daemon.host_fs import HostFsDelegate, HostFsWsRpc
        from app.modules.daemon.ws_hub import get_daemon_ws_hub

        hub = get_daemon_ws_hub()
        return HostFsDelegate(session, hub, HostFsWsRpc(hub))

    # ── 公开 API ─────────────────────────────────────────────────────────────

    async def list_skills(self, workspace_id: uuid.UUID) -> SkillsViewResponse:
        """列 specDir/skills/ 下自定义 skill 名 + 各 skill 文件清单（只读，经 RPC）。

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
        # 经 RPC list_dir（backend 容器不可达宿主 specDir）。
        names = await delegate.list_dir(ws, str(skills_dir))

        skills: list[SkillFileEntry] = []
        for name in names:
            skill_path = skills_dir / name
            # 仅列目录型 skill（SKILL.md-centric，与 daemon skill-manager 同语义）。
            st = await delegate.stat(ws, str(skill_path))
            if not st.get("exists") or not st.get("is_dir"):
                continue
            files = await self._list_files_rpc(delegate, ws, skill_path)
            skills.append(SkillFileEntry(name=name, files=files))

        return SkillsViewResponse(skills=skills)

    async def get_mcp_config(self, workspace_id: uuid.UUID) -> McpConfigViewResponse:
        """读 specDir/.mcp.json（只读，env secret 脱敏，经 RPC）。

        无文件 / 解析失败 → 返回空 ``{mcpServers: {}}``，不抛错（task-06 验收 D）。
        env secret 脱敏复用 settings/router 的 ``_redact_mcp_env``（D-008）。
        """
        ws, spec_ws = await self._get_base(workspace_id)
        resolver = self._resolver_for(ws, spec_ws)
        if resolver is None:
            return McpConfigViewResponse(mcpServers={})

        mcp_path = resolver._spec_root() / ".mcp.json"

        delegate = self._make_host_fs_delegate(self._session)
        st = await delegate.stat(ws, str(mcp_path))
        if not st.get("exists") or st.get("is_dir"):
            return McpConfigViewResponse(mcpServers={})
        try:
            raw = await delegate.read_file(ws, str(mcp_path))
        except Exception:
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

    # ── 文件清单 helper（RPC）──────────────────────────────────────────────

    async def _list_files_rpc(self, delegate, ws: Workspace, skill_dir: Path) -> list[str]:
        """经 HostFsDelegate list_dir + stat 平铺列文件 relpath。

        v1 平铺（顶层文件 + 一层子目录内文件）—— 覆盖典型 SKILL.md + helper scripts 布局。
        深度结构留后续按需扩展。
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
