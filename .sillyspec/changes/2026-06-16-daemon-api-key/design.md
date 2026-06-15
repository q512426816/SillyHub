---
author: qinyi
created_at: 2026-06-16T12:00:00
---

# design — daemon-api-key

为 daemon 提供长期凭证（API Key），替代寿命只有 15 分钟的 access_token，解决 daemon 反复掉线问题。

## 1. 背景

现状：daemon 启动需要 Bearer token 鉴权，目前只能用 `/api/auth/login` 返回的 access_token（JWT，HS256，TTL=15 分钟）。daemon 进程长期运行，15 分钟后 token 过期，所有 `/api/daemon/*` 调用 401，runtime 在 UI 上变 offline。daemon 没有自动 refresh 机制（且即便加 refresh 也只是把过期问题从 15min 推到 refresh_ttl_days，仍不是真"长期"）。

需求：管理员可签发不会过期（或长期）的 API Key，daemon 用它长期运行；管理员可吊销；daemon CLI 支持新凭证。

## 2. 设计目标

- daemon 用一个永不过期（或长期）凭证运行，重启前不再掉线
- 管理员可在前端签发/吊销 API Key，明文只显示一次
- 复用现有 auth 模块的 bcrypt 持久化模式（与 `Session.refresh_token` 一致），最小改造
- 不破坏现有 access_token 流水（前端登录态完全不变）
- daemon 端 `--api-key` 与 `--token` 二选一，向后兼容

## 3. 非目标（YAGNI）

- ❌ API Key 独立 scope / RBAC（V1 继承 owner 权限）
- ❌ Key rotate 端点（吊销 + 重建即可）
- ❌ IP 白名单、UA 限制、调用频率限制
- ❌ Key 使用次数 / 调用统计详情（仅记录 last_used_at）
- ❌ JWT 黑名单 / refresh token 自动续期（与 API Key 解耦，不做）
- ❌ 多用户多组织场景（V1 仅 admin 个人签发）

## 4. 拆分判断

不拆分。3 个子模块（backend auth / daemon / 前端）服务同一目标，非独立交付。1 种角色，无跨页面审批流，不满足拆分阈值。

## 5. 总体方案

**凭证形式：Opaque random token + bcrypt hash**

plaintext = `shk_live_<secrets.token_urlsafe(32)>`（前缀 `shk_live_` 用于肉眼识别 + 防止跟其他 token 混淆）。后端存 `bcrypt(plaintext)`，明文不持久化，仅在创建时返回一次。鉴权时 O(n) 扫描所有未吊销 key，bcrypt.verify 比对——完全对齐现有 `Session.refresh_token` 模式（V1 规模 <1k key 性能可接受）。

**HTTP Header**：`X-API-Key: <plaintext>`。与 `Authorization: Bearer <jwt>` 区分，后端 dependency 同时支持两者，按 header 存在性优先尝试 JWT。

**寿命策略**：`expires_at: datetime | NULL`。NULL = 永不过期（daemon 主推）。authenticate 时 `expires_at < now` 视为无效。

**权限继承**：V1 简化，ApiKey 鉴权成功后返回的 User 就是 owner，沿用 owner 的所有 permission。不做独立 scope。

### 5.1 鉴权 dependency 分层

新增 `get_current_principal`（保留 `get_current_user` 不变，向后兼容）：

```
1. 取 Authorization header → 有 → 走 JWT 路径（get_current_user 既有逻辑）
2. 取 X-API-Key header → 有 → 走 ApiKey 路径（新逻辑）
3. 都没有 → AuthTokenMissing
```

daemon 调用的端点（`/api/daemon/*`、`/api/agent-runs/*`、`/api/workspaces/*/spec-bootstrap` 等）切到 `get_current_principal`。其他端点（用户面板）保持 `get_current_user`。

### 5.2 daemon CLI 改造

`start` 命令新增 `--api-key <plaintext>` 选项，与 `--token` 互斥（同时传报错）。两者至少一个必填。config.json 新增 `api_key: string | null` 字段持久化。

`HubClient` 构造从 `(serverUrl, token?)` 改为 `(serverUrl, { token?, apiKey? })`。`_headers()` 按存在性发出对应 header。

### 5.3 前端

新页 `/settings/api-keys`：签发弹窗、plaintext 单次显示、列表、吊销。`/runtimes` 页面 `CopyDaemonCommand` 默认用 `--api-key <latest_active_key>`，fallback `--token`。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `backend/app/modules/auth/api_key_model.py` | `ApiKey` SQLModel 表（拆出避免 model.py 膨胀；亦可加到 model.py，二选一，**最终放 model.py 减少 import**） |
| 修改 | `backend/app/modules/auth/model.py` | 追加 `ApiKey` 类（id/user_id/name/key_prefix/key_hash/last_used_at/expires_at/created_at/revoked_at） |
| 新增 | `backend/app/modules/auth/api_key_service.py` | `ApiKeyService`：create/list/revoke/authenticate |
| 新增 | `backend/app/modules/auth/api_key_schema.py` | `ApiKeyCreate/ApiKeyRead/ApiKeyCreated` Pydantic |
| 修改 | `backend/app/modules/auth/router.py` | 追加 POST/GET/DELETE `/api/auth/api-keys` 端点 |
| 修改 | `backend/app/core/auth_deps.py` | 新增 `_extract_api_key` + `get_current_principal` |
| 修改 | `backend/app/modules/daemon/router.py` | `Depends(get_current_user)` → `Depends(get_current_principal)` |
| 修改 | `backend/app/modules/agent/router.py` | 同上（`/api/agent-runs/*` 端点） |
| 修改 | `backend/app/modules/spec_workspace/router.py` | 同上（`/api/workspaces/*/spec-bootstrap`） |
| 新增 | `backend/migrations/versions/202606300900_add_api_keys.py` | Alembic 迁移，down_revision=202606290900 |
| 新增 | `backend/app/modules/auth/tests/test_api_key_service.py` | service 单测 |
| 新增 | `backend/app/modules/auth/tests/test_api_key_router.py` | router 单测 |
| 新增 | `backend/tests/core/test_auth_deps_principal.py` | dependency 双路径测试 |
| 修改 | `sillyhub-daemon/src/config.ts` | `DaemonConfig` 加 `api_key: string \| null` 字段 |
| 修改 | `sillyhub-daemon/src/cli.ts` | `start` 新增 `--api-key`，校验与 `--token` 互斥；config 持久化；`HubClient` 构造改为 options 对象 |
| 修改 | `sillyhub-daemon/src/hub-client.ts` | 构造签名 `(serverUrl, { token?, apiKey? })`；`_headers()` 按 token/apiKey 存在性发对应 header |
| 修改 | `sillyhub-daemon/src/daemon.ts` / `task-runner.ts` | 同步 HubClient 构造签名变更 |
| 新增 | `sillyhub-daemon/tests/cli.test.ts` | 补 `--api-key` 解析 + 互斥校验 |
| 修改 | `sillyhub-daemon/tests/hub-client.test.ts` | 补 X-API-Key header 测试 |
| 新增 | `frontend/src/app/(dashboard)/settings/api-keys/page.tsx` | 列表 + 签发 + 吊销 UI |
| 新增 | `frontend/src/components/api-key-create-dialog.tsx` | 签发弹窗 + plaintext 一次性显示 |
| 新增 | `frontend/src/lib/api-keys.ts` | API 客户端（createKey/listKeys/revokeKey） |
| 修改 | `frontend/src/app/(dashboard)/settings/page.tsx` 或 layout | 加 "API Keys" 导航 tab/链接 |
| 修改 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | `CopyDaemonCommand` 默认用 `--api-key`，fallback `--token` |
| 新增 | `backend/app/modules/auth/tests/test_api_key_lifecycle.py` | 端到端（create → use → revoke → 401） |

## 7. 接口定义

### 7.1 数据模型（SQLModel）

```python
# backend/app/modules/auth/model.py 追加
class ApiKey(BaseModel, table=True):
    __tablename__ = "api_keys"
    __table_args__ = (
        Index("ix_api_keys_user_revoked", "user_id", "revoked_at"),
        Index("ix_api_keys_prefix", "key_prefix"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, sa_column=Column(Uuid(as_uuid=True), primary_key=True))
    user_id: uuid.UUID = Field(sa_column=Column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False))
    name: str = Field(sa_column=Column(String(100), nullable=False))
    key_prefix: str = Field(sa_column=Column(String(16), nullable=False))  # plaintext[:12] 含 shk_live_ 前缀的可见部分
    key_hash: str = Field(sa_column=Column(String(255), nullable=False))   # bcrypt(plaintext)
    last_used_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    expires_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC), sa_column=Column(DateTime(timezone=True), nullable=False))
    revoked_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
```

### 7.2 ApiKeyService（auth/api_key_service.py）

```python
class ApiKeyService:
    def __init__(self, db: AsyncSession): ...

    async def create(self, *, user_id: uuid.UUID, name: str, expires_at: datetime | None) -> tuple[ApiKey, str]:
        """生成 plaintext=shk_live_<token_urlsafe(32)>，hash=password_hasher.hash(plaintext)，prefix=plaintext[:12]，返回 (row, plaintext)。"""

    async def list_for_user(self, *, user_id: uuid.UUID) -> list[ApiKey]:
        """列出 owner 的所有 key（含已吊销），按 created_at desc。"""

    async def revoke(self, *, api_key_id: uuid.UUID, user_id: uuid.UUID) -> None:
        """验证 owner 一致 → UPDATE revoked_at=now。owner 不匹配 → 404（不暴露存在性）。"""

    async def authenticate(self, *, plaintext: str) -> User | None:
        """O(n) 扫描所有 revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now)，
        bcrypt.verify 命中 → UPDATE last_used_at=now → 返回 owner User；否则 None。"""
```

### 7.3 Pydantic Schema

```python
class ApiKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    expires_at: datetime | None = None  # null = 永不过期

class ApiKeyRead(BaseModel):
    id: uuid.UUID
    name: str
    key_prefix: str
    last_used_at: datetime | None
    expires_at: datetime | None
    created_at: datetime
    revoked_at: datetime | None

class ApiKeyCreated(ApiKeyRead):
    plaintext: str  # 仅创建响应携带，永不再返回
```

### 7.4 HTTP 端点（auth/router.py 追加）

```
POST   /api/auth/api-keys          body: ApiKeyCreate  → 201 ApiKeyCreated
GET    /api/auth/api-keys          → 200 list[ApiKeyRead]
DELETE /api/auth/api-keys/{id}     → 204
```

权限：仅 admin 可访问（`require_platform_admin`）。

### 7.5 鉴权 dependency（core/auth_deps.py 追加）

```python
def _extract_api_key(request: Request) -> str | None:
    return request.headers.get("x-api-key") or request.headers.get("X-Api-Key")

async def get_current_principal(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> User:
    # 1. JWT 优先
    bearer = _extract_bearer(request)
    if bearer:
        return await get_current_user(request, session, settings)
    # 2. X-API-Key 回退
    api_key_plain = _extract_api_key(request)
    if not api_key_plain:
        raise AuthTokenMissing("Bearer token or API key is required.")
    svc = ApiKeyService(session)
    user = await svc.authenticate(plaintext=api_key_plain)
    if user is None:
        raise AuthTokenInvalid("API key is invalid, expired, or revoked.")
    return user
```

### 7.6 daemon HubClient 构造变更

```ts
// before
constructor(serverUrl: string, token?: string)

// after
constructor(
  serverUrl: string,
  options: { token?: string; apiKey?: string } = {},
)

// _headers()
const h: Record<string, string> = { 'Content-Type': 'application/json' };
if (this.apiKey) h['X-API-Key'] = this.apiKey;
else if (this.token) h['Authorization'] = `Bearer ${this.token}`;
return h;
```

## 8. 数据模型

新表 `api_keys`（见 §7.1）。无现有表结构变更。

## 9. 兼容策略

- **未配 API Key**：daemon 继续用 `--token`（access_token）启动，行为完全不变
- **现有 access_token 流水**：完全不变，前端登录态、refresh 机制不受影响
- **现有 daemon 端点鉴权**：从 `get_current_user` 切到 `get_current_principal`，JWT 路径走原逻辑，API Key 路径走新逻辑，对 JWT 用户透明
- **不改变的 API/表**：users / sessions / roles / user_workspace_roles / daemon_runtimes 表结构不变
- **回退路径**：若 API Key 机制出问题，admin 吊销所有 key + daemon 改回 `--token` 即可完全回滚

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | bcrypt.verify O(n) 在 key 量大时性能瓶颈 | P2 | V1 规模 <1k 可接受；将来加 `key_prefix` 索引短路（用户输 plaintext 即可 prefix lookup → O(1)），无需改 schema |
| R-02 | plaintext 创建后丢失无法找回 | P1 | UI 一次性显示 + 强警告"关闭后不再显示"；用户必须复制保存；丢失只能吊销重建 |
| R-03 | ApiKey 泄漏（如提交到 git）| P0 | UI 警告；前缀 `shk_live_` 便于 GitHub secret scanning 自定义规则；吊销即可 |
| R-04 | daemon 端 `--api-key` 与 `--token` 互斥误用 | P2 | CLI 双传时报错清晰提示；只传一个时优先 api_key |
| R-05 | last_used_at 每次请求 UPDATE 增加 DB 写负载 | P2 | V1 接受；若 hot，加 60s 内存节流（V1 不做） |
| R-06 | owner 被禁用后 ApiKey 仍可用 | P1 | authenticate 命中后检查 `user.deleted_at IS NULL AND status='active'`，否则返回 None |
| R-07 | 现有 daemon 端点切 dependency 引入回归 | P1 | `/api/daemon/*` 现有测试全部跑通；新增 dependency 双路径测试覆盖 |
| R-08 | expires_at 时区错误（UTC vs local）| P2 | 一律 UTC（对齐现有 Session.expires_at）；前端 UI 用 toLocaleString 显示 |

## 11. 自审

✅ **需求覆盖**：daemon 长期凭证 ✓、admin 签发/吊销 ✓、daemon CLI 改造 ✓、前端管理页面 ✓ —— 4/4 覆盖

✅ **约束一致性**：
- 后端：SQLModel + BaseModel 继承（对齐 CONVENTIONS §后端 §2 BaseModel 继承 + 审计钩子）✓
- Alembic 迁移命名 `202606300900_add_api_keys.py`（对齐现有 `202606290900_add_agent_runs_error_code` 风格）✓
- 前端：Next.js 14 App Router + Tailwind + shadcn/ui（对齐 CONVENTIONS §前端）✓
- daemon：commander + 函数式 config（对齐 cli.ts 现有 reverse-sync 决策）✓

✅ **真实性**：
- `get_current_user` / `password_hasher` / `generate_refresh_token` / `_extract_bearer` 均来自真实代码（`core/auth_deps.py`、`core/security.py`）✓
- HubClient 构造 `(serverUrl, token?)` 来自 `hub-client.ts:131` ✓
- 文件路径均来自 grep 结果 ✓

✅ **YAGNI**：rotate/IP 白名单/scope/统计 已显式列入非目标 ✓

✅ **验收标准**：每个端点、dependency 路径、daemon 选项都有可测试断言（见 §7 + 文件清单的测试文件）✓

✅ **非目标清晰**：第 3 节明确 6 条非目标 ✓

✅ **兼容策略**：第 9 节 5 条回退路径，含"未配 API Key 时行为不变" ✓

✅ **风险识别**：第 10 节 8 个风险，每个有等级 + 应对 ✓

⚠️ **自审存疑**：无
