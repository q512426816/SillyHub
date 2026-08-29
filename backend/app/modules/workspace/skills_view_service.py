"""workspace skills 只读视图 + .mcp.json 读/写 service。

backend 容器内**直读/直写** ``spec_ws.spec_root``（容器路径
``/data/spec-workspaces/{ws}``，经 docker bind mount 映射宿主
``C:/data/spec-workspaces``，backend 自己可读写）。

**不经 HostFsDelegate RPC**（记忆 ``runtime-read-broken-daemon-client``：spec_root 是
backend 容器路径，RPC 打到 daemon 宿主会读不到——daemon 宿主无该路径）。
2026-07-11 spec sync 修复（ql-20260711-001）：skills_view 回归 backend 本地直读。
2026-08-26-workspace-mcp-edit task-01：新增 ``update_mcp_config`` 写路径（仅 stdio +
``<set>`` 服务端还原 + 原子写 + 审计）。
2026-08-26-workspace-skill-edit task-01：新增 skills 写路径（skill 建删 + 文件读/写/
删，路径穿越 fail-closed + 文本/大小约束 + SKILL.md 入口保护 + 手工审计）。

参考：
- daemon skill-manager.ts：workspace 自定义 skills 源 = ``specDir/skills/``
- settings/router.py 的 ``_redact_mcp_env``（env secret 遮蔽，复用）
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import uuid
from pathlib import Path

from fastapi import status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.errors import AppError, SpecWorkspaceNotFound
from app.core.spec_paths import SpecPathResolver
from app.modules.auth.model import User
from app.modules.settings.router import (
    _SECRET_REDACTED_PLACEHOLDER as _SET_PLACEHOLDER,
)
from app.modules.settings.router import _redact_mcp_env
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workflow.model import AUDIT_PLACEHOLDER_ID, AuditLog
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


class McpServerEntryPut(BaseModel):
    """PUT mcp-config 单个 server 条目（仅 stdio，D-005@v2 安全边界）。

    ``type`` 缺省 ``"stdio"``；未知字段拒绝（``extra="forbid"``，防拼写错键静默落盘）。
    """

    model_config = ConfigDict(extra="forbid")

    type: str = "stdio"
    command: str = Field(min_length=1)
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] | None = None


class McpConfigUpdateRequest(BaseModel):
    """``PUT /api/workspaces/{id}/mcp-config`` 请求体（wire 格式同 claude .mcp.json）。"""

    model_config = ConfigDict(extra="forbid")

    mcpServers: dict[str, McpServerEntryPut] = Field(  # noqa: N815 - wire 格式与 MCP 标准 key 一致
        default_factory=dict
    )


class McpConfigTypeNotStdio(AppError):
    """MCP server ``type`` 非 stdio（http/sse 远程 server 一律拒绝，D-005@v2 防 SSRF）。"""

    code = "HTTP_422_MCP_TYPE_NOT_STDIO"
    http_status = status.HTTP_422_UNPROCESSABLE_ENTITY

    def __init__(self, *, server: str, entry_type: str) -> None:
        super().__init__(
            "仅支持 stdio 类型（本地命令）的 MCP 服务器",
            details={"server": server, "type": entry_type},
        )


class McpConfigSecretUnresolvable(AppError):
    """env 密钥占位符 ``<set>`` 无法从磁盘现有配置还原（R-02：让用户重输明文）。"""

    code = "HTTP_422_MCP_SECRET_UNRESOLVABLE"
    http_status = status.HTTP_422_UNPROCESSABLE_ENTITY

    def __init__(self, *, server: str, env_key: str) -> None:
        super().__init__(
            f"密钥占位符无法还原：server {server} 的 env {env_key}，请重新输入明文",
            details={"server": server, "env_key": env_key},
        )


# ── skills 编辑（2026-08-26-workspace-skill-edit task-01 / D-003@v1 安全约束）──

_SKILL_NAME_RE = re.compile(r"^[A-Za-z0-9._-]+$")
"""skill 名与文件路径段白名单（防分隔符/穿越注入；额外拒绝 ``..`` 字面量）。"""

_SKILL_MAX_FILE_BYTES = 512 * 1024
"""单文件读/写大小上限（512KB，防大文件拖垮编辑器与请求体）。"""

_SKILL_ENTRY_FILENAME = "SKILL.md"
"""skill 入口文件名（禁止删除——agent 按 SKILL.md 发现 skill）。"""


class SkillNameInvalid(AppError):
    """skill 名/文件路径段不在白名单或含 ``..``（路径穿越 fail-closed）。"""

    code = "HTTP_422_SKILL_NAME_INVALID"
    http_status = status.HTTP_422_UNPROCESSABLE_ENTITY

    def __init__(self, *, value: str) -> None:
        super().__init__(
            "名称仅允许字母、数字、点、下划线和连字符，且不能是 ..",
            details={"value": value[:80]},
        )


class SkillPathInvalid(AppError):
    """文件路径不合法（越界/绝对路径/超两层/编码变体穿越）。"""

    code = "HTTP_422_SKILL_PATH_INVALID"
    http_status = status.HTTP_422_UNPROCESSABLE_ENTITY

    def __init__(self, *, path: str) -> None:
        super().__init__(
            "文件路径不合法（仅允许 skill 目录内两层层级）",
            details={"path": path[:160]},
        )


class SkillAlreadyExists(AppError):
    """新建 skill 时同名目录已存在。"""

    code = "HTTP_409_SKILL_ALREADY_EXISTS"
    http_status = status.HTTP_409_CONFLICT

    def __init__(self, *, name: str) -> None:
        super().__init__(f"skill {name} 已存在", details={"name": name})


class SkillNotFound(AppError):
    """skill 或文件不存在。"""

    code = "HTTP_404_SKILL_NOT_FOUND"
    http_status = status.HTTP_404_NOT_FOUND

    def __init__(self, *, message: str, skill: str, path: str | None = None) -> None:
        super().__init__(message, details={"skill": skill, "path": path})


class SkillFileNotText(AppError):
    """目标文件不是 UTF-8 文本（二进制拒绝编辑）。"""

    code = "HTTP_415_SKILL_FILE_NOT_TEXT"
    http_status = status.HTTP_415_UNSUPPORTED_MEDIA_TYPE

    def __init__(self, *, path: str) -> None:
        super().__init__("该文件不是文本文件，无法在线编辑", details={"path": path})


class SkillFileTooLarge(AppError):
    """文件超过读写大小上限。"""

    code = "HTTP_413_SKILL_FILE_TOO_LARGE"
    http_status = status.HTTP_413_REQUEST_ENTITY_TOO_LARGE

    def __init__(self, *, path: str, size: int) -> None:
        super().__init__(
            f"文件超过 {_SKILL_MAX_FILE_BYTES // 1024}KB 上限，无法在线编辑",
            details={"path": path, "size": size, "limit": _SKILL_MAX_FILE_BYTES},
        )


class SkillEntryProtected(AppError):
    """SKILL.md 是 skill 入口文件，禁止删除。"""

    code = "HTTP_409_SKILL_ENTRY_PROTECTED"
    http_status = status.HTTP_409_CONFLICT

    def __init__(self) -> None:
        super().__init__("SKILL.md 是 skill 入口文件，不可删除")


class SkillCreateRequest(BaseModel):
    """``POST /skills`` 请求体。"""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)


class SkillFileWriteRequest(BaseModel):
    """``PUT /skills/{name}/files/{path}`` 请求体。"""

    model_config = ConfigDict(extra="forbid")

    content: str


class SkillFileContentResponse(BaseModel):
    """``GET /skills/{name}/files/{path}`` 响应。"""

    path: str
    content: str
    size: int


class SkillMutationResponse(BaseModel):
    """删除类写操作响应。"""

    deleted: bool


class SkillFileWriteResponse(BaseModel):
    """``PUT`` 文件响应。"""

    path: str
    size: int


class SkillsViewService:
    """workspace skills / .mcp.json 视图 + .mcp.json 写入（backend 本地直读 spec_root）。

    ``spec_ws.spec_root`` 是 backend 容器路径（bind mount 映射宿主），backend 自己
    可直读。spec_root 不存在 / 无 skills 子目录 → 读路径返回空视图（caller 友好）；
    写路径（``update_mcp_config``）无 spec 工作区则报错，绝不静默丢写。
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
        return await asyncio.to_thread(self._list_skills_sync, skills_dir)

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
        return await asyncio.to_thread(self._read_mcp_config_sync, mcp_path)

    async def update_mcp_config(
        self,
        workspace_id: uuid.UUID,
        payload: McpConfigUpdateRequest,
        actor: User,
    ) -> McpConfigViewResponse:
        """写 specDir/.mcp.json（校验 + ``<set>`` 服务端还原 + 原子写 + 审计）。

        2026-08-26-workspace-mcp-edit task-01 / design §7.1：

        - 逐 server 校验 ``type``，非 stdio 抛 :class:`McpConfigTypeNotStdio`
          （D-005@v2，防 http/sse 远程 server SSRF）
        - env 值为 ``<set>`` 的键从磁盘现有同名 server 同名键还原真值，取不到抛
          :class:`McpConfigSecretUnresolvable`；``<set>`` 字面量绝不写盘（R-02）
        - 原子写：同目录临时文件 + ``os.replace``（Windows/Linux 通用，R-01）
        - 审计：写文件成功后手工插入 ``AuditLog`` 并 commit（纯文件写无 ORM
          变更，``audit_hooks`` 钩子通道不触发——task-02 xfail 用例发现的实现
          缺口，按 settings/router._audit_platform_setting_write 先例改为手工
          插入，action=``workspace_mcp_config.update``）
        - 返回写后脱敏视图（与 GET 同构，复用 ``_redact_mcp_env``）

        现有文件不存在 + 全新配置（无 ``<set>``）→ 直接写新文件；现有文件损坏 →
        视为空配置处理（与 GET 容错一致），``<set>`` 还原自然走失败路径。
        """
        ws, spec_ws = await self._get_base(workspace_id)
        # 归档区禁写（2026-08-30 审计④-5）：写 .mcp.json 同属归档区文件写。
        WorkspaceService.ensure_writable(ws)
        resolver = self._resolver_for(ws, spec_ws)
        if resolver is None:
            raise SpecWorkspaceNotFound(
                "未找到该工作区对应的 spec 工作区。",
                details={"workspace_id": str(workspace_id)},
            )
        mcp_path = resolver._spec_root() / ".mcp.json"

        for name, entry in payload.mcpServers.items():
            if entry.type != "stdio":
                raise McpConfigTypeNotStdio(server=name, entry_type=entry.type)

        existing = await asyncio.to_thread(self._read_existing_mcp_servers_sync, mcp_path)
        self._restore_set_placeholders(payload.mcpServers, existing)

        data = {
            "mcpServers": {
                name: entry.model_dump(exclude_none=True)
                for name, entry in payload.mcpServers.items()
            }
        }

        await asyncio.to_thread(self._write_mcp_config_sync, mcp_path, data)

        # 审计：纯文件写不触发 audit_hooks（无 ORM 变更），手工插行落库
        # （settings/router._audit_platform_setting_write 同模式；resource 为
        # workspace 级配置文件，无独立 UUID 资源——resource_id 用占位符，
        # workspace_id 填真实工作区，details 记 server 名清单不含 env 值）。
        self._session.add(
            AuditLog(
                action="workspace_mcp_config.update",
                resource_type="workspace_mcp_config",
                resource_id=AUDIT_PLACEHOLDER_ID,
                workspace_id=workspace_id,
                actor_id=actor.id,
                details_json=json.dumps(
                    {"servers": sorted(data["mcpServers"].keys())},
                    ensure_ascii=False,
                ),
            )
        )
        await self._session.commit()

        return McpConfigViewResponse(mcpServers=_redact_mcp_env(data["mcpServers"]))

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

    @staticmethod
    def _list_skills_sync(skills_dir: Path) -> SkillsViewResponse:
        """``list_skills`` 同步遍历段（Wave C 续：移出事件循环）。"""
        if not skills_dir.is_dir():
            return SkillsViewResponse(skills=[])
        skills: list[SkillFileEntry] = []
        try:
            for entry in sorted(skills_dir.iterdir()):
                if not entry.is_dir():
                    continue
                files = SkillsViewService._list_files_local(entry)
                skills.append(SkillFileEntry(name=entry.name, files=files))
        except (OSError, PermissionError):
            return SkillsViewResponse(skills=[])
        return SkillsViewResponse(skills=skills)

    @staticmethod
    def _read_mcp_config_sync(mcp_path: Path) -> McpConfigViewResponse:
        """``get_mcp_config`` 同步读+解析段（Wave C 续：移出事件循环）。"""
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

    # ── 写路径 helper（本地）──────────────────────────────────────────────

    @staticmethod
    def _restore_set_placeholders(servers: dict[str, McpServerEntryPut], existing: dict) -> None:
        """把 env 值为 ``<set>`` 的键就地还原为磁盘现有真值（就地改 payload）。

        现有文件无该 server / 无该 env 键 / 现值本身也是 ``<set>``（盘上已被
        污染）→ 抛 :class:`McpConfigSecretUnresolvable`，绝不把占位符写盘（R-02）。
        """
        for name, entry in servers.items():
            if not entry.env:
                continue
            raw_server = existing.get(name)
            raw_env = raw_server.get("env") if isinstance(raw_server, dict) else None
            if not isinstance(raw_env, dict):
                raw_env = {}
            for key, value in entry.env.items():
                if value != _SET_PLACEHOLDER:
                    continue
                real = raw_env.get(key)
                if real is None or real == _SET_PLACEHOLDER:
                    raise McpConfigSecretUnresolvable(server=name, env_key=key)
                entry.env[key] = real

    @staticmethod
    def _read_existing_mcp_servers_sync(mcp_path: Path) -> dict:
        """读现有 ``.mcp.json`` 的 ``mcpServers``（明文，供 ``<set>`` 还原）。

        文件缺失 / 损坏 / 结构非法 → 返回空 dict（与 GET 容错一致，``<set>``
        还原自然走失败路径）。
        """
        if not mcp_path.is_file():
            return {}
        try:
            data = json.loads(mcp_path.read_text(encoding="utf-8"))
        except (OSError, PermissionError, json.JSONDecodeError, TypeError):
            return {}
        if not isinstance(data, dict):
            return {}
        servers = data.get("mcpServers")
        return servers if isinstance(servers, dict) else {}

    @staticmethod
    def _write_mcp_config_sync(mcp_path: Path, data: dict) -> None:
        """原子写 ``.mcp.json``：同目录临时文件 + ``os.replace``（R-01）。

        ``ensure_ascii=False, indent=2`` + 末尾换行（design §7.1）；失败时清理
        临时文件后原样上抛（IO 故障走全局 500 handler）。
        """
        text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
        tmp_path = mcp_path.with_name(f"{mcp_path.name}.tmp-{uuid.uuid4().hex[:12]}")
        try:
            tmp_path.write_text(text, encoding="utf-8")
            os.replace(tmp_path, mcp_path)
        except OSError:
            tmp_path.unlink(missing_ok=True)
            raise

    # ── skills 写路径（2026-08-26-workspace-skill-edit task-01）──────────────────

    async def _skills_root(self, workspace_id: uuid.UUID) -> Path:
        """定位 specDir/skills/（无 spec 工作区则抛 SpecWorkspaceNotFound，不静默）。

        调用方均为 skill 写/删路径（create/delete/write/delete_file）——统一在此
        挂归档禁写守卫（2026-08-30 审计④-5，409 WorkspaceArchived）。
        """
        ws, spec_ws = await self._get_base(workspace_id)
        WorkspaceService.ensure_writable(ws)
        resolver = self._resolver_for(ws, spec_ws)
        if resolver is None:
            raise SpecWorkspaceNotFound(
                "未找到该工作区对应的 spec 工作区。",
                details={"workspace_id": str(workspace_id)},
            )
        return resolver._spec_root() / "skills"

    @staticmethod
    def _validate_segment(value: str) -> str:
        """校验 skill 名/路径段（白名单 + 拒 ``..``）；返回原值（链式用）。"""
        if value == ".." or not _SKILL_NAME_RE.match(value):
            raise SkillNameInvalid(value=value)
        return value

    @staticmethod
    def _resolve_skill_file_path(skills_root: Path, skill_name: str, file_path: str) -> Path:
        """文件路径 → skill 目录内绝对 Path（穿越 fail-closed）。

        三重防线（D-003@v1）：①段白名单（每段过 ``_validate_segment``，天然拒
        分隔符/``..``/盘符）；②层数 ≤2（对齐 ``_list_files_local`` 平铺清单）；
        ③resolve 后 commonpath 必须仍是 skill 目录（防编码/链接变体绕过）。
        """
        if not file_path or file_path.startswith(("/", "\\")) or ":" in file_path:
            raise SkillPathInvalid(path=file_path)
        parts = file_path.replace("\\", "/").split("/")
        if len(parts) > 2:
            raise SkillPathInvalid(path=file_path)
        for seg in parts:
            SkillsViewService._validate_segment(seg)
        skill_dir = (skills_root / SkillsViewService._validate_segment(skill_name)).resolve()
        target = (skill_dir.joinpath(*parts)).resolve()
        try:
            if os.path.commonpath((str(skill_dir), str(target))) != str(skill_dir):
                raise SkillPathInvalid(path=file_path)
        except ValueError:
            # Windows 跨盘符等 commonpath 异常 → 一律拒绝
            raise SkillPathInvalid(path=file_path) from None
        return target

    async def _audit_skill_write(
        self, actor: User, workspace_id: uuid.UUID, action: str, skill: str, path: str | None
    ) -> None:
        """skills 写操作审计（纯文件写不触发 audit_hooks，手工插行，D-006@v1）。"""
        self._session.add(
            AuditLog(
                action=action,
                resource_type="workspace_skill",
                resource_id=AUDIT_PLACEHOLDER_ID,
                workspace_id=workspace_id,
                actor_id=actor.id,
                details_json=json.dumps({"skill": skill, "path": path}, ensure_ascii=False),
            )
        )
        await self._session.commit()

    async def create_skill(
        self, workspace_id: uuid.UUID, payload: SkillCreateRequest, actor: User
    ) -> SkillsViewResponse:
        """新建 skill：生成 ``skills/<name>/SKILL.md``（frontmatter name/description）。"""
        name = self._validate_segment(payload.name)
        skills_root = await self._skills_root(workspace_id)
        skill_dir = skills_root / name
        if skill_dir.exists():
            raise SkillAlreadyExists(name=name)

        frontmatter = f"---\nname: {name}\n"
        if payload.description:
            frontmatter += f"description: {payload.description}\n"
        frontmatter += "---\n\n# {name}\n\n（在此编写该 skill 的使用说明）\n".replace(
            "{name}", name
        )

        def _write() -> None:
            skill_dir.mkdir(parents=True, exist_ok=False)
            # newline 固定 LF：Windows 文本写会把 LF 翻译成 CRLF（task-03 发现）。
            (skill_dir / _SKILL_ENTRY_FILENAME).write_text(
                frontmatter, encoding="utf-8", newline="\n"
            )

        await asyncio.to_thread(_write)
        await self._audit_skill_write(
            actor, workspace_id, "workspace_skill.create", name, _SKILL_ENTRY_FILENAME
        )
        return await self.list_skills(workspace_id)

    async def delete_skill(
        self, workspace_id: uuid.UUID, skill_name: str, actor: User
    ) -> SkillMutationResponse:
        """删除整个 skill 目录（symlink 防护：非常规条目拒绝，防逃逸）。"""
        name = self._validate_segment(skill_name)
        skills_root = await self._skills_root(workspace_id)
        skill_dir = (skills_root / name).resolve()
        if os.path.commonpath((str(skills_root.resolve()), str(skill_dir))) != str(
            skills_root.resolve()
        ):
            raise SkillPathInvalid(path=skill_name)
        if not skill_dir.is_dir():
            raise SkillNotFound(message=f"skill {name} 不存在", skill=name)

        def _rmtree() -> None:
            # symlink 防护：目录内任一符号链接条目 → 拒绝删除（防链接逃逸删除外部文件）
            for child in skill_dir.rglob("*"):
                if child.is_symlink():
                    raise SkillPathInvalid(path=f"{name}/{child.relative_to(skill_dir)}")
            shutil.rmtree(skill_dir)

        await asyncio.to_thread(_rmtree)
        await self._audit_skill_write(actor, workspace_id, "workspace_skill.delete", name, None)
        return SkillMutationResponse(deleted=True)

    async def read_skill_file(
        self, workspace_id: uuid.UUID, skill_name: str, file_path: str
    ) -> SkillFileContentResponse:
        """读 skill 内文本文件（UTF-8 探测 + 大小上限）。"""
        skills_root = await self._skills_root(workspace_id)
        target = self._resolve_skill_file_path(skills_root, skill_name, file_path)
        if not target.is_file():
            raise SkillNotFound(
                message=f"文件 {file_path} 不存在", skill=skill_name, path=file_path
            )
        size = target.stat().st_size
        if size > _SKILL_MAX_FILE_BYTES:
            raise SkillFileTooLarge(path=file_path, size=size)
        raw = await asyncio.to_thread(target.read_bytes)
        try:
            content = raw.decode("utf-8")
        except UnicodeDecodeError:
            raise SkillFileNotText(path=file_path) from None
        return SkillFileContentResponse(path=file_path, content=content, size=size)

    async def write_skill_file(
        self,
        workspace_id: uuid.UUID,
        skill_name: str,
        file_path: str,
        payload: SkillFileWriteRequest,
        actor: User,
    ) -> SkillFileWriteResponse:
        """写 skill 内文本文件（新建/覆盖；原子写；父目录自动创建限一层）。"""
        skills_root = await self._skills_root(workspace_id)
        target = self._resolve_skill_file_path(skills_root, skill_name, file_path)
        if not (skills_root / self._validate_segment(skill_name)).is_dir():
            raise SkillNotFound(message=f"skill {skill_name} 不存在", skill=skill_name)
        size = len(payload.content.encode("utf-8"))
        if size > _SKILL_MAX_FILE_BYTES:
            raise SkillFileTooLarge(path=file_path, size=size)

        def _write() -> None:
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp_path = target.with_name(f"{target.name}.tmp-{uuid.uuid4().hex[:12]}")
            try:
                # newline 固定 LF：Windows 文本写会把 LF 翻译成 CRLF，导致 PUT
                # size 与 GET 内容往返不保真（task-03 发现）。
                tmp_path.write_text(payload.content, encoding="utf-8", newline="\n")
                os.replace(tmp_path, target)
            except OSError:
                tmp_path.unlink(missing_ok=True)
                raise

        await asyncio.to_thread(_write)
        await self._audit_skill_write(
            actor, workspace_id, "workspace_skill.update_file", skill_name, file_path
        )
        return SkillFileWriteResponse(path=file_path, size=size)

    async def delete_skill_file(
        self, workspace_id: uuid.UUID, skill_name: str, file_path: str, actor: User
    ) -> SkillMutationResponse:
        """删 skill 内文件（SKILL.md 入口保护）。"""
        normalized = file_path.replace("\\", "/")
        if normalized == _SKILL_ENTRY_FILENAME:
            raise SkillEntryProtected()
        skills_root = await self._skills_root(workspace_id)
        target = self._resolve_skill_file_path(skills_root, skill_name, file_path)
        if not target.is_file():
            raise SkillNotFound(
                message=f"文件 {file_path} 不存在", skill=skill_name, path=file_path
            )
        await asyncio.to_thread(target.unlink)
        await self._audit_skill_write(
            actor, workspace_id, "workspace_skill.delete_file", skill_name, file_path
        )
        return SkillMutationResponse(deleted=True)
