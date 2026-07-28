---
author: qinyi
created_at: 2026-07-27 17:42:00
scale: medium
revision: 2 (Design Grill B1/B2/B3/B6 修订)
---

# 设计文档 — auth refresh token 加编号索引（O(1) 查找根治 refresh 慢）

## 1. 背景与目标

生产监控抓到 `POST /api/auth/refresh` 慢请求 **1741ms**（>1s 触发 slow.request）。排查定位根因：refresh 流程 `_consume_refresh_token`（service.py:248）**遍历所有活跃 session 串行 bcrypt verify**——当前 66 个活跃 session（18 用户），每个 bcrypt cost-12 verify 250-400ms，匹配前扫几个累加出 1.7s。且 `_find_revoked_session`（service.py:316）grace/重放路径同样 `limit 50` 全扫。

根因是设计妥协：refresh_token 是不透明随机串（`secrets.token_urlsafe`，security.py:162），**不携带任何信息**，无法按 token 反查 session，只能全表 bcrypt 比对（代码注释 service.py:256-260 自认 V1 妥协）。

**目标**：给 refresh_token 加明文「编号」段，session 表存「编号指纹」唯一索引，refresh 时按指纹 O(1) 定位单条 session + 1 次 bcrypt 确认。**66 次串行 bcrypt → 1 次 bcrypt（~300ms）+ O(1) 索引查询**。

## 2. 现状（已核实，Grill 逐行复核为真）

- **token 生成**（security.py:162-176）：`generate_refresh_token()` = `secrets.token_urlsafe(32)`（不透明，返回 str）；`hash_refresh_token` = `password_hasher.hash`（bcrypt cost-12）；`verify_refresh_token` = `password_hasher.verify`。
- **Session 模型**（model.py:88-128）：`Session` 表，字段 `id/user_id/refresh_token_hash/revoked_at/expires_at/rotated_at/user_agent/ip/created_at`；`__table_args__ = (Index("ix_sessions_user_revoked", "user_id", "revoked_at"),)`。**无 token_id / jti 列**。
- **_issue_token_pair**（service.py:215-246）：`generate_refresh_token()` → `hash_refresh_token` → 建 SessionRow（refresh_token_hash）→ flush。
- **_consume_refresh_token**（service.py:248-314）：`select 活跃 session（revoked_at IS NULL AND expires_at > now）order by created_at desc` → 全量拉 → `for session: asyncio.to_thread(verify_refresh_token)` 串行，命中 break；未命中走 revoked 路径。**stmt 无 user_id 过滤**（token 不透明拿不到 user）。
- **_find_revoked_session**（service.py:316-331）：`select revoked session order by revoked_at desc limit 50` → 同样串行 bcrypt。
- **_mark_session_rotated/revoked**（service.py:333-349）：只改 revoked_at/rotated_at，**不动**。
- **refresh 上层**（service.py:112-128）：`_consume_refresh_token` → `_mark_session_rotated`（非 grace）→ `_issue_token_pair` → commit。grace 窗口 / FOR UPDATE 行锁（service.py:283-290）/ 复用吊销（service.py:307-312）逻辑**全保留**。
- **access token**（security.py:86-156）：JWT（HS256，带 sub/email/jti/exp），**本变更不动**。
- **generate_refresh_token 调用点全清单**（Grill B1 核实）：security.py:162 定义；service.py:228 `_issue_token_pair`；**`backend/tests/modules/auth/test_refresh_grace_window.py:87`** `hash_refresh_token(generate_refresh_token())`（既有绿测试，把返回当 str，改 tuple 必崩）。
- **partial-unique-index 既有范式**（Grill B2 核实）：`workspace/model.py:32-49` 用裸 Column + `__table_args__ Index(..., unique=True, postgresql_where=text(...), sqlite_where=text(...))` 双方言；全仓 `Column(unique=True, index=True)` 组合 0 命中。
- 数据规模（生产实测）：活跃 session 66（18 用户），总 session 3278。
- migration head：`202607270900`（`alembic heads` 实测单头，llm-provider 变更刚加）。**游离 `202608010900`**（down 指向老 revision，不在 head 链，pre-existing 仓库卫生问题，非本变更引入，接续不受影响——Grill B4）。
- **测试目录**（Grill B3 核实）：`backend/tests/modules/auth/`（`backend/app/modules/auth/tests/` 不存在）。

## 3. 决策记录

| ID | 决策 | 依据 |
|---|---|---|
| D-001 | 方案 A：refresh_token 加明文编号段 + session 表加编号指纹唯一索引 | 用户确认；O(1) 根治，安全双保险，改动适中 |
| D-002 | token 格式 `{token_id}.{secret}`：token_id=uuid4 hex 明文，secret=secrets.token_urlsafe(32) 随机 | token_id 明文供索引（HMAC 后存 DB），secret 是熵源；两段式易解析（split('.',1)） |
| D-003 | session 新增 `token_id_hmac` 列 = HMAC-SHA256(key, token_id)（hex），部分唯一索引（WHERE NOT NULL） | HMAC 防 DB 泄露暴露编号列表；部分唯一索引 O(1) 查找且 NULL 旧行不冲突；对齐 workspace 既有范式（B2） |
| D-004 | `refresh_token_hash`（bcrypt 整个 token）**仍存** | 双保险：HMAC 定位 + bcrypt 确认 secret 正确（HMAC 只验证 token_id 段，不验证 secret 段；bcrypt 验证完整 token 含 secret） |
| D-005 | HMAC key 复用 `settings.secret_key` | 已有密钥，不加新配置；secret_key 本就用于 JWT 签名，复用一致 |
| D-006 | 不兼容旧 token：旧格式（无 `.`）解析失败 → AuthTokenInvalid → 用户重新登录 | 项目未上线（规则 11），允许重置登录态；避免兼容旧 bcrypt 全表扫的退化路径 |
| D-007 | `_find_revoked_session`（grace/重放路径）同样按 token_id_hmac O(1) 查 | revoked session 也会被 refresh（grace 续期/重放检测），不能只优化 live 路径留 revoked 路径慢 |
| D-008 | migration 只加列 + 部分唯一索引，**不清表**；旧 session 的 token_id_hmac 留 NULL，自然失效 | 旧 session refresh 走新代码解析旧 token（无 `.`）→ AuthTokenInvalid → 401 → 前端跳登录；NULL 行不进部分唯一索引；运维可另行定期清过期 session 减 bloat（非本变更范围） |

## 4. 数据模型变更

`backend/app/modules/auth/model.py` `Session` 类新增列 + `__table_args__` 加部分唯一索引（**对齐 `workspace/model.py:32-49` 既有 partial-unique-index 范式**——裸 Column + `__table_args__ Index(unique=True, postgresql_where=, sqlite_where=)` 双方言；**不用** `Column(unique=True, index=True)`，Grill B2）：

```python
# 字段：裸 Column，不带 unique/index（索引在 __table_args__ 声明）
token_id_hmac: str | None = Field(
    default=None,
    sa_column=Column(String(64), nullable=True),
)

# __table_args__ 加部分唯一索引（与现有 ix_sessions_user_revoked 并列）
__table_args__ = (
    Index("ix_sessions_user_revoked", "user_id", "revoked_at"),  # 既有
    Index(
        "ux_sessions_token_id_hmac",
        "token_id_hmac",
        unique=True,
        postgresql_where=text("token_id_hmac IS NOT NULL"),
        sqlite_where=text("token_id_hmac IS NOT NULL"),
    ),
)
```
- `String(64)`：HMAC-SHA256 hex = 64 字符
- `nullable=True`：兼容旧 session 行（token_id_hmac NULL，D-008）
- 部分唯一索引 `WHERE token_id_hmac IS NOT NULL`：O(1) 查找（D-003）；NULL 行不参与唯一约束（旧行不冲突）；`postgresql_where` + `sqlite_where` 双方言保证 SQLite 测试（create_all）与 PG 生产（migration）索引形态一致（B2）

新 migration `202607271700`（接 head `202607270900`；游离 `202608010900` 不在 head 链，接续不受影响 B4）：
- up：`op.add_column("sessions", sa.Column("token_id_hmac", sa.String(length=64), nullable=True))` + `op.create_index("ux_sessions_token_id_hmac", "sessions", ["token_id_hmac"], unique=True, postgresql_where=sa.text("token_id_hmac IS NOT NULL"), sqlite_where=sa.text("token_id_hmac IS NOT NULL"))`
- down：`op.drop_index("ux_sessions_token_id_hmac", table_name="sessions")` + `op.drop_column("sessions", "token_id_hmac")`
- 双 `_where` 照 `workspace/model.py` 既有 migration 范式（PG/SQLite 都生成部分唯一索引）

## 5. 后端设计

### 5.1 token 格式与 helper（security.py）

新增/改写（Grill B6 补 import）：
```python
# security.py 顶部加 import
import hashlib
import hmac

def generate_refresh_token() -> tuple[str, str]:
    """Return (refresh_token, token_id). refresh_token = f"{token_id}.{secret}"."""
    token_id = uuid.uuid4().hex
    secret = secrets.token_urlsafe(32)
    return f"{token_id}.{secret}", token_id

def parse_refresh_token(token: str) -> tuple[str, str]:
    """Split '{token_id}.{secret}'; raise AuthTokenInvalid on malformed (no '.')."""
    if "." not in token:
        raise AuthTokenInvalid("Refresh token format is invalid.")
    token_id, secret = token.split(".", 1)
    if not token_id or not secret:
        raise AuthTokenInvalid("Refresh token format is invalid.")
    return token_id, secret

def hmac_token_id(token_id: str, settings: Settings) -> str:
    """HMAC-SHA256(secret_key, token_id) hex — DB 索引键（不可逆，防列表泄露）。"""
    return hmac.new(settings.secret_key.encode(), token_id.encode(), hashlib.sha256).hexdigest()
```
- `hash_refresh_token` / `verify_refresh_token` **不变**（仍对完整 `{token_id}.{secret}` 做 bcrypt，D-004 验证 secret 段）
- `generate_refresh_token` 返回值从 `str` 变 `tuple[str, str]`，**所有调用点同步改取 [0] token 串**（见下方清单）

**调用点全清单**（Grill B1，返回 str→tuple 必须同步改，否则崩既有绿测试）：
- `service.py:228 _issue_token_pair`：`refresh_token, token_id = generate_refresh_token()`（design §5.2）
- `backend/tests/modules/auth/test_refresh_grace_window.py:87`：`hash_refresh_token(generate_refresh_token()[0])`（既有绿测试，取 [0] token 串）

### 5.2 _issue_token_pair（service.py:215-246）

```python
# service.py import 块加（Grill B6）：from app.core.security import ..., parse_refresh_token, hmac_token_id
refresh_token, token_id = generate_refresh_token()
row = SessionRow(
    ...,
    refresh_token_hash=hash_refresh_token(refresh_token),
    token_id_hmac=hmac_token_id(token_id, self._settings),  # 新增
    ...
)
```

### 5.3 _consume_refresh_token（service.py:248-314）重写

```python
token_id, _secret = parse_refresh_token(refresh_token)  # 旧格式(无.) → AuthTokenInvalid → 401
target_hmac = hmac_token_id(token_id, self._settings)
# live 路径：部分唯一索引 O(1) 查找
session = (
    await self._db.execute(
        select(SessionRow)
        .where(col(SessionRow.token_id_hmac) == target_hmac)
        .where(col(SessionRow.revoked_at).is_(None))
        .where(col(SessionRow.expires_at) > _utc_now())
    )
).scalar_one_or_none()
if session is not None:
    # 单次 bcrypt 确认 secret 段（HMAC 只验 token_id 段定位，bcrypt 验完整 token 含 secret）
    if not await asyncio.to_thread(verify_refresh_token, refresh_token, session.refresh_token_hash):
        raise AuthTokenInvalid("Refresh token is not recognised.")  # HMAC 命中但 secret 不符（构造/碰撞，Grill B5 双层防御）
    user = await self._db.get(User, session.user_id)
    if user is None or user.deleted_at is not None or user.status != "active":
        raise AuthUserInactive(...)
    # FOR UPDATE 行锁（并发 rotate 防护，保留原逻辑 R2）
    locked = (await self._db.execute(
        select(SessionRow).where(col(SessionRow.id) == session.id).with_for_update()
    )).scalar_one_or_none()
    if locked is not None and locked.revoked_at is None:
        return user, locked, False
    # 锁期间被 rotate → 走 revoked 检测（grace/重放）
# live 未命中或锁后失效 → revoked 路径（grace 续期或重放吊销）
revoked = await self._find_revoked_session(refresh_token, target_hmac)
...  # grace/重放逻辑不变（D-007：_find_revoked 也按 token_id_hmac 查）
```

### 5.4 _find_revoked_session（service.py:316-331）重写

```python
async def _find_revoked_session(self, refresh_token: str, target_hmac: str) -> SessionRow | None:
    session = (
        await self._db.execute(
            select(SessionRow)
            .where(col(SessionRow.token_id_hmac) == target_hmac)
            .where(col(SessionRow.revoked_at).is_not(None))
        )
    ).scalar_one_or_none()
    if session is None:
        return None
    # 单次 bcrypt 确认 secret 段
    if await asyncio.to_thread(verify_refresh_token, refresh_token, session.refresh_token_hash):
        return session
    return None
```
- 签名加 `target_hmac` 参数（由 _consume 算好传入，避免重复算）
- 不再 `limit 50` 全扫，O(1) 唯一索引查

### 5.5 不变项（明确边界）

- **access token**（JWT，security.py:86-156）：不动
- **refresh 上层流程**（service.py:112-128）：`_consume → _mark_session_rotated → _issue → commit` 不变
- **grace 窗口**（service.py:301-306）、**FOR UPDATE 行锁**（service.py:283-290）、**复用吊销 revoke_all**（service.py:307-312）：逻辑全保留
- **_mark_session_rotated/revoked**（service.py:333-349）：不动
- **logout / change-password / login**：不动（login 调 _issue_token_pair 自动用新格式）

## 6. 测试策略

测试目录 `backend/tests/modules/auth/`（Grill B3，非 `app/modules/auth/tests/`）：
- **token 格式**：generate 返回 `(token, token_id)` 且 token = `{id}.{secret}` 可 split；parse 畸形（无 `.`/空段）抛 AuthTokenInvalid；hmac_token_id 确定性（同 id 同 key 同结果）
- **_issue_token_pair**：建 Session 含 token_id_hmac（非空、= hmac(token_id)）；refresh_token_hash 仍 bcrypt
- **_consume_refresh_token（live O(1)）**：mock session 带 token_id_hmac，refresh 正确 token → 命中单条 + bcrypt 通过；HMAC 命中但 secret 错（构造 token）→ AuthTokenInvalid（B5 双层防御）；旧格式 token（无 `.`）→ AuthTokenInvalid；token_id_hmac NULL 的旧 session → 不命中
- **_find_revoked_session（O(1)）**：revoked session 按 hmac 命中；secret 错不返回；无匹配返回 None
- **并发**：FOR UPDATE 行锁路径保留（锁期间被 rotate → revoked 检测）
- **既有绿测试适配**（Grill B1）：`test_refresh_grace_window.py:87` `generate_refresh_token()[0]` 取 token 串
- **migration**：`alembic upgrade head` 单头 `202607271700`；down 可逆；旧行 token_id_hmac NULL 不违反部分唯一索引（双 where）
- 性能断言（可选）：refresh 不再遍历多 session（mock 100 活跃 session，refresh 仍 O(1)，断言 verify_refresh_token 只调 1 次）

## 7. 风险与边界

- **token 格式解析**（D-002）：split('.',1) 处理畸形输入（无 `.`/空段）→ AuthTokenInvalid，不崩
- **HMAC key 轮换**（D-005）：复用 secret_key，若轮换则所有 token 失效（用户重登）——secret_key 本就不该运行时变，可接受
- **唯一索引冲突**（D-003）：token_id uuid4 hex 冲突概率 ~0；冲突时 flush 报 IntegrityError（极低概率，运维兜底）
- **旧 session 失效**（D-006/D-008）：部署后所有旧 refresh token 失效（401），前端跳登录页重新登录。access token（JWT）不受影响（15 分钟内仍有效）。**部署时机提示用户重登**
- **部分唯一索引方言**（§4/B2）：PG/SQLite 双 `_where` 保证索引形态一致；workspace 既有范式已验证可行
- **bcrypt 仍存**（D-004/B5）：HMAC 只验 token_id 段定位，bcrypt 验完整 token（含 secret）确认——双层防御。攻击者构造 `{已知token_id}.{任意secret}`：HMAC 命中→bcrypt 对比任意 secret≠真 secret→False→AuthTokenInvalid，无法绕过。残余风险：HMAC 命中（~300ms bcrypt）vs 未命中（微秒）的时序差可探测 live session 存在性，但 token_id=uuid4 不可枚举，残余风险极低（Grill B5）
- **migration 游离片段**（B4）：`202608010900` down 指向老 revision 不在 head 链，pre-existing 仓库卫生问题；本变更接续 `202607270900`（head）不受影响

## 8. 生命周期契约（豁免声明）

本变更**不涉及生命周期状态机**，无需生命周期契约表。理由：
- 不改 Session 的状态字段或流转（revoked_at/expires_at/rotated_at 语义不变；live/revoked/grace/重放 四态判定不变）
- 不改 AgentRun/AgentSession/DaemonTaskLease 状态机
- refresh 是无状态查询-更新（读 session → rotate → 签发新对），不引入新状态或事件
- token 格式是数据表示变更（opaque → {id}.{secret}），不改认证/会话生命周期

故豁免生命周期契约表要求。

## 9. 文件变更清单

逐文件显式清单（assess 按精确路径校验）：

**backend**
- `backend/app/core/security.py`（generate_refresh_token 改返回 tuple + 新增 parse_refresh_token/hmac_token_id + import hmac/hashlib）
- `backend/app/modules/auth/model.py`（Session 加 token_id_hmac 列 + __table_args__ 加部分唯一索引 ux_sessions_token_id_hmac，对齐 workspace 范式）
- `backend/app/modules/auth/service.py`（_issue_token_pair 改取 tuple + _consume_refresh_token/_find_revoked_session 重写 O(1) + import parse_refresh_token/hmac_token_id）
- `backend/migrations/versions/202607271700_add_session_token_id_hmac.py`（新建 migration：加列 + 部分唯一索引双 where）
- `backend/tests/modules/auth/test_refresh_grace_window.py`（Grill B1：generate_refresh_token()[0] 适配 tuple 返回）
- `backend/tests/modules/auth/`（新增 token 格式 + O(1) 查找 + migration 测试，路径修正 B3）

> 不改 router.py（端点签名不变）、不改 login/logout/change-password（复用 _issue/_consume 自动获益）、不改 access token（JWT）。

## 10. 自审

Design Grill（独立子代理审查，docHash 95ee7202...）发现 2 P1 + 4 P2，revision 2 全部修订：
- B1（generate_refresh_token str→tuple 漏改 test_refresh_grace_window.py:87）→ §5.1 调用点全清单 + §9 加该测试文件 + §6 适配说明。
- B2（Column(unique,index) 偏离 workspace partial-unique-index 范式）→ §4 改裸 Column + __table_args__ Index 双 where，migration 对齐。
- B3（测试路径 app/modules/auth/tests/ 不存在）→ §6/§9 改 backend/tests/modules/auth/。
- B4（migration 游离 202608010900）→ §2/§4/§7 备注 pre-existing 非本变更引入。
- B5（HMAC 命中时序差残余风险）→ §7 明确双层防御 + 残余风险极低。
- B6（漏标 import）→ §5.1/§5.2 补 hmac/hashlib + parse_refresh_token/hmac_token_id import。

- **方案唯一性**：方案 A（编号+HMAC）vs B（refresh 改 JWT，信息泄露）vs C（Redis 缓存，治标）。选 A：O(1) 根治 + 安全（HMAC 不泄露编号 + bcrypt 验 secret）+ 无额外依赖。用户确认。
- **双层防御必要性**（Grill B5 复核）：HMAC(token_id) O(1) 定位 + bcrypt(完整 token) 验 secret。去掉 bcrypt 则 DB 泄露 HMAC 列 + 猜中 token_id 可伪造（虽难），bcrypt 是纵深防御且本已存在，保留零成本。
- **不兼容的合理性**：项目未上线（规则 11），旧 session 失效仅要求用户重登一次，远优于维护「旧 token 走全表扫」退化路径。
- 已核实为真的断言（Grill 逐行复核）：security.py:162 generate_refresh_token 返回 str / model.py Session 无 token_id 列 / service.py:248 _consume 全表扫 / service.py:316 _find_revoked limit 50 / migration head 202607270900 / workspace/model.py:32-49 partial-unique-index 范式 / test_refresh_grace_window.py:87 调用点。
