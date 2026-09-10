"""McpRegistryService——CRUD、双层可见性、binding 约束与 CredentialCipher 逐键加密读写。

Change: 2026-09-10-mcp-central-registry（task-02 / design「接口定义」节——六个方法
签名的唯一权威，逐项对照无发明）。分层照 ``llm_provider/service.py`` 先例：
``__init__(session, *, cipher=None)`` + lazy ``_default_cipher()``；service 抛
``AppError`` 子类，由 router（task-03）转 HTTP，全局异常处理器统一序列化。

权限矩阵（design REST 端点注释）：
- 平台库（owner=NULL）写操作（create scope=platform / update / delete /
  platform binding）非 admin → ``PermissionDenied`` 403。admin 判定与
  ``require_permission_any(SETTINGS_ADMIN)`` 同权限点——复用 ``rbac.has_permission``
  （is_platform_admin 短路 → 平台级 user_roles → 全 workspace 并集）。
- 跨用户私有库读改删一律 ``McpServerNotFound`` 404（与「不存在」同错误码，
  防存在性枚举，对齐 skills/service.py 先例）；归属者与 admin 正常通过。
- 平台库全员可见（读不设 admin 门槛，list scope=platform/visible）。

binding 约束（D-002，DB partial unique 之外的 service 层业务约束）：
- platform binding 需 admin，scope_ref 恒 NULL；
- user binding 的 scope_ref（= 操作者 user.id）必须是 server 归属者本人，
  或 server 为平台共享（owner NULL）——否则 422 ``McpBindingScopeInvalid``；
- 重复 binding 先友好预检（409），``IntegrityError`` 兜底并发（skills 先例）。

加密读写（Grill CC-03 / R-04）：
- secret 键判定与 schema 脱敏同源——直接 import ``schema._SECRET_KEY_MARKERS``
  （token/key/secret/password 子串，大小写不敏感，settings/router.py:164 同款）；
- 写：env 逐键抽列，``CredentialCipher.encrypt(str)->(bytes, key_id)`` 循环调用
  → ``McpEnvCiphertext.of`` 信封化（base64 ct + key_id）入 ``encrypted_env``，
  ``server_config.env`` 只留非 secret 明文键（明文永不入 ORM）；
- 读：``decrypt_server_env`` 逐键还原完整 env；key 失配抛 ``CipherKeyMismatch``
  不在本层吞错（留给 task-04 诊断降级 decrypt_failed）。

stdio-only（D-005）：``McpServerCreate``/``McpServerUpdate`` 无 server_type 字段，
类型取自 ``server_config["type"]``（缺省 stdio）——声明非 stdio → 422。
"""

from __future__ import annotations

import base64
import re
import uuid
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.crypto import CredentialCipher
from app.core.errors import AppError, PermissionDenied
from app.core.logging import get_logger
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import has_permission
from app.modules.mcp_registry.model import McpServer, McpServerBinding
from app.modules.mcp_registry.schema import (
    _SECRET_KEY_MARKERS,
    McpEnvCiphertext,
    McpServerCreate,
    McpServerDetail,
    McpServerList,
    McpServerRead,
    McpServerUpdate,
)

log = get_logger(__name__)

# list ?scope= 词表（visible 仅为查询态非落库态，design 接口定义）。
ScopeFilter = Literal["platform", "mine", "visible"]

# name 字符集（design 数据模型节：mcpServers key 安全字符，总长 2-100）。
_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{1,99}$")

# 写路径仅接受 stdio（D-005）；'http'/'sse' 建模预留，放行需独立变更。
_ALLOWED_SERVER_TYPE = "stdio"


# ── 错误类（沿用 llm_provider 的 ``HTTP_<status>_<EVENT>`` 命名范式）──────────


class McpServerNotFound(AppError):
    """server 不存在，或为他人私有库对当前用户不可见（404 防存在性枚举）。"""

    code = "HTTP_404_MCP_SERVER_NOT_FOUND"
    http_status = 404


class McpServerNameConflict(AppError):
    """同 owner 维度（平台位 / 同一用户位）name 已存在（409）。"""

    code = "HTTP_409_MCP_SERVER_NAME_CONFLICT"
    http_status = 409


class McpServerNameInvalid(AppError):
    """name 不匹配 ^[a-z0-9][a-z0-9-]{1,99}$（422）。"""

    code = "HTTP_422_MCP_SERVER_NAME_INVALID"
    http_status = 422


class McpServerTypeInvalid(AppError):
    """server_config 声明的 type 非 stdio（422，D-005 写路径拦截）。"""

    code = "HTTP_422_MCP_SERVER_TYPE_INVALID"
    http_status = 422


class McpBindingDuplicate(AppError):
    """binding 已存在（409，同 partial unique 约束的友好预检形态）。"""

    code = "HTTP_409_MCP_BINDING_DUPLICATE"
    http_status = 409


class McpBindingScopeInvalid(AppError):
    """binding scope 语义非法（422）：scope_type 越词表，或 user binding 的
    scope_ref 非 server 归属者本人且 server 非平台共享。"""

    code = "HTTP_422_MCP_BINDING_SCOPE_INVALID"
    http_status = 422


class McpBindingNotFound(AppError):
    """指定 (server, scope_type[, scope_ref]) 的 binding 不存在（404）。"""

    code = "HTTP_404_MCP_BINDING_NOT_FOUND"
    http_status = 404


# ── secret env 切分（与 schema 脱敏同源：_SECRET_KEY_MARKERS）────────────────


def _is_secret_env_key(key: str) -> bool:
    """键名含 token/key/secret/password 子串（大小写不敏感）→ secret（R-05 双向一致）。"""
    lowered = str(key).lower()
    return any(marker in lowered for marker in _SECRET_KEY_MARKERS)


def _split_secret_env(
    server_config: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """server_config 浅拷贝为「env 仅剩非 secret 键」形态。

    返回 ``(净化后 server_config, secret 键明文映射)``；无 env 或 env 非 dict 时
    原样返回空 secret 映射。secret 值统一 ``str()`` 归一后加密（解密回读为 str）。
    """
    sanitized = dict(server_config)
    env = sanitized.get("env")
    if not isinstance(env, dict):
        return sanitized, {}
    plain: dict[str, Any] = {}
    secret: dict[str, Any] = {}
    for k, v in env.items():
        if _is_secret_env_key(k):
            secret[k] = v
        else:
            plain[k] = v
    sanitized["env"] = plain
    return sanitized, secret


class McpRegistryService:
    """MCP 中央资产库 service 层（design「接口定义」节六方法）。"""

    def __init__(
        self,
        session: AsyncSession,
        *,
        cipher: CredentialCipher | None = None,
    ) -> None:
        self._session = session
        self._cipher = cipher or self._default_cipher()

    @staticmethod
    def _default_cipher() -> CredentialCipher:
        from app.core.crypto import get_cipher

        return get_cipher()

    # ── 查询 ──────────────────────────────────────────────────────────

    async def list_servers(
        self,
        scope: ScopeFilter,
        user: User,
        *,
        search: str | None = None,
        tag: str | None = None,
    ) -> McpServerList:
        """按 scope 列表（env 脱敏 + 绑定态注入，design「接口定义」）。

        - ``platform``：平台共享库全员可见（owner NULL，admin 管理、全员读）；
        - ``mine``：当前用户私有库（owner = user.id）；
        - ``visible``：平台共享 ∪ 自己私有（默认视图）。

        ``search``/``tag`` 支撑 REST ``?search=&tag=``：tags 是 JSON 列，contains
        谓词跨方言（PG JSON / SQLite JSON）不可移植，registry 规模小（R-04），
        两者都在 Python 侧过滤。diagnostic_codes 留 W2 诊断（task-04）注入。
        """
        if scope == "platform":
            stmt = select(McpServer).where(col(McpServer.owner_user_id).is_(None))
        elif scope == "mine":
            stmt = select(McpServer).where(McpServer.owner_user_id == user.id)
        else:  # visible
            stmt = select(McpServer).where(
                col(McpServer.owner_user_id).is_(None) | (McpServer.owner_user_id == user.id)
            )
        stmt = stmt.order_by(col(McpServer.created_at).desc())
        rows = list((await self._session.execute(stmt)).scalars().all())
        items = [McpServerRead.model_validate(row) for row in rows]
        if search:
            needle = search.strip().lower()
            items = [i for i in items if needle in i.name.lower() or needle in i.note.lower()]
        if tag:
            items = [i for i in items if tag in i.tags]
        await self._annotate_binding_states(items, user)
        return McpServerList(items=items, total=len(items))

    # ── CRUD ──────────────────────────────────────────────────────────

    async def create_server(self, inp: McpServerCreate, user: User) -> McpServerDetail:
        """创建 server（design：scope=platform 需 admin；stdio-only；secret 抽列加密）。"""
        self._validate_name(inp.name)
        self._validate_server_type(inp.server_config)
        owner: uuid.UUID | None
        if inp.scope == "platform":
            await self._require_admin(user)
            owner = None
        else:
            owner = user.id
        await self._require_name_available(inp.name, owner)

        sanitized, secret_env = _split_secret_env(inp.server_config)
        row = McpServer(
            name=inp.name,
            owner_user_id=owner,
            server_type=_ALLOWED_SERVER_TYPE,
            server_config=sanitized,
            encrypted_env=self._encrypt_secret_env(secret_env),
            source=inp.source,
            dedup_key=inp.dedup_key,
        )
        self._session.add(row)
        try:
            await self._session.commit()
        except IntegrityError as exc:
            # 并发兜底：预检与 commit 之间被插入同位同名记录（skills 先例）。
            await self._session.rollback()
            raise McpServerNameConflict(
                f"name 已存在（并发）：{inp.name!r}",
                details={"name": inp.name, "scope": inp.scope},
            ) from exc
        await self._session.refresh(row)
        log.info(
            "mcp_registry.server_created",
            server_id=str(row.id),
            scope=inp.scope,
            user_id=str(user.id),
            source=row.source,
        )
        return await self._to_detail(row, user)

    async def update_server(
        self,
        server_id: uuid.UUID,
        inp: McpServerUpdate,
        user: User,
    ) -> McpServerDetail:
        """部分更新（None=不动；换 server_config 时重抽列重加密整份 env）。"""
        row = await self._get_server_for_write(server_id, user)
        updates = inp.model_dump(exclude_unset=True)

        new_name = updates.pop("name", None)
        if new_name is not None and new_name != row.name:
            self._validate_name(new_name)
            await self._require_name_available(new_name, row.owner_user_id, except_id=row.id)
            row.name = new_name

        new_config = updates.pop("server_config", None)
        if new_config is not None:
            self._validate_server_type(new_config)
            sanitized, secret_env = _split_secret_env(new_config)
            row.server_config = sanitized
            row.encrypted_env = self._encrypt_secret_env(secret_env)

        for field in ("tags", "note", "enabled"):
            if field in updates:
                setattr(row, field, updates[field])

        self._session.add(row)
        try:
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            raise McpServerNameConflict(
                f"name 已存在（并发）：{row.name!r}",
                details={"server_id": str(server_id)},
            ) from exc
        await self._session.refresh(row)
        log.info("mcp_registry.server_updated", server_id=str(row.id), user_id=str(user.id))
        return await self._to_detail(row, user)

    async def delete_server(self, server_id: uuid.UUID, user: User) -> None:
        """删除 server；级联删 binding 靠 FK CASCADE（model/迁移 ondelete，不手工模拟）。"""
        row = await self._get_server_for_write(server_id, user)
        await self._session.delete(row)
        await self._session.commit()
        log.info("mcp_registry.server_deleted", server_id=str(server_id), user_id=str(user.id))

    # ── binding（D-002）───────────────────────────────────────────────

    async def add_binding(self, server_id: uuid.UUID, scope_type: str, user: User) -> None:
        """加绑定：platform 需 admin；user binding 校验归属（design 接口定义）。

        注意 user binding 加在平台共享 server 上**不是**平台库写操作（注入集是
        操作者本人的），故访问检查走读可见性（``_get_server``）而非
        ``_get_server_for_write``；平台库写门槛只对 scope_type='platform' 生效。
        """
        if scope_type not in ("platform", "user"):
            raise McpBindingScopeInvalid(
                f"scope_type 仅支持 platform/user：{scope_type!r}",
                details={"scope_type": scope_type},
            )
        row = await self._get_server(server_id, user)

        scope_ref: uuid.UUID | None
        if scope_type == "platform":
            await self._require_admin(user)
            scope_ref = None
        else:
            scope_ref = user.id
            # 业务约束（design 数据模型节）：scope_ref 必须 = server.owner_user_id
            # 或 server 为平台共享（owner NULL）。非 admin 跨用户已在可见性处 404；
            # 此处拦的是 admin 对他人私有库的 user binding（可见但语义非法）。
            if row.owner_user_id is not None and row.owner_user_id != scope_ref:
                raise McpBindingScopeInvalid(
                    "user binding 仅允许绑定自己私有的 server 或平台共享 server。",
                    details={"server_id": str(server_id), "scope_ref": str(scope_ref)},
                )

        if await self._get_binding(server_id, scope_type, scope_ref) is not None:
            raise McpBindingDuplicate(
                "该绑定已存在。",
                details=self._binding_details(server_id, scope_type, scope_ref),
            )
        binding = McpServerBinding(server_id=server_id, scope_type=scope_type, scope_ref=scope_ref)
        self._session.add(binding)
        try:
            await self._session.commit()
        except IntegrityError as exc:
            # partial unique index 并发兜底（uq_binding_platform / uq_binding_user）。
            await self._session.rollback()
            raise McpBindingDuplicate(
                "该绑定已存在（并发）。",
                details=self._binding_details(server_id, scope_type, scope_ref),
            ) from exc
        log.info(
            "mcp_registry.binding_added",
            server_id=str(server_id),
            scope_type=scope_type,
            scope_ref=str(scope_ref) if scope_ref else None,
            user_id=str(user.id),
        )

    async def remove_binding(
        self,
        server_id: uuid.UUID,
        scope_type: str,
        scope_ref: uuid.UUID | None,
        user: User,
    ) -> None:
        """解绑：按 scope_type 与 scope_ref 精确删（design 接口定义）。

        platform 解绑需 admin；user 解绑 scope_ref=本人即可，解他人的 user
        binding（scope_ref != user.id）需 admin。无匹配行 → 404。
        """
        if scope_type not in ("platform", "user"):
            raise McpBindingScopeInvalid(
                f"scope_type 仅支持 platform/user：{scope_type!r}",
                details={"scope_type": scope_type},
            )
        await self._get_server(server_id, user)  # 可见性守卫（跨用户私有 404 不泄露）

        if scope_type == "platform":
            await self._require_admin(user)
        else:
            if scope_ref is None:
                raise McpBindingScopeInvalid(
                    "user binding 解绑必须提供 scope_ref。",
                    details={"server_id": str(server_id)},
                )
            if scope_ref != user.id:
                await self._require_admin(user)

        binding = await self._get_binding(server_id, scope_type, scope_ref)
        if binding is None:
            raise McpBindingNotFound(
                "绑定不存在。",
                details=self._binding_details(server_id, scope_type, scope_ref),
            )
        await self._session.delete(binding)
        await self._session.commit()
        log.info(
            "mcp_registry.binding_removed",
            server_id=str(server_id),
            scope_type=scope_type,
            scope_ref=str(scope_ref) if scope_ref else None,
            user_id=str(user.id),
        )

    # ── 加密读路径（render/W2 注入集与诊断消费）───────────────────────

    def decrypt_server_env(self, server: McpServer) -> dict[str, Any]:
        """解密还原完整 env：``server_config.env``（非 secret 明文）∪ 逐键解密。

        逐键独立解密（每键自带 key_id 支持密钥轮换）；key 失配抛
        ``CipherKeyMismatch`` 原样上抛——不在本层吞错，由 task-04 渲染侧降级为
        诊断项 ``decrypt_failed``（design 数据模型节）。
        """
        env: dict[str, Any] = {}
        cfg_env = (
            server.server_config.get("env") if isinstance(server.server_config, dict) else None
        )
        if isinstance(cfg_env, dict):
            env.update(cfg_env)
        for key, envelope in (server.encrypted_env or {}).items():
            entry = McpEnvCiphertext.model_validate(envelope)
            plaintext = self._cipher.decrypt(base64.b64decode(entry.ct), entry.key_id)
            env[key] = plaintext
        return env

    def _encrypt_secret_env(self, secret_env: dict[str, Any]) -> dict[str, dict[str, str]] | None:
        """secret 明文映射 → 逐键密文信封（无 secret 键时 None，对齐列默认）。"""
        if not secret_env:
            return None
        encrypted: dict[str, dict[str, str]] = {}
        for key, value in secret_env.items():
            ciphertext, key_id = self._cipher.encrypt(str(value))
            encrypted[key] = McpEnvCiphertext.of(ciphertext, key_id).model_dump()
        return encrypted

    # ── 权限与可见性（design 权限矩阵收敛处）──────────────────────────

    async def _is_admin(self, user: User) -> bool:
        """与 ``require_permission_any(SETTINGS_ADMIN)`` 同权限点同判定链。

        复用 ``rbac.has_permission(workspace_id=None)``：is_platform_admin 短路 →
        平台级 user_roles 授权 → 全 workspace 并集（auth_deps.py:135-152 同款）。
        """
        return await has_permission(
            self._session,
            user=user,
            permission=Permission.SETTINGS_ADMIN,
            workspace_id=None,
        )

    async def _require_admin(self, user: User) -> None:
        if not await self._is_admin(user):
            raise PermissionDenied(
                "该操作需要管理员权限（settings:admin）。",
                details={"permission": Permission.SETTINGS_ADMIN.value},
            )

    async def _get_server(self, server_id: uuid.UUID, user: User) -> McpServer:
        """读可见性：不存在，或他人私有且非 admin → 同一 404（防存在性枚举）。"""
        row = await self._session.get(McpServer, server_id)
        if row is None:
            raise McpServerNotFound(
                "MCP server 不存在。",
                details={"server_id": str(server_id)},
            )
        if (
            row.owner_user_id is not None
            and row.owner_user_id != user.id
            and not await self._is_admin(user)
        ):
            raise McpServerNotFound(
                "MCP server 不存在。",
                details={"server_id": str(server_id)},
            )
        return row

    async def _get_server_for_write(self, server_id: uuid.UUID, user: User) -> McpServer:
        """写可见性：读可见性 + 平台库写需 admin（用户私有库归属者本人直接放行）。"""
        row = await self._get_server(server_id, user)
        if row.owner_user_id is None:
            await self._require_admin(user)
        return row

    async def _require_name_available(
        self,
        name: str,
        owner: uuid.UUID | None,
        *,
        except_id: uuid.UUID | None = None,
    ) -> None:
        """同 owner 维度查重（uq_mcp_servers_owner_name 的 COALESCE 语义在 ORM 侧等价）。

        平台位只与平台位互斥、用户位只与同 owner 互斥；跨 owner / owner vs
        平台位同名放行（design 数据模型节唯一性规格）。
        """
        stmt = select(McpServer).where(McpServer.name == name)
        if owner is None:
            stmt = stmt.where(col(McpServer.owner_user_id).is_(None))
        else:
            stmt = stmt.where(McpServer.owner_user_id == owner)
        if except_id is not None:
            stmt = stmt.where(McpServer.id != except_id)
        existing = (await self._session.execute(stmt)).scalars().first()
        if existing is not None:
            raise McpServerNameConflict(
                f"name 已存在：{name!r}",
                details={"name": name, "conflict_id": str(existing.id)},
            )

    # ── 校验（写路径，D-005 / design 数据模型节 name 正则）────────────

    @staticmethod
    def _validate_name(name: str) -> None:
        """schema 层已有 pattern，此处 service 级防御纵深（同 skills 先例分层）。"""
        if not _NAME_PATTERN.match(name):
            raise McpServerNameInvalid(
                f"name 必须匹配 ^[a-z0-9][a-z0-9-]{{1,99}}$：{name!r}",
                details={"name": name, "rule": _NAME_PATTERN.pattern},
            )

    @staticmethod
    def _validate_server_type(server_config: dict[str, Any]) -> None:
        """stdio-only（D-005）：``server_config["type"]`` 缺省视为 stdio。"""
        declared = server_config.get("type", _ALLOWED_SERVER_TYPE)
        if declared != _ALLOWED_SERVER_TYPE:
            raise McpServerTypeInvalid(
                f"仅支持 stdio 类型的 MCP server（当前 type={declared!r}）。",
                details={"type": str(declared)},
            )

    # ── DTO 组装与 binding 态注入 ─────────────────────────────────────

    async def _to_detail(self, row: McpServer, user: User) -> McpServerDetail:
        """ORM 行 → 详情 DTO（env 脱敏 + encrypted_env ct 遮蔽由 schema validator 强制）。"""
        detail = McpServerDetail.model_validate(row)
        await self._annotate_binding_states([detail], user)
        return detail

    async def _annotate_binding_states(
        self,
        items: list[McpServerRead],
        user: User,
    ) -> None:
        """给列表/详情注入当前用户视角的绑定态（缺省 False 为安全方向，绝不虚报）。"""
        if not items:
            return
        server_ids = [item.id for item in items]
        stmt = select(McpServerBinding).where(col(McpServerBinding.server_id).in_(server_ids))
        bindings = (await self._session.execute(stmt)).scalars().all()
        platform_bound_ids = {b.server_id for b in bindings if b.scope_type == "platform"}
        user_bound_ids = {
            b.server_id for b in bindings if b.scope_type == "user" and b.scope_ref == user.id
        }
        for item in items:
            item.platform_bound = item.id in platform_bound_ids
            item.user_bound = item.id in user_bound_ids

    async def _get_binding(
        self,
        server_id: uuid.UUID,
        scope_type: str,
        scope_ref: uuid.UUID | None,
    ) -> McpServerBinding | None:
        stmt = select(McpServerBinding).where(
            McpServerBinding.server_id == server_id,
            McpServerBinding.scope_type == scope_type,
        )
        if scope_ref is None:
            stmt = stmt.where(col(McpServerBinding.scope_ref).is_(None))
        else:
            stmt = stmt.where(McpServerBinding.scope_ref == scope_ref)
        return (await self._session.execute(stmt)).scalars().first()

    @staticmethod
    def _binding_details(
        server_id: uuid.UUID,
        scope_type: str,
        scope_ref: uuid.UUID | None,
    ) -> dict[str, str | None]:
        return {
            "server_id": str(server_id),
            "scope_type": scope_type,
            "scope_ref": str(scope_ref) if scope_ref else None,
        }
