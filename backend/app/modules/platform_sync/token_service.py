"""PlatformSyncToken use cases — issue / authenticate（workspace 级进度同步鉴权）。

Change 2026-08-11-change-progress-projection task-04 / design §5/§7 / D-001@v1。

与 ``mcp_gateway.McpTokenService`` 形似（shpsync_ 前缀 + sha256 直存 + hash O(1) 查表），
但**职责更窄**（task-04 constraints）：

- 进度同步是低频上行（每 change stage 推进一次，非每请求热路径），故**不复制 McpToken
  的 Redis 正/负缓存与 last_used_at 节流**——authenticate 直接查 DB，last_used_at 每次
  成功后简单 UPDATE（无并发热行风险）。
- 进度同步 token **绑 user**（created_by FK NOT NULL，authenticate 据此派生 User 作为
  上行归属），区别 McpToken 不绑 user（第三方编排者）。故 ``PlatformSyncTokenPrincipal``
  携带 ``User``（非 token_id+scope）。
- 三套前缀常量独立互不复用：``shpsync_``（本服务）/ ``shk_live_``（ApiKeyService）/
  ``shmcp_``（McpTokenService）。authenticate 先判前缀，不符直接 return None 不查库。
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.config import Settings
from app.core.logging import get_logger
from app.modules.auth.model import User
from app.modules.platform_sync.token_model import PlatformSyncTokenORM

log = get_logger(__name__)

# ``shpsync_`` 前缀（SillyHub Platform Sync）：GitHub secret scanning 自定义规则匹配 +
# UI 友好标签，与 shk_live_/shmcp_ 同思路。前缀不入单独列——authenticate 先判前缀，
# 明文无此前缀直接 return None（不查库）。
PLATFORM_SYNC_TOKEN_PREFIX = "shpsync_"


@dataclass(frozen=True, slots=True)
class PlatformSyncTokenPrincipal:
    """authenticate 成功结果，供 require_platform_sync 派生 ``(user, workspace_id)``。

    ``user`` 来自 token 行的 ``created_by`` FK 对应 users 行（design §7，进度上行归属
    用户）；``workspace_id`` 是 token 绑定的工作区（收件箱隔离键）；``token_id`` 供
    审计/日志关联（不含敏感值）。
    """

    user: User
    workspace_id: uuid.UUID
    token_id: uuid.UUID


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _generate_plaintext() -> str:
    """生成新 token 明文（``shpsync_`` + 32 随机字节 url-safe）。"""
    return PLATFORM_SYNC_TOKEN_PREFIX + secrets.token_urlsafe(32)


def _token_hash(plaintext: str) -> str:
    """sha256(明文) hex——入库唯一索引键。"""
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


class PlatformSyncTokenService:
    """platform_sync_tokens 签发 / 校验（无缓存层，低频路径直查 DB）。"""

    def __init__(self, db: AsyncSession, *, settings: Settings) -> None:
        self._db = db
        self._settings = settings

    async def get_or_issue(
        self,
        *,
        workspace_id: uuid.UUID,
        created_by: uuid.UUID,
    ) -> tuple[PlatformSyncTokenORM, str]:
        """获取或签发 token（按 design §5.2 §7.1）。

        语义：查同维度（workspace_id + created_by）旧未吊销 token → 命中则内联吊销
        → 签新返回 (新 row, 明文)。明文仅本次返回，调用方立即注入 payload 后丢弃，
        不写日志不落 lease.metadata（对齐 D-001 与 §9）。

        幂等性：单次调用非幂等（每次签新）；但同维度至多一条活 token，旧 token
        被吊销后 authenticate 返 None。重复 init 重复签新可接受：前端初始化按钮
        仅忙时禁用、已初始化后仍可重复触发（workspace-config-card busyReason），
        但旧 token 内联吊销 + init 第 5 步重写 local.yaml，用户侧恒单活 token；
        lease claim 单飞窗口防并发签发。
        """
        # 1) select 旧未吊销（workspace_id + created_by + revoked_at IS NULL）
        stmt = (
            select(PlatformSyncTokenORM)
            .where(col(PlatformSyncTokenORM.workspace_id) == workspace_id)
            .where(col(PlatformSyncTokenORM.created_by) == created_by)
            .where(col(PlatformSyncTokenORM.revoked_at).is_(None))
        )
        old_row = (await self._db.execute(stmt)).scalar_one_or_none()

        # 2) 命中则内联吊销（UPDATE revoked_at=now），不新增 public revoke 方法
        if old_row is not None:
            old_row.revoked_at = _utc_now()
            self._db.add(old_row)
            await self._db.commit()
            # 吊销不入日志（只记 token_id/workspace/name 不记明文，与 create 对齐）

        # 3) 签新（调既有 create，复用 _generate_plaintext 与 _token_hash）
        return await self.create(
            workspace_id=workspace_id,
            name="init-provisioned",
            created_by=created_by,
            scope=None,
        )

    async def create(
        self,
        *,
        workspace_id: uuid.UUID,
        name: str,
        created_by: uuid.UUID,
        scope: dict | None = None,
    ) -> tuple[PlatformSyncTokenORM, str]:
        """签发新 token。返回 ``(row, 明文)``——明文必须**立刻**返回给调用方，
        此后不可恢复（DB 只存 sha256）。"""
        plaintext = _generate_plaintext()
        row = PlatformSyncTokenORM(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            created_by=created_by,
            name=name.strip(),
            token_hash=_token_hash(plaintext),
            scope=scope,
            created_at=_utc_now(),
            last_used_at=None,
            revoked_at=None,
        )
        self._db.add(row)
        await self._db.commit()
        await self._db.refresh(row)
        # token_hash 与明文均不入日志（只记 token_id / workspace / name）。
        log.info(
            "platform_sync_token.created",
            platform_sync_token_id=str(row.id),
            workspace_id=str(workspace_id),
            name=row.name,
        )
        return row, plaintext

    async def authenticate(self, plaintext: str) -> PlatformSyncTokenPrincipal | None:
        """解析明文 → :class:`PlatformSyncTokenPrincipal`，或 ``None``。

        - 前缀非 ``shpsync_``（如误传 shk_live_/JWT）→ 直接 return None，不查库。
        - 按 ``token_hash`` 唯一索引 O(1) 查未吊销行（``revoked_at IS NULL``）。
        - 命中按 ``created_by`` FK 读 users 表派生 ``User``（design §7），刷 ``last_used_at``。
        - 未知 / 已吊销 / 前缀错 / created_by 用户不存在 → return None。

        无缓存层（进度同步低频，非热路径，task-04 constraints）；同一明文反复调用幂等
        读 DB，不引缓存。
        """
        if not plaintext or not plaintext.startswith(PLATFORM_SYNC_TOKEN_PREFIX):
            return None

        digest = _token_hash(plaintext)
        stmt = (
            select(PlatformSyncTokenORM)
            .where(col(PlatformSyncTokenORM.token_hash) == digest)
            .where(col(PlatformSyncTokenORM.revoked_at).is_(None))
        )
        row = (await self._db.execute(stmt)).scalar_one_or_none()
        if row is None:
            return None

        # 派生 User：created_by NOT NULL（task-01 constraints），但防御性处理用户行
        # 被删的极罕见场景（users 删则 token CASCADE 删，理论不发生，仍兜底返 None）。
        user = await self._db.get(User, row.created_by)
        if user is None:
            return None

        # 刷 last_used_at（无节流，低频路径无热行风险；独立事务避免污染读 session）。
        row.last_used_at = _utc_now()
        self._db.add(row)
        await self._db.commit()

        return PlatformSyncTokenPrincipal(
            user=user,
            workspace_id=row.workspace_id,
            token_id=row.id,
        )
