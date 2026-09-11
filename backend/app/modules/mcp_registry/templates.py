"""模板层——预置 seed + 存为模板（task-10 / FR-09、D-004 收藏模板能力）。

Change: 2026-09-10-mcp-central-registry（task-10 / design「数据模型」节 mcp_templates
+ W3「模板表 seed + 存为模板」）。router.py 的 templates GET/POST 桩（task-03）惰性
委托本模块 ``list_templates(session, user)`` / ``save_template(session, payload,
user)``——签名逐字对齐，模块落地后 501 回退自然失效（import 不再抛 ImportError）。

分层铁律（与 importer.py 同款）：
- 密钥键判定遵循用户显式指定态（ql-20260911-003-355a）：模板只记录
  ``secret_env_keys`` 键名（哪些键要加密），密钥**值**绝不进模板（from_server
  形态取 server_config 明文 + encrypted_env 键名；直传形态按 payload 指定态
  剥值）。本模块不触碰 get_cipher / CredentialCipher；
- name 合法性与 stdio-only 校验复用 ``McpRegistryService`` 的静态校验（不实例化
  service，避免无谓构造 cipher）；
- from_server_id 的读可见性守卫走 ``McpRegistryService._get_server``（跨用户私有
  404 防存在性枚举；router.get_server 直组合同款先例）。

预置 seed（PRESET_TEMPLATES，design 数据模型节定稿 6 个，全部公知 stdio 命令，
基线均零 env——预置模板保持「明文无密钥」最小形态）。惰性幂等 seed
（``ensure_preset_templates``）：库内**无任何** is_preset 行时 bootstrap 写入
一次；有则整体跳过（删除单个预置后不复活，仅全部清空才会重建）。并发首调
双 seed 由 ``uq_mcp_templates_preset_name`` 部分唯一索引（20260911010000 迁移）
+ IntegrityError 容错兜底（ql-20260911-003-355a P2-11：check-then-insert 竞态
会双份 seed 永久存留）。触发点收敛在 ``list_templates`` 首调，不动 main.py
启动链（CLAUDE.md 规则 11：未上线无历史负担）。

存为模板（``save_template``，schema ``McpTemplateCreate`` 双形态互斥）：
- 形态① ``from_server_id``：只复制 ``server.server_config`` 明文 +
  ``encrypted_env`` 键名（= 密钥指定态，供「从模板新建」预勾加密开关）；
- 形态② 直传 ``server_config`` + ``secret_env_keys``：stdio-only（D-005）+
  name 合法性校验，指定键的值剥除（任何路径不得把密钥明文写入 mcp_templates）。
- 密钥值丢弃走 log.warning（携带键名，键名非机密）兜底，前端以模板
  ``secret_env_keys`` + 空 env 值为可见事实（新建时预填加密行待用户补值）。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.logging import get_logger
from app.modules.auth.model import User
from app.modules.mcp_registry.model import McpTemplate
from app.modules.mcp_registry.schema import McpTemplateCreate, McpTemplateList, McpTemplateRead
from app.modules.mcp_registry.service import McpRegistryService

log = get_logger(__name__)

# 预置模板定稿（design 数据模型节 5-7 个取 6；每项 name + server_config，全部
# stdio、零 env——公知命令清单见模块 docstring，不确定的包名宁缺毋滥）。
PRESET_TEMPLATES: tuple[dict[str, Any], ...] = (
    {
        "name": "fetch",
        "server_config": {"command": "uvx", "args": ["mcp-server-fetch"]},
    },
    {
        "name": "context7",
        "server_config": {"command": "npx", "args": ["-y", "@upstash/context7-mcp"]},
    },
    {
        "name": "playwright",
        "server_config": {"command": "npx", "args": ["-y", "@playwright/mcp@latest"]},
    },
    {
        "name": "sequentialthinking",
        "server_config": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"],
        },
    },
    {
        "name": "memory",
        "server_config": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"]},
    },
    {
        "name": "git",
        "server_config": {"command": "uvx", "args": ["mcp-server-git"]},
    },
)


async def ensure_preset_templates(session: AsyncSession) -> None:
    """幂等 seed：库内无任何 is_preset 行时 bootstrap 写入一次，否则整体跳过。

    判定粒度是「是否存在预置行」而非逐名补缺——删除单个预置后库内仍有预置行，
    下次调用不复活它；仅全部清空才会重建（task implementation 节字面语义）。
    并发首调双 seed 由 partial unique 索引兜底：败者捕获 IntegrityError 回滚
    静默退出（胜者已 seed，语义等价）。
    """
    existing = (
        (await session.execute(select(McpTemplate).where(col(McpTemplate.is_preset).is_(True))))
        .scalars()
        .first()
    )
    if existing is not None:
        return

    session.add_all(
        McpTemplate(
            name=entry["name"],
            server_config=dict(entry["server_config"]),
            is_preset=True,
            owner_user_id=None,  # NULL=平台预置（design 数据模型节）
        )
        for entry in PRESET_TEMPLATES
    )
    try:
        await session.commit()
    except IntegrityError:
        # 并发首调败者：uq_mcp_templates_preset_name 拒绝重复 seed（P2-11）。
        await session.rollback()
        return
    log.info("mcp_registry.preset_templates_seeded", count=len(PRESET_TEMPLATES))


async def list_templates(session: AsyncSession, user: User) -> McpTemplateList:
    """模板列表：预置（owner NULL，全员可见）∪ 本人自存（owner=当前用户）。

    首调触发惰性 seed（``ensure_preset_templates``）；跨用户自存不出现（防枚举
    同语义，admin 亦无跨用户查看权——蓝图按字面，模板自存是个人资产非共享库）。
    预置在前、自存在后（created_at 升序），前端模板入口的稳定呈现序。
    """
    await ensure_preset_templates(session)

    stmt = (
        select(McpTemplate)
        .where(col(McpTemplate.owner_user_id).is_(None) | (McpTemplate.owner_user_id == user.id))
        .order_by(col(McpTemplate.is_preset).desc(), col(McpTemplate.created_at).asc())
    )
    rows = list((await session.execute(stmt)).scalars().all())
    return McpTemplateList(items=[McpTemplateRead.model_validate(row) for row in rows])


async def save_template(
    session: AsyncSession,
    payload: McpTemplateCreate,
    user: User,
) -> McpTemplateRead:
    """存为模板（双形态互斥由 schema ``_enforce_dual_form`` 在 DTO 期保证）。

    - ``from_server_id``：读可见性守卫（跨用户私有 404，admin 放行）后只复制
      ``server_config`` 明文 + ``encrypted_env`` 键名（密钥指定态随模板，值绝不跟随）；
    - 直传 ``server_config``：stdio-only（D-005）+ name 校验；``secret_env_keys``
      指定键的值剥除（防御纵深，任何路径不写密钥明文进模板）；
    - 有密钥值丢弃时 log.warning（前端以模板 ``secret_env_keys`` 为可见事实）。
    """
    McpRegistryService._validate_name(payload.name)

    dropped_secret_keys: list[str] = []
    if payload.from_server_id is not None:
        # 读可见性守卫（router.get_server 直组合同款先例，不重查表不重发明规则）。
        server = await McpRegistryService(session)._get_server(payload.from_server_id, user)
        # server_config 落库时 env 已只剩明文键；密钥指定态 = encrypted_env 键名。
        config = dict(server.server_config) if isinstance(server.server_config, dict) else {}
        env = config.get("env")
        if isinstance(env, dict):
            for key in server.encrypted_env or {}:
                env.pop(key, None)  # 纵深防御：密钥键不应出现在明文 env（直改库旁路）
        server_config = config
        secret_env_keys = sorted((server.encrypted_env or {}).keys())
        dropped_secret_keys = secret_env_keys
    else:
        payload_config: dict[str, Any] = (
            payload.server_config if payload.server_config is not None else {}
        )
        McpRegistryService._validate_server_type(payload_config)
        server_config = dict(payload_config)
        env = server_config.get("env")
        if isinstance(env, dict):
            for key in payload.secret_env_keys:
                if env.pop(key, None) is not None:
                    dropped_secret_keys.append(key)
        secret_env_keys = sorted(payload.secret_env_keys)

    if dropped_secret_keys:
        log.warning(
            "mcp_registry.template_secret_dropped",
            name=payload.name,
            user_id=str(user.id),
            dropped_keys=sorted(set(dropped_secret_keys)),
        )

    row = McpTemplate(
        name=payload.name,
        server_config=server_config,
        secret_env_keys=secret_env_keys,
        is_preset=False,
        owner_user_id=user.id,  # 自存模板归操作者
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    log.info(
        "mcp_registry.template_saved",
        template_id=str(row.id),
        name=row.name,
        user_id=str(user.id),
        from_server=payload.from_server_id is not None,
    )
    return McpTemplateRead.model_validate(row)
