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
2026-09-11-workspace-asset-bridges task-02：新增 ``import_from_registry``（桥③）——
从 MCP 资产库选入 server 定义，读-合并-整包提交写 ``.mcp.json``（解密 env + 同名
改名 ``-registry`` + 复用原子写与审计，D-004/D-009）。
2026-09-11-workspace-asset-bridges task-03：新增 ``list_adoptable`` / ``adopt``
（桥④）——specDir/skills 反向收编为 CustomSkill（差集三源排除 D-008 + 名归一化
+ frontmatter 原样/缺则拼装对齐打包层防双拼 D-005；specDir 只读不删源）。

参考：
- daemon skill-manager.ts：workspace 自定义 skills 源 = ``specDir/skills/``
- settings/router.py 的 ``_redact_mcp_env``（env secret 遮蔽，复用）
- agent/skills_bundle_service.py 的 ``_build_skill_md``（拼装口径，防双拼）
- skill_source/service.py 的 ``normalize_adopt_name`` / ``platform_skill_names``
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import uuid
from pathlib import Path
from typing import Literal

from fastapi import status
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.core.crypto import CipherKeyMismatch
from app.core.errors import AppError, SpecWorkspaceNotFound
from app.core.spec_paths import SpecPathResolver
from app.modules.agent.skills_bundle_service import _parse_skill_frontmatter
from app.modules.auth.model import User
from app.modules.mcp_registry.service import McpRegistryService
from app.modules.settings.router import (
    _SECRET_REDACTED_PLACEHOLDER as _SET_PLACEHOLDER,
)
from app.modules.settings.router import _redact_mcp_env
from app.modules.skill_source.service import SkillSourceService, normalize_adopt_name
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


# ── 从资产库选入（2026-09-11-workspace-asset-bridges 桥③ / D-004/D-009）─────────

_REGISTRY_IMPORT_SUFFIX = "-registry"
"""同名冲突改名后缀（D-004：workspace 已有同名则循环追加，方向与资产库导入相反）。"""


class McpRegistryEnvUndecryptable(AppError):
    """资产库密文无法解密（key 失配）——导入中止（D-009 三态之一，422）。

    ``CipherKeyMismatch`` 本是 5xx 语义（密钥轮换故障），但发生在导入语境时
    用户可自助处置（去资产库修复密钥后重导），故 import 端点转为 422 + 中文
    文案（design D-009「明确密文无法解密」）。
    """

    code = "HTTP_422_MCP_REGISTRY_ENV_UNDECRYPTABLE"
    http_status = status.HTTP_422_UNPROCESSABLE_ENTITY

    def __init__(self, *, server_id: uuid.UUID) -> None:
        super().__init__(
            "资产库 server 的密文无法解密（加密密钥可能已轮换），请先在 MCP 资产库修复后再导入。",
            details={"server_id": str(server_id)},
        )


class McpRegistryEntryInvalid(AppError):
    """资产库 server 定义无法映射为 ``.mcp.json`` 合法条目（形状/键非法，422）。"""

    code = "HTTP_422_MCP_REGISTRY_ENTRY_INVALID"
    http_status = status.HTTP_422_UNPROCESSABLE_ENTITY

    def __init__(self, *, server_name: str, reason: str) -> None:
        super().__init__(
            f"资产库 server {server_name} 的定义无法写入 .mcp.json（{reason}）。",
            details={"server": server_name, "reason": reason[:200]},
        )


class McpImportFromRegistryRequest(BaseModel):
    """``POST /api/workspaces/{id}/mcp/import-from-registry`` 请求体（D-004）。"""

    model_config = ConfigDict(extra="forbid")

    server_id: uuid.UUID


class McpImportFromRegistryResponse(BaseModel):
    """导入响应：写入结果 + 改名标记 + 三态 warning（D-004/D-009）。

    ``written_name``：实际写入 ``.mcp.json`` 的 server 名（同名冲突改名后的
    最终名）；``renamed``：是否发生改名；``warning``：server 停用/无绑定时
    的提示（仍可导入——写入即生效，与平台绑定态无关）。
    """

    written_name: str
    renamed: bool
    warning: str | None = None


# ── skills 反向收编（2026-09-11-workspace-asset-bridges 桥④ / D-005/D-008）────

_ADOPT_DESCRIPTION_MAX_LENGTH = 200
"""收编 description 截断长度（CustomSkill.description String(200) 同宽）。"""

_ADOPT_DESCRIPTION_FALLBACK = "从 workspace 收编"
"""SKILL.md 无 frontmatter description 时的中文兜底（非空，满足 min_length=1）。"""


class AdoptableSkill(BaseModel):
    """单个可收编候选（``GET /skills/adoptable`` 条目，D-005 两阶段之列表）。

    ``name``：specDir/skills/ 目录名原样（确认落库时回传该名）；``valid``：
    归一化后是否满足 CustomSkill name 规则（False → adopt 侧跳过并带
    ``invalid_reason``，不炸整批）；``has_extra_files``：除 SKILL.md 外还有
    辅助文件——CustomSkill 单文件模型不收编辅助文件，前端提示手动合并。
    """

    name: str
    description: str
    normalized_name: str
    valid: bool
    invalid_reason: str | None = None
    has_extra_files: bool


class AdoptableSkillsResponse(BaseModel):
    """``GET /api/workspaces/{id}/skills/adoptable`` 响应（差集候选，只读）。"""

    skills: list[AdoptableSkill]


class SkillAdoptRequest(BaseModel):
    """``POST /api/workspaces/{id}/skills/adopt`` 请求体（确认落库阶段）。

    ``names`` 为 adoptable 列表回传的目录名数组（原样 name，非归一化名）。
    """

    model_config = ConfigDict(extra="forbid")

    names: list[str] = Field(min_length=1, max_length=100)


AdoptItemStatus = Literal["adopted", "invalid", "missing", "conflict"]
"""逐名结果状态：成功 / 归一化非法跳过 / 目录或 SKILL.md 不存在 / 重名 409。"""


class SkillAdoptItemResult(BaseModel):
    """单个 name 的收编结果（整批逐名独立，单名失败不影响其余，D-005）。"""

    name: str
    status: AdoptItemStatus
    normalized_name: str | None = None
    skill_id: uuid.UUID | None = None
    reason: str | None = None


class SkillAdoptResponse(BaseModel):
    """``POST /api/workspaces/{id}/skills/adopt`` 响应（逐名结果数组）。"""

    results: list[SkillAdoptItemResult]


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

    async def import_from_registry(
        self,
        workspace_id: uuid.UUID,
        payload: McpImportFromRegistryRequest,
        actor: User,
    ) -> McpImportFromRegistryResponse:
        """从 MCP 资产库选入 server 定义，读-合并-整包提交写 ``.mcp.json``（桥③）。

        2026-09-11-workspace-asset-bridges task-02 / FR-02 / D-004 / D-009：

        - registry 侧 ``get_server_for_import`` 读导入视图：可见性 404 防枚举；
          env 解密为完整明文——**解密仅发生在导入内容构造期**（D-004），密文
          绝不直接写盘；``CipherKeyMismatch`` 在此转 422 中文文案（D-009）；
        - 导入条目经 ``McpServerEntryPut`` 校验（与手工 PUT 完全同口径：仅
          stdio + 形状一致，D-005@v2 防 SSRF 边界不因导入旁路），失败不落盘；
        - 同名冲突改名：workspace 已有同名 server → 后缀 ``-registry`` 循环
          避撞（资产库导入 skip-or-rename 的反向语义，D-004），其余既有条目
          逐字不变；
        - 复用既有原子写（同目录临时文件 + ``os.replace``）与手工审计模式
          （details 记 server_id 与改名结果，不含 env 值）；
        - server 停用/无绑定**不阻断**导入（``.mcp.json`` 写入即生效，与平台
          绑定态无关），响应透传 ``warning``（D-009 三态）；registry 侧
          server/binding 状态零变化。
        """
        registry_svc = McpRegistryService(self._session)
        try:
            view = await registry_svc.get_server_for_import(payload.server_id, actor)
        except CipherKeyMismatch as exc:
            raise McpRegistryEnvUndecryptable(server_id=payload.server_id) from exc

        try:
            entry = McpServerEntryPut.model_validate(view.server_config)
        except ValidationError as exc:
            first = exc.errors()[0]
            reason = f"{'.'.join(str(loc) for loc in first.get('loc', ()))}: {first.get('msg', '')}"
            raise McpRegistryEntryInvalid(server_name=view.name, reason=reason) from exc
        if entry.type != "stdio":
            raise McpConfigTypeNotStdio(server=view.name, entry_type=entry.type)

        ws, spec_ws = await self._get_base(workspace_id)
        # 归档区禁写（同 update_mcp_config：import 同属 .mcp.json 归档区文件写）。
        WorkspaceService.ensure_writable(ws)
        resolver = self._resolver_for(ws, spec_ws)
        if resolver is None:
            raise SpecWorkspaceNotFound(
                "未找到该工作区对应的 spec 工作区。",
                details={"workspace_id": str(workspace_id)},
            )
        mcp_path = resolver._spec_root() / ".mcp.json"

        existing = await asyncio.to_thread(self._read_existing_mcp_servers_sync, mcp_path)
        written_name = view.name
        renamed = False
        while written_name in existing:
            written_name = f"{written_name}{_REGISTRY_IMPORT_SUFFIX}"
            renamed = True
        merged = dict(existing)
        merged[written_name] = entry.model_dump(exclude_none=True)

        await asyncio.to_thread(self._write_mcp_config_sync, mcp_path, {"mcpServers": merged})

        # 审计（update_mcp_config 同款手工插行：纯文件写不触发 audit_hooks；
        # details 记 server_id 与改名结果，env 明文只落 .mcp.json 不进审计）。
        self._session.add(
            AuditLog(
                action="workspace_mcp_config.import_from_registry",
                resource_type="workspace_mcp_config",
                resource_id=AUDIT_PLACEHOLDER_ID,
                workspace_id=workspace_id,
                actor_id=actor.id,
                details_json=json.dumps(
                    {
                        "server_id": str(payload.server_id),
                        "written_name": written_name,
                        "renamed": renamed,
                    },
                    ensure_ascii=False,
                ),
            )
        )
        await self._session.commit()

        return McpImportFromRegistryResponse(
            written_name=written_name,
            renamed=renamed,
            warning=view.warning,
        )

    # ── skills 反向收编（桥④ / D-005/D-008，specDir 只读不删源）────────────────

    async def list_adoptable(self, workspace_id: uuid.UUID, actor: User) -> AdoptableSkillsResponse:
        """列 specDir/skills/ 可收编候选（差集扫描，只读，D-005 两阶段之列表）。

        2026-09-11-workspace-asset-bridges task-03 / FR-03 / D-008：

        - 扫描复用 ``list_skills`` 同源 resolver 与目录遍历（``_scan_adoptable_sync``
          平铺列文件 + 读各 SKILL.md frontmatter，容错降级——坏文件不炸清单）；
        - 差集排除：specDir 目录名 − 平台库名全集（
          :meth:`SkillSourceService.platform_skill_names`：CustomSkill 全体名
          ∪ sillyspec-* ∪ enabled git 源 discover）− ``sillyspec-`` 前缀目录；
        - 候选字段：``description`` 取 frontmatter 截 200（缺省中文兜底）；
          ``normalized_name``/``valid``/``invalid_reason`` 来自
          :func:`normalize_adopt_name`（D-008 归一化）；``has_extra_files``
          标记多文件技能（辅助文件不收编，提示手动合并）；
        - ``actor`` 仅为 D-008 签名稳定保留——差集口径是**全体名**（不限
          owner），WORKSPACE_WRITE 已由端点保证，此处不再过滤。

        specDir 只读：不写不删任何源文件（D-005：收编后源文件由用户自清）。
        无 spec 工作区 / 无 skills 子目录 → 空列表（与 ``list_skills`` 同口径）。
        """
        ws, spec_ws = await self._get_base(workspace_id)
        resolver = self._resolver_for(ws, spec_ws)
        if resolver is None:
            return AdoptableSkillsResponse(skills=[])

        skills_dir = resolver._spec_root() / "skills"
        platform_names = await SkillSourceService(self._session).platform_skill_names()
        scanned = await asyncio.to_thread(self._scan_adoptable_sync, skills_dir)

        skills: list[AdoptableSkill] = []
        for name, files, description in scanned:
            if name in platform_names or name.startswith("sillyspec-"):
                continue  # 差集排除：平台库名全集 + sillyspec- 前缀目录（D-008）
            normalized, invalid_reason = normalize_adopt_name(name)
            has_skill_md = _SKILL_ENTRY_FILENAME in files
            if not has_skill_md:
                invalid_reason = "缺少 SKILL.md 入口文件，无法收编"
            skills.append(
                AdoptableSkill(
                    name=name,
                    description=(description or _ADOPT_DESCRIPTION_FALLBACK)[
                        :_ADOPT_DESCRIPTION_MAX_LENGTH
                    ],
                    normalized_name=normalized,
                    valid=has_skill_md and invalid_reason is None,
                    invalid_reason=invalid_reason,
                    has_extra_files=any(f != _SKILL_ENTRY_FILENAME for f in files),
                )
            )
        return AdoptableSkillsResponse(skills=skills)

    async def adopt(
        self, workspace_id: uuid.UUID, names: list[str], actor: User
    ) -> SkillAdoptResponse:
        """逐个读 specDir SKILL.md 原文写 CustomSkill（D-005 两阶段之确认落库）。

        - **不删源文件**（specDir 只读语义保持——用户确认收编成功后自清）；
        - 逐名独立结果（单名失败不炸整批）：``invalid``（归一化非法/名段非法/
          非 UTF-8 文本，带原因跳过）、``missing``（目录或 SKILL.md 不存在）、
          ``conflict``（重名走 ``CustomSkillService.create`` 既有 409 语义，
          逐名呈现）、``adopted``（成功，附 skill_id）；
        - CustomSkill 归属操作者本人（``created_by=actor.id``，D-005）；落库走
          skills 模块 ``CustomSkillService.create``（延迟导入——skills 模块
          零改动，函数内 import 同 ``_collect_enabled_git_skills`` 先例）；
        - 内容口径（D-005）：SKILL.md 已带 frontmatter → **原文逐字落库**
          （打包层 ``_build_skill_md`` 检测围栏直通，防双拼）；缺 frontmatter
          → 按打包层同款格式拼装头（name/description + 原文 body）。

        无 spec 工作区 → :class:`SpecWorkspaceNotFound`（落库语义路径不静默）。
        """
        # 延迟导入：skills.service 落库通道（不改 skills 模块；模块级 import 交
        # 错路由加载顺序，函数内 import 是本仓处理跨模块写通道的既有先例）。
        from app.modules.skills.service import CustomSkillService, SkillNameConflict

        ws, spec_ws = await self._get_base(workspace_id)
        resolver = self._resolver_for(ws, spec_ws)
        if resolver is None:
            raise SpecWorkspaceNotFound(
                "未找到该工作区对应的 spec 工作区。",
                details={"workspace_id": str(workspace_id)},
            )
        skills_root = resolver._spec_root() / "skills"

        results: list[SkillAdoptItemResult] = []
        for name in names:
            try:
                segment = self._validate_segment(name)
            except SkillNameInvalid:
                results.append(
                    SkillAdoptItemResult(
                        name=name,
                        status="invalid",
                        reason="名称仅允许字母、数字、点、下划线和连字符，且不能是 ..",
                    )
                )
                continue

            skill_dir = skills_root / segment
            skill_md = skill_dir / _SKILL_ENTRY_FILENAME
            if not skill_dir.is_dir() or not skill_md.is_file():
                results.append(
                    SkillAdoptItemResult(
                        name=name,
                        status="missing",
                        reason=f"skill {segment} 不存在或缺少 SKILL.md 入口文件",
                    )
                )
                continue

            normalized, invalid_reason = normalize_adopt_name(segment)
            if invalid_reason is not None:
                results.append(
                    SkillAdoptItemResult(
                        name=name,
                        status="invalid",
                        normalized_name=normalized,
                        reason=invalid_reason,
                    )
                )
                continue

            try:
                raw = await asyncio.to_thread(skill_md.read_bytes)
                body_text = raw.decode("utf-8")
            except UnicodeDecodeError:
                results.append(
                    SkillAdoptItemResult(
                        name=name,
                        normalized_name=normalized,
                        status="invalid",
                        reason="SKILL.md 不是 UTF-8 文本，无法收编",
                    )
                )
                continue
            except OSError:
                results.append(
                    SkillAdoptItemResult(
                        name=name,
                        normalized_name=normalized,
                        status="missing",
                        reason=f"SKILL.md 读取失败：{segment}",
                    )
                )
                continue

            description = (_parse_skill_frontmatter(raw).get("description") or "")[
                :_ADOPT_DESCRIPTION_MAX_LENGTH
            ] or _ADOPT_DESCRIPTION_FALLBACK
            # D-005 内容口径：原文已带 frontmatter 围栏 → 逐字原样（打包层
            # _build_skill_md 同检测直通）；缺 → 按打包层同款格式拼装（防双拼）。
            content = body_text
            if not body_text.lstrip().startswith("---"):
                content = f"---\nname: {normalized}\ndescription: {description}\n---\n\n{body_text}"

            try:
                skill = await CustomSkillService(self._session).create(
                    name=normalized,
                    description=description,
                    content=content,
                    created_by=actor.id,
                )
            except SkillNameConflict:
                results.append(
                    SkillAdoptItemResult(
                        name=name,
                        normalized_name=normalized,
                        status="conflict",
                        reason=f"name 已存在（409）：{normalized}",
                    )
                )
                continue
            results.append(
                SkillAdoptItemResult(
                    name=name,
                    status="adopted",
                    normalized_name=normalized,
                    skill_id=skill.id,
                )
            )
        return SkillAdoptResponse(results=results)

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
    def _scan_adoptable_sync(skills_dir: Path) -> list[tuple[str, list[str], str]]:
        """``list_adoptable`` 同步扫描段（桥④，移出事件循环）。

        复用 ``_list_skills_sync`` 同款遍历（子目录 + 平铺文件清单），额外读各
        目录 SKILL.md 的 frontmatter description（坏文件容错空串，不炸清单——
        与 ``_parse_skill_frontmatter`` 容错口径一致）。返回
        ``(目录名, 文件清单, description)`` 列表（按目录名排序，确定序）。
        """
        if not skills_dir.is_dir():
            return []
        scanned: list[tuple[str, list[str], str]] = []
        try:
            for entry in sorted(skills_dir.iterdir()):
                if not entry.is_dir():
                    continue
                files = SkillsViewService._list_files_local(entry)
                try:
                    frontmatter = _parse_skill_frontmatter(
                        (entry / _SKILL_ENTRY_FILENAME).read_bytes()
                    )
                except OSError:
                    frontmatter = {}
                scanned.append((entry.name, files, frontmatter.get("description", "")))
        except (OSError, PermissionError):
            return scanned
        return scanned

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
