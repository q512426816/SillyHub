"""只读 workspace skills / .mcp.json 查看 service。

backend 容器内**直读** ``spec_ws.spec_root``（容器路径 ``/data/spec-workspaces/{ws}``，
经 docker bind mount 映射宿主 ``C:/data/spec-workspaces``，backend 自己可读）。

**不经 HostFsDelegate RPC**（记忆 ``runtime-read-broken-daemon-client``：spec_root 是
backend 容器路径，RPC 打到 daemon 宿主会读不到——daemon 宿主无该路径）。
2026-07-11 spec sync 修复（ql-20260711-001）：skills_view 回归 backend 本地直读。

参考：
- daemon skill-manager.ts：workspace 自定义 skills 源 = ``specDir/skills/``
- settings/router.py 的 ``_redact_mcp_env``（env secret 遮蔽，复用）
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
    """单个 workspace 自定义 skill 的只读视图。"""

    name: str
    files: list[str] = Field(default_factory=list)


class SkillsViewResponse(BaseModel):
    """``GET /api/workspaces/{id}/skills`` 响应。"""

    skills: list[SkillFileEntry]


class McpConfigViewResponse(BaseModel):
    """``GET /api/workspaces/{id}/mcp-config`` 响应（env secret 已脱敏）。

    无 ``.mcp.json`` 或解析失败时返回空 ``{mcpServers: {}}``，不抛错。
    """

    mcpServers: dict = Field(default_factory=dict)  # noqa: N815 - wire 格式与 MCP 标准 key 一致


class SkillsViewService:
    """只读 workspace skills / .mcp.json 查看器（backend 本地直读 spec_root）。

    ``spec_ws.spec_root`` 是 backend 容器路径（bind mount 映射宿主），backend 自己
    可直读。spec_root 不存在 / 无 skills 子目录 → 返回空视图（caller 友好）。
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    @staticmethod
    def _resolver_for(
        workspace: Workspace, spec_ws: SpecWorkspace | None
    ) -> SpecPathResolver | None:
        """构造 resolver（root = spec_ws.spec_root，mode = platform_managed 扁平）。"""
        if spec_ws and spec_ws.spec_root:
            return SpecPathResolver(spec_ws.spec_root, platform_managed=True)
        return None

    async def _get_base(self, workspace_id: uuid.UUID) -> tuple[Workspace, SpecWorkspace | None]:
        """取 workspace + 关联 spec_ws（无 spec_ws 返 None，不抛）。"""
        ws = await WorkspaceService(self._session).get(workspace_id)
        stmt = select(SpecWorkspace).where(SpecWorkspace.workspace_id == workspace_id)
        spec_ws = (await self._session.execute(stmt)).scalars().first()
        return ws, spec_ws

    # ── 公开 API（backend 本地直读 spec_root，不经 RPC）─────────────────────────

    async def list_skills(self, workspace_id: uuid.UUID) -> SkillsViewResponse:
        """列 specDir/skills/ 下自定义 skill 名 + 各 skill 文件清单（只读，本地直读）。

        specDir 不存在 / 无 skills/ 子目录 → 返回空列表。每个 skill 子目录递归列
        文件（relpath 相对 ``skills/<name>/``），仅含文件，不递归子目录的 skill 结构。
        """
        ws, spec_ws = await self._get_base(workspace_id)
        resolver = self._resolver_for(ws, spec_ws)
        if resolver is None:
            return SkillsViewResponse(skills=[])

        skills_dir = resolver._spec_root() / "skills"
        if not skills_dir.is_dir():
            return SkillsViewResponse(skills=[])

        skills: list[SkillFileEntry] = []
        try:
            for entry in sorted(skills_dir.iterdir()):
                if not entry.is_dir():
                    continue
                files = self._list_files_local(entry)
                skills.append(SkillFileEntry(name=entry.name, files=files))
        except (OSError, PermissionError):
            return SkillsViewResponse(skills=[])

        return SkillsViewResponse(skills=skills)

    async def get_mcp_config(self, workspace_id: uuid.UUID) -> McpConfigViewResponse:
        """读 specDir/.mcp.json（只读，env secret 脱敏，本地直读）。

        无文件 / 解析失败 → 返回空 ``{mcpServers: {}}``，不抛错。
        env secret 脱敏复用 settings/router 的 ``_redact_mcp_env``。
        """
        ws, spec_ws = await self._get_base(workspace_id)
        resolver = self._resolver_for(ws, spec_ws)
        if resolver is None:
            return McpConfigViewResponse(mcpServers={})

        mcp_path = resolver._spec_root() / ".mcp.json"
        if not mcp_path.is_file():
            return McpConfigViewResponse(mcpServers={})
        try:
            raw = mcp_path.read_text(encoding="utf-8")
        except (OSError, PermissionError):
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

    # ── 文件清单 helper（本地）──────────────────────────────────────────────

    @staticmethod
    def _list_files_local(skill_dir: Path) -> list[str]:
        """本地平铺列文件 relpath（顶层文件 + 一层子目录内文件）。

        v1 平铺——覆盖典型 SKILL.md + helper scripts 布局。深度结构留后续按需扩展。
        """
        files: list[str] = []
        try:
            for child in sorted(skill_dir.iterdir()):
                if child.is_dir():
                    for sub in sorted(child.iterdir()):
                        if sub.is_file():
                            files.append(f"{child.name}/{sub.name}")
                else:
                    files.append(child.name)
        except (OSError, PermissionError):
            pass
        return files
