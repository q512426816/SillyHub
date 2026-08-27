"""McpToken use cases — issue / authenticate / revoke + workspace CRUD.

对外 MCP 鉴权的长期凭证（design §5.2 P2 / §8.1 / D-002@v1）。与内部 admin 用的
``ApiKeyService`` 形似但**不复制其 bcrypt O(n) 扫描**：

- ``mcp_tokens.token_hash`` 存 ``sha256(明文)`` 且建唯一索引 → authenticate 按
  ``token_hash`` **O(1) 查表**（MCP 每次工具调用都过这里，必须亚毫秒），不像
  ``ApiKeyService`` 因 bcrypt 不可逆而全表扫描。
- 正/负 Redis 缓存模式与 ``ApiKeyService`` 一致（命中缓存避免每请求查库），
  best-effort 降级（redis 故障回退直查 DB），``last_used_at`` 节流写（复用
  ``auth_api_key_last_used_throttle_seconds``，避免每请求 UPDATE 同一行锁串行化）。
- 签发返回明文 token **仅一次**（DB 只存 sha256，不存明文，R-06）；token_hash 与
  明文均不入日志。

TTL 复用说明：``auth_api_key_cache_ttl`` / ``auth_api_key_negative_cache_ttl`` /
``auth_api_key_last_used_throttle_seconds`` 直接复用（config.py 非本任务 allowed_path，
且两种长期凭证的缓存语义完全一致：正缓存=有效，负缓存=无效探测，revoke 清正缓存）。
两套缓存的 key namespace 独立（``auth:mcptoken:*`` vs ``auth:apikey:*``），共用 TTL
数值不会相互影响。
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.config import Settings
from app.core.crypto import get_cipher
from app.core.errors import AppError
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.core.ssrf import SsrfBlocked, UnsafeRepoUrl, assert_public_url
from app.modules.mcp_gateway.model import McpTokenORM, McpWebhookORM

log = get_logger(__name__)

# webhook 投递 task 强引用（事件循环只持 task 弱引用，裸 create_task 的任务
# 可能被 GC 中途回收——投递内含最长 ~85s 的指数退避，被回收即静默丢回调。
# 同 core/monitoring._sample_tasks 范式）。
_deliver_tasks: set[asyncio.Task] = set()


class McpTokenNotFound(AppError):
    """DELETE/操作不存在的 token 或跨 workspace 越权访问 → 404。

    复用 ApiKeyService.revoke 的 idempotent bool 返回（不存在 / 已吊销 / 跨 ws 均
    False）；router 据此统一抛 404，不泄露「不存在 vs 已吊销 vs 越权」（防存在性探测）。
    定义在 service 模块（非 errors.py）对齐 daemon.service 的 DaemonLeaseNotFound 模式，
    避免触碰 errors.py（非本任务 allowed_path）。
    """

    code = "HTTP_404_MCP_TOKEN_NOT_FOUND"
    http_status = 404


# ``shmcp_`` 前缀（SillyHub MCP）：供 GitHub secret scanning 自定义规则匹配泄漏的
# token，也让 UI 能渲染友好标签。与 ApiKeyService 的 ``shk_live_`` 同思路。前缀不入
# 单独列——authenticate 先判前缀，明文无此前缀直接 return None（不查库）。
MCP_TOKEN_PREFIX = "shmcp_"

# 缓存 key 前缀（与 ApiKeyService 的 ``auth:apikey:*`` 独立 namespace，互不影响）。
_POS_CACHE_PREFIX = "auth:mcptoken:"  # 正缓存：auth:mcptoken:{token_hash}
_NEG_CACHE_PREFIX = "auth:mcptoken:neg:"  # 负缓存：auth:mcptoken:neg:{token_hash}


@dataclass(frozen=True, slots=True)
class McpTokenPrincipal:
    """authenticate 成功结果，注入到 MCP tool 上下文（task-03 middleware 消费）。

    McpToken 无关 user 身份（第三方编排者不是平台 user），只暴露 workspace 归属 +
    scope + token_id（token_id 供下游审计/日志关联，不含敏感值）。
    """

    token_id: uuid.UUID
    workspace_id: uuid.UUID
    scope: list[str]


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _as_utc(dt: datetime) -> datetime:
    """Normalise a possibly-naive datetime (SQLite drops tzinfo) to UTC。"""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _generate_plaintext() -> str:
    """生成新 token 明文（``shmcp_`` + 32 随机字节 url-safe）。"""
    return MCP_TOKEN_PREFIX + secrets.token_urlsafe(32)


def _token_hash(plaintext: str) -> str:
    """sha256(明文)——入库的唯一索引键，也是缓存 key。

    与 ApiKeyService 的 ``_key_digest`` 同算法，但 McpToken **直接存这个 sha256 入库**
    （唯一索引），而不是 bcrypt。所以 authenticate 能按 token_hash O(1) 查表，无需重建
    digest 做前缀 SCAN。
    """
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def _pos_cache_key(token_hash: str) -> str:
    """正缓存 key：``auth:mcptoken:{token_hash}``。"""
    return f"{_POS_CACHE_PREFIX}{token_hash}"


def _neg_cache_key(token_hash: str) -> str:
    """负缓存 key：``auth:mcptoken:neg:{token_hash}``。"""
    return f"{_NEG_CACHE_PREFIX}{token_hash}"


def _encode_principal(principal: McpTokenPrincipal) -> str:
    """正缓存 value：JSON({token_id, workspace_id, scope})。

    JSON 而非 ApiKeyService 的裸 user_id 字符串——McpToken 无关 user，命中正缓存时
    直接返 principal 不再查库（token 不可变，唯一失效途径 revoke 会精确 DEL 正缓存），
    故把 principal 全量塞进缓存 value。
    """
    return json.dumps(
        {
            "token_id": str(principal.token_id),
            "workspace_id": str(principal.workspace_id),
            "scope": list(principal.scope),
        }
    )


def _decode_principal(cached: str) -> McpTokenPrincipal | None:
    """解析正缓存 value；脏数据返 None（回退 DB 查表）。"""
    try:
        data = json.loads(cached)
        return McpTokenPrincipal(
            token_id=uuid.UUID(str(data["token_id"])),
            workspace_id=uuid.UUID(str(data["workspace_id"])),
            scope=[str(s) for s in data["scope"]],
        )
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        return None


class McpTokenService:
    """McpToken 签发 / 校验 / 吊销 + workspace 级 CRUD。"""

    def __init__(self, db: AsyncSession, *, settings: Settings) -> None:
        self._db = db
        self._settings = settings

    # ── Create / list / revoke ────────────────────────────────────────────

    async def create(
        self,
        *,
        workspace_id: uuid.UUID,
        name: str,
        scope: list[str],
        created_by: uuid.UUID | None,
    ) -> tuple[McpTokenORM, str]:
        """签发新 token。返回 ``(row, 明文)``——明文必须**立刻**返回给调用方，
        此后不可恢复（DB 只存 sha256）。"""
        plaintext = _generate_plaintext()
        row = McpTokenORM(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            name=name.strip(),
            token_hash=_token_hash(plaintext),
            scope=list(scope),
            created_by=created_by,
            created_at=_utc_now(),
            last_used_at=None,
            revoked_at=None,
        )
        self._db.add(row)
        await self._db.commit()
        await self._db.refresh(row)
        # R-06：token_hash 与明文均不入日志（只记 token_id / workspace / name）。
        log.info(
            "mcp_token.created",
            mcp_token_id=str(row.id),
            workspace_id=str(workspace_id),
            name=row.name,
        )
        return row, plaintext

    async def list_for_workspace(self, *, workspace_id: uuid.UUID) -> list[McpTokenORM]:
        """该 workspace 全部 token（含已吊销），新→旧。不返明文（明文从未持久化）。"""
        stmt = (
            select(McpTokenORM)
            .where(col(McpTokenORM.workspace_id) == workspace_id)
            .order_by(col(McpTokenORM.created_at).desc())
        )
        return list((await self._db.execute(stmt)).scalars().all())

    async def revoke(self, *, token_id: uuid.UUID, workspace_id: uuid.UUID) -> bool:
        """幂等吊销：``revoked_at = now``（WHERE id + workspace_id + revoked_at IS NULL）。

        返回 ``True`` 表示真的翻了一条；已吊销 / 不存在 / 跨 workspace 均返 ``False``
        （DELETE 端点据此统一 404）。

        P0 缓存一致性：revoke 后必须清该 token 的正缓存，否则被吊销 token 在缓存 TTL
        （默认 60s）内仍可认证（安全漏洞）。revoke 知 ``token_hash``（DB 直存 sha256），
        故精确单 key DEL（``auth:mcptoken:{token_hash}``），比 ApiKeyService 只知
        ``key_prefix`` 而需前缀 SCAN 更简单可靠。
        """
        now = _utc_now()
        # 先查 token_hash（用于精确清缓存），同时携带三个 WHERE 条件保证 idempotent 语义。
        token_hash = (
            await self._db.execute(
                select(McpTokenORM.token_hash)
                .where(col(McpTokenORM.id) == token_id)
                .where(col(McpTokenORM.workspace_id) == workspace_id)
                .where(col(McpTokenORM.revoked_at).is_(None))
            )
        ).scalar_one_or_none()
        if token_hash is None:
            return False

        result = await self._db.execute(
            update(McpTokenORM)
            .where(col(McpTokenORM.id) == token_id)
            .where(col(McpTokenORM.workspace_id) == workspace_id)
            .where(col(McpTokenORM.revoked_at).is_(None))
            .values(revoked_at=now)
        )
        rowcount = int(getattr(result, "rowcount", 0) or 0)
        if rowcount:
            await self._db.commit()
            await self._invalidate_cache(token_hash)
            log.info(
                "mcp_token.revoked",
                mcp_token_id=str(token_id),
                workspace_id=str(workspace_id),
            )
        return bool(rowcount)

    async def get_or_issue(
        self, *, workspace_id: uuid.UUID, created_by: uuid.UUID | None
    ) -> tuple[McpTokenORM, str]:
        """获取或签发 init 专用的 dispatch scope token（design §5.2 / §7.1 / D-001）。

        复用既有三件套（list_for_workspace / revoke / create）：
        1. 查该 workspace 所有 token，过滤 ``created_by`` 匹配且 ``revoked_at IS NULL``。
        2. 命中则吊销旧 token（避免堆积）。
        3. 签发新 token：``name='init-provisioned'``，``scope=['dispatch']``（execute 派
           Wave 子代理语义，必须取 MCP_SCOPES 合法值）。

        返回 ``(新 row, 明文)``——明文仅返回，不入日志（create 内已遵守 R-06）。

        Args:
            workspace_id: 工作区 ID。
            created_by: 签发者 ID（可为 None，与 create 签名对齐）。

        Returns:
            ``(新 token row, 明文)`` 元组。
        """
        from app.modules.mcp_gateway.auth import MCP_SCOPE_DISPATCH

        # 1) 查旧：过滤 created_by 匹配且未吊销
        existing = [
            row
            for row in await self.list_for_workspace(workspace_id=workspace_id)
            if row.created_by == created_by and row.revoked_at is None
        ]
        # 2) 吊销旧（命中则逐一 revoke；通常至多一条，因 get_or_issue 每次调用都吊旧签新）
        for old in existing:
            await self.revoke(token_id=old.id, workspace_id=workspace_id)
        # 3) 签新：scope 必须是 MCP_SCOPES 合法值（dispatch 对齐 execute 派子代理语义）
        return await self.create(
            workspace_id=workspace_id,
            created_by=created_by,
            name="init-provisioned",
            scope=[MCP_SCOPE_DISPATCH],
        )

    # ── Authenticate ──────────────────────────────────────────────────────

    async def authenticate(self, plaintext: str) -> McpTokenPrincipal | None:
        """解析明文 → :class:`McpTokenPrincipal`，或 ``None``（未知 / 已吊销 / 前缀错）。

        缓存策略（复用 ApiKeyService 模式，design §5.2 P2）：

        - 负缓存 ``auth:mcptoken:neg:{token_hash}``（TTL=
          ``auth_api_key_negative_cache_ttl``，默认 30s）：完全无匹配的明文秒回 None，
          防无效 token 探测穿透到 DB。
        - 正缓存 ``auth:mcptoken:{token_hash}``（TTL=``auth_api_key_cache_ttl``，默认
          60s）存 principal JSON。**命中后直接返不查库**——McpToken 不可变（workspace /
          scope 不变），唯一失效途径是 revoke，而 revoke 会精确 DEL 正缓存，故无需像
          ApiKeyService 那样在命中后回查 DB 校验 user 状态。
        - 未命中按 ``token_hash`` 唯一索引 O(1) 查 ``mcp_tokens`` 且 ``revoked_at IS
          NULL``；命中写正缓存 + 节流刷 ``last_used_at``，未命中写负缓存。
        - 所有缓存读写 try/except 降级：redis 不可用时回退直查 DB，认证永不因缓存层
          故障而失败。
        """
        if not plaintext or not plaintext.startswith(MCP_TOKEN_PREFIX):
            # 无前缀的输入（如误传 JWT）直接 return None，不查库也不缓存。
            return None

        digest = _token_hash(plaintext)

        # 负缓存：该明文最近完全无匹配 → 秒回 None
        if await self._cache_get(_neg_cache_key(digest)) == "1":
            return None

        # 正缓存：该明文最近认证成功 → 取 principal 直接返（不查库）
        cached = await self._cache_get(_pos_cache_key(digest))
        if cached:
            principal = _decode_principal(cached)
            if principal is not None:
                return principal
            # 缓存 value 脏（不该发生）→ 清掉，落 DB 兜底
            await self._cache_delete(_pos_cache_key(digest))

        # DB 查表：token_hash 唯一索引 O(1)（非 ApiKeyService 的 O(n) bcrypt 扫描）
        stmt = (
            select(McpTokenORM)
            .where(col(McpTokenORM.token_hash) == digest)
            .where(col(McpTokenORM.revoked_at).is_(None))
        )
        row = (await self._db.execute(stmt)).scalar_one_or_none()
        if row is None:
            # 完全无匹配 → 负缓存防探测
            await self._cache_set(
                _neg_cache_key(digest),
                "1",
                ttl=self._settings.auth_api_key_negative_cache_ttl,
            )
            return None

        principal = McpTokenPrincipal(
            token_id=row.id,
            workspace_id=row.workspace_id,
            scope=list(row.scope or []),
        )
        # 写正缓存（principal 全量入缓存 value，命中即返不查库）
        await self._cache_set(
            _pos_cache_key(digest),
            _encode_principal(principal),
            ttl=self._settings.auth_api_key_cache_ttl,
        )
        await self._mark_used(row)
        return principal

    # ── Cache helpers (best-effort; any Redis failure degrades to no-op) ──

    async def _cache_get(self, key: str) -> str | None:
        """Redis GET；任何故障 → 缓存 miss（返 None），回退 DB 路径。"""
        try:
            return await get_redis().get(key)
        except Exception as exc:  # 缓存层降级：任何 Redis 故障都回退原路径
            log.warning("mcp_token.cache_read_failed", key=key, error=str(exc))
            return None

    async def _cache_set(self, key: str, value: str, *, ttl: int) -> None:
        """Redis SET EX；``ttl <= 0`` 禁用。故障非致命。"""
        if ttl <= 0:
            return
        try:
            await get_redis().set(key, value, ex=ttl)
        except Exception as exc:  # 缓存层降级
            log.warning("mcp_token.cache_write_failed", key=key, error=str(exc))

    async def _cache_delete(self, key: str) -> None:
        try:
            await get_redis().delete(key)
        except Exception as exc:  # 缓存层降级
            log.warning("mcp_token.cache_delete_failed", key=key, error=str(exc))

    async def _invalidate_cache(self, token_hash: str) -> None:
        """revoke 路径精确清缓存。

        revoke 知 ``token_hash``（DB 直存 sha256），故精确 DEL 正缓存 key；同时清同
        digest 的负缓存 key（真实 token 正常不会有负缓存条目，DEL 是无害兜底，应对极
        少见的「先误判未匹配写负缓存、后 token 落库」竞态）。均为单 key DEL，非 SCAN。
        """
        await self._cache_delete(_pos_cache_key(token_hash))
        await self._cache_delete(_neg_cache_key(token_hash))

    async def _mark_used(self, row: McpTokenORM) -> None:
        """成功 authenticate 后节流刷 ``last_used_at``。

        复用 ``auth_api_key_last_used_throttle_seconds``（默认 60s）：存储值新于阈值则
        跳过 UPDATE。不节流则每请求 UPDATE 同一行 → 行锁串行化（生产雪崩：连接池耗尽）。
        ``last_used_at`` 仅供管理 UI 展示，秒级精度无业务价值，60s 节流可接受。阈值=0
        退化为每次都写。
        """
        now = _utc_now()
        last = row.last_used_at
        threshold = self._settings.auth_api_key_last_used_throttle_seconds
        if last is not None and (now - _as_utc(last)).total_seconds() < threshold:
            return
        row.last_used_at = now
        self._db.add(row)
        await self._db.commit()


# ════════════════════════════════════════════════════════════════════════════
# McpWebhook CRUD + WebhookDispatcher（design §7.3 / §8.2 / D-003@v1 / task-11）
# ════════════════════════════════════════════════════════════════════════════
#
# secret 加密存取说明（**与 task 蓝图的一处偏差，已在收尾汇报里说明**）：
# 蓝图 task-11 假设 mcp_webhooks 有独立 ``key_id`` 列；但 task-01 实际落的表
# （model.py + migration 20260806140000）只有单列 ``secret String(128)``，无
# ``key_id`` 列。constraints 又明确「表结构归 task-01 本 task 不动」。为同时满足
# 「加密存 + 可还原 + 不改表」，把 ``key_id`` 与密文一起编码进单列：
#   ``secret = "{key_id}:{hex(ciphertext)}"``
# hex 把 libsodium 二进制密文转成可逆 ASCII（String 列可存）；key_id 前缀让
# get_cipher().decrypt(ct, key_id) 能正确还原并支持将来 key rotation。明文绝不落
# 库 / 日志 / 响应（R 同 llm_provider 的 R-04）。


def _encode_secret(plaintext: str) -> str:
    """加密明文密钥 → 单列存储串 ``{key_id}:{hex(ciphertext)}``。"""
    ciphertext, key_id = get_cipher().encrypt(plaintext)
    return f"{key_id}:{ciphertext.hex()}"


def _decode_secret(stored: str) -> str:
    """从单列存储串还原明文密钥（仅投递器内部用，绝不入日志/响应）。"""
    key_id, _, hex_ct = stored.partition(":")
    return get_cipher().decrypt(bytes.fromhex(hex_ct), key_id)


# 指数退避序列（秒）：attempt 1 立即发；2-5 失败后 sleep 退避再重试（design §7.3）。
# 共最多 5 次（1 次首发 + 4 次退避重试）。
_RETRY_BACKOFF_SECONDS: tuple[float, ...] = (1.0, 4.0, 16.0, 64.0)
_MAX_ATTEMPTS = 1 + len(_RETRY_BACKOFF_SECONDS)  # 5
_OUTBOUND_TIMEOUT_SECONDS = 10.0


class McpWebhookNotFound(AppError):
    """DELETE 不存在的 webhook 或跨 workspace 越权 → 404（防存在性探测）。"""

    code = "HTTP_404_MCP_WEBHOOK_NOT_FOUND"
    http_status = 404


class McpWebhookService:
    """mcp_webhooks 的 workspace 级 CRUD（注册 / 列表 / 删除）。"""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def create(
        self,
        *,
        token_id: uuid.UUID,
        workspace_id: uuid.UUID,
        url: str,
        secret: str,
        events: list[str],
    ) -> McpWebhookORM:
        """注册 webhook：``secret`` 明文加密后入库（``_encode_secret``），绝不存明文。"""
        # SSRF：注册前校验回调 url（scheme 白名单 + 解析到公网，防 169.254.169.254 /
        # 127.0.0.1 / 内网）。非法抛 UnsafeRepoUrl/SsrfBlocked（400），由全局 handler 映射。
        await assert_public_url(url.strip())
        row = McpWebhookORM(
            id=uuid.uuid4(),
            token_id=token_id,
            workspace_id=workspace_id,
            url=url.strip(),
            secret=_encode_secret(secret),
            events=list(events),
            active=True,
            created_at=_utc_now(),
        )
        self._db.add(row)
        await self._db.commit()
        await self._db.refresh(row)
        # 明文 secret 绝不入日志（只记 id / workspace / url / events）。
        log.info(
            "mcp_webhook.created",
            mcp_webhook_id=str(row.id),
            workspace_id=str(workspace_id),
            url=row.url,
            events=list(row.events or []),
        )
        return row

    async def list_for_workspace(self, *, workspace_id: uuid.UUID) -> list[McpWebhookORM]:
        """该 workspace 全部 webhook（含 active=False），新→旧。响应层不返 secret。"""
        stmt = (
            select(McpWebhookORM)
            .where(col(McpWebhookORM.workspace_id) == workspace_id)
            .order_by(col(McpWebhookORM.created_at).desc())
        )
        return list((await self._db.execute(stmt)).scalars().all())

    async def delete(self, *, webhook_id: uuid.UUID, workspace_id: uuid.UUID) -> bool:
        """物理删除（WHERE id + workspace_id）。不存在 / 跨 workspace → False（→ 404）。

        删除后该 webhook 不再被 ``WebhookDispatcher.deliver`` 命中（acceptance 要求）。
        """
        result = await self._db.execute(
            delete(McpWebhookORM)
            .where(col(McpWebhookORM.id) == webhook_id)
            .where(col(McpWebhookORM.workspace_id) == workspace_id)
        )
        rowcount = int(getattr(result, "rowcount", 0) or 0)
        if rowcount:
            await self._db.commit()
            log.info(
                "mcp_webhook.deleted",
                mcp_webhook_id=str(webhook_id),
                workspace_id=str(workspace_id),
            )
        return bool(rowcount)


def _event_matches(subscribed: list[str], event: str) -> bool:
    """``events`` 过滤：订阅该事件名或 ``"*"`` 全订阅 → 命中。"""
    return "*" in subscribed or event in subscribed


class WebhookDispatcher:
    """worker 终态按 mcp_webhooks 配置异步投递（HMAC-SHA256 + 指数退避，不阻塞主流程）。

    ``deliver`` 查该 workspace active 且 events 匹配的 webhook，逐条
    ``asyncio.create_task`` 派发——**不 await 不阻塞调用方**（task-12 complete_lease
    钩子在主流程里调它，投递快慢绝不影响 lease 完成）。每条独立退避重试，失败
    best-effort（重试耗尽 structlog warn 不抛）。

    构造注入 ``session_factory``（零参 callable 返 AsyncSession context manager）而
    非单个 session：deliver 在调用方请求/session 之外异步跑，必须用独立短生命周期
    session 查库，避免持有已关闭的请求 session。生产传 ``get_session_factory``。
    """

    def __init__(self, session_factory: Any) -> None:
        self._session_factory = session_factory

    async def _matching_webhooks(
        self, *, workspace_id: uuid.UUID, event: str
    ) -> list[McpWebhookORM]:
        stmt = select(McpWebhookORM).where(
            col(McpWebhookORM.workspace_id) == workspace_id,
            col(McpWebhookORM.active).is_(True),
        )
        async with self._session_factory() as session:
            rows = list((await session.execute(stmt)).scalars().all())
        return [r for r in rows if _event_matches(list(r.events or []), event)]

    async def deliver(
        self,
        workspace_id: uuid.UUID,
        event: str,
        payload: dict[str, Any],
    ) -> int:
        """派发匹配 webhook 的异步投递任务，返回派发条数（不 await 投递本身）。

        ``payload`` 含 mission_id / worker_id / status / error_code 等；deliver 在此
        基础上补 ``event`` / ``workspace_id`` / ``timestamp`` 组成最终 body（design §7.3）。
        每条 body 用该 webhook 的 ``secret`` 明文（解密自库）做 HMAC-SHA256 写
        ``X-Signature`` header（hex）。返回即释放——投递在后台 task 里跑。
        """
        webhooks = await self._matching_webhooks(workspace_id=workspace_id, event=event)
        body_fields = {
            "event": event,
            "workspace_id": str(workspace_id),
            "timestamp": _utc_now().isoformat(),
            **payload,
        }
        body = json.dumps(body_fields, separators=(",", ":"), sort_keys=True).encode("utf-8")
        for wh in webhooks:
            secret_plain = _decode_secret(wh.secret)
            signature = hmac.new(secret_plain.encode("utf-8"), body, hashlib.sha256).hexdigest()
            task = asyncio.create_task(self._deliver_one(wh, body, signature))
            _deliver_tasks.add(task)
            task.add_done_callback(_deliver_tasks.discard)
        return len(webhooks)

    async def _deliver_one(self, webhook: McpWebhookORM, body: bytes, signature: str) -> None:
        """单条投递 + 指数退避（1s/4s/16s/64s，共最多 5 次）。任何失败不向上抛。

        - 2xx → 成功，不重试。
        - 5xx / 超时 / 连接错误 / 其它异常 → 退避后重试；4xx（非 2xx/5xx）视为对端
          明确拒绝，重试无意义，直接放弃记 warn。
        - 重试耗尽 → structlog warn，不抛（best-effort，绝不影响主流程）。
        """
        headers = {"X-Signature": signature, "Content-Type": "application/json"}
        last_error: str | None = None
        for attempt in range(1, _MAX_ATTEMPTS + 1):
            if attempt > 1:
                await asyncio.sleep(_RETRY_BACKOFF_SECONDS[attempt - 2])
            try:
                # SSRF 每跳查：防注册后 DNS 重绑定 / 解析变更绕过（design B2）。
                await assert_public_url(webhook.url)
                # trust_env=False：不继承宿主代理（对齐 finalizer/delegation 出站模式）。
                async with httpx.AsyncClient(
                    trust_env=False, timeout=_OUTBOUND_TIMEOUT_SECONDS
                ) as client:
                    resp = await client.post(webhook.url, content=body, headers=headers)
                if 200 <= resp.status_code < 300:
                    log.info(
                        "mcp_webhook.delivered",
                        mcp_webhook_id=str(webhook.id),
                        url=webhook.url,
                        attempt=attempt,
                        status_code=resp.status_code,
                    )
                    return
                if 500 <= resp.status_code < 600:
                    last_error = f"http_{resp.status_code}"
                    log.warning(
                        "mcp_webhook.deliver_retryable",
                        mcp_webhook_id=str(webhook.id),
                        url=webhook.url,
                        attempt=attempt,
                        status_code=resp.status_code,
                    )
                    continue
                # 4xx：对端明确拒绝，重试无意义 → 放弃
                log.warning(
                    "mcp_webhook.deliver_abandoned",
                    mcp_webhook_id=str(webhook.id),
                    url=webhook.url,
                    attempt=attempt,
                    status_code=resp.status_code,
                )
                return
            except (SsrfBlocked, UnsafeRepoUrl) as exc:
                # SSRF 命中：不重试（重试也不会变），best-effort 放弃，不影响主流程（R-06）。
                log.warning(
                    "mcp_webhook.deliver_ssrf_blocked",
                    mcp_webhook_id=str(webhook.id),
                    url=webhook.url,
                    error=f"{type(exc).__name__}: {exc}",
                )
                return
            except Exception as exc:  # 超时 / 连接错误 / 任何出站异常 → 退避重试
                last_error = f"{type(exc).__name__}: {exc}"
                log.warning(
                    "mcp_webhook.deliver_error",
                    mcp_webhook_id=str(webhook.id),
                    url=webhook.url,
                    attempt=attempt,
                    error=last_error,
                )
        # 重试耗尽：记 warn 不抛（投递失败绝不影响 lease 完成主流程）
        log.warning(
            "mcp_webhook.deliver_exhausted",
            mcp_webhook_id=str(webhook.id),
            url=webhook.url,
            attempts=_MAX_ATTEMPTS,
            last_error=last_error,
        )
