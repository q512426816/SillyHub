<!-- author: WhaleFall -->
<!-- created_at: 2026-07-15T11:02:22 -->

# design：用户自助修改密码（2026-07-15-change-password）

## 1. 背景与目标

系统此前**只有管理员重置别人密码**（`POST /api/admin/users/{id}/reset-password` → `UserService.reset_password`），用户自己无法改密码。`auth` 模块现有端点：`login / refresh / logout / me / api-keys`，无 change-password。

ql-20260715-002-9c5b 把新建用户改成固定默认密码 `SillyHub@123`，形成闭环缺口：用户拿到默认密码登录后无法自助改密，只能找管理员重置。

**目标**：登录用户可在「个人中心」自助修改自己密码（旧密码验证 + 新密码 + 确认），改密成功后保留当前会话、撤销其他设备会话。补齐默认密码方案的闭环。

## 2. 需求范围（FR）

- **FR-01**：后端新增 `POST /api/auth/change-password`，已认证用户（`Depends(get_current_user)`）提交 `old_password` + `new_password` 修改自己的密码。
- **FR-02**：必须校验旧密码（`password_hasher.verify` 通过才允许改），失败返回 `401 PASSWORD_INCORRECT`。
- **FR-03**：新密码 `min_length=8`（与 `UserCreateRequest.password` 对齐）；不满足返回 `422`。
- **FR-04**：改密成功后撤销该用户**全部 session**（复用 `AuthService.revoke_all_user_sessions`）；当前 access_token 为无状态 JWT，30min 内仍有效（=保留当前会话），其他设备 refresh 立即失效（=撤销其他）。
- **FR-05**：改密记审计 `AuditLog(action="user.password_change")`。
- **FR-06**：前端新建个人中心页 `/account`，含 antd Form 修改密码表单（旧密码 / 新密码 / 确认新密码）。
- **FR-07**：前端表单校验：新密码 ≥8、新密码 = 确认密码；提交成功提示「密码已修改，其他设备需重新登录」。
- **FR-08**：顶栏头像下拉菜单新增「个人中心」入口 → 跳 `/account`。

## 3. 非目标（YAGNI）

- **不做**「默认密码 / 重置后首次登录强制改密码」（用户确认 YAGNI，仅靠默认密码提示文案引导）。
- **不做**密码强度等级（大小写+数字+符号强制），仅 `min_length=8`。
- **不做**新密码禁止与旧密码相同的强制校验（用户可改成相同密码，只要 ≥8 位）。
- **不做**改密速率限制（已认证 + 旧密码校验，暴力场景有限）。
- **不做**密码修改历史记录 / 不可复用最近 N 个旧密码。

## 4. 设计决策

### D-001@v1：旧密码错误返回 401 PASSWORD_INCORRECT
- type: boundary
- status: accepted
- source: code（对齐 `AuthInvalidCredentials` 401 模式）
- question: 旧密码校验失败返回什么？
- answer: 新增 AppError 子类 `PasswordIncorrect`（code=`HTTP_401_PASSWORD_INCORRECT`, http_status=401），不复用 `AuthInvalidCredentials`（语义是登录失败）。
- normalized_requirement: `verify(old, hash)` 失败 → 抛 `PasswordIncorrect` → 全局异常处理器转 401。
- impacts: [FR-02, task-后端-errors]
- evidence: `backend/app/core/errors.py`（AppError 子类模式：类属性 code+http_status）；`auth/service.py:88`（login 的 verify 失败抛 AuthInvalidCredentials）
- priority: high

### D-002@v1：后端 body 只收 old_password + new_password
- type: boundary
- status: accepted
- source: architecture
- question: 是否后端也收 confirm_password？
- answer: 否。confirm_password 是前端 UX（防输错），后端 `ChangePasswordRequest` 只有 `old_password` + `new_password`。
- normalized_requirement: `ChangePasswordRequest{old_password:str, new_password:str(min_length=8)}`。
- impacts: [FR-01, FR-03, task-后端-schema]
- evidence: 方案 A 确认
- priority: high

### D-003@v1：新密码规则 = min_length=8，允许新=旧
- type: term
- status: accepted
- source: user
- question: 新密码强度规则？是否禁止新=旧？
- answer: `min_length=8`（对齐 `UserCreateRequest.password`）；允许新密码与旧密码相同（不额外约束）。
- normalized_requirement: `new_password: str = Field(min_length=8)`；不查「新=旧」。
- impacts: [FR-03]
- evidence: 用户 step6 答复「至少 8 位」
- priority: medium

### D-004@v1：撤销全部 session 实现保留当前+撤销其他
- type: architecture
- status: accepted
- source: code
- question: 「保留当前会话、撤销其他」如何实现？
- answer: 撤销该用户全部 session（`UPDATE session SET revoked_at=now WHERE user_id=:uid AND revoked_at IS NULL`）。**不**直接调 `AuthService.revoke_all_user_sessions`——该方法在 `auth/service.py:149` 内部自带 commit，会提前提交 `password_hash` 改动，破坏 password+session+audit 的原子性（若后续 AuditLog 失败则部分成功）。改为在 `change_password` 内执行一条**不 commit** 的 UPDATE（参考 `admin/users_service.py:66 _revoke_sessions` 的 execute-only 模式），与密码更新 + AuditLog 一起在末尾统一 commit。当前请求的 access_token 是无状态 JWT（默认 `auth_access_ttl_minutes=30`），30min 内仍有效 = 保留当前会话；其他设备的 refresh token 立即失效 = 撤销其他。
- normalized_requirement: `change_password` 内执行「撤销全部 session 的 UPDATE（不 commit）」+ `flush` + `add AuditLog`，末尾一次性 `commit`，三者原子。
- impacts: [FR-04, FR-05, task-后端-service]
- evidence: `auth/service.py:140-149`（revoke_all_user_sessions 内部 commit）；`admin/users_service.py:66-72`（_revoke_sessions execute-only 不 commit 模式）；`core/security.py:96` + `core/config.py:60`（access_token 30min 无状态）
- priority: high
- 风险: 当前会话仅保留 access_token 有效期内（≤30min）；超时后需重新登录。用户已接受（方案 A trade-off）。

### D-005@v1：记审计 user.password_change
- type: boundary
- status: accepted
- source: code
- question: 改密是否记审计？
- answer: 记 `AuditLog(action="user.password_change", actor_id=user.id, resource_type="user", resource_id=user.id)`，对齐 `reset_password` 的 `user.password_reset` 模式。
- normalized_requirement: change_password 成功后写一条 AuditLog，actor=自己。
- impacts: [FR-05, task-后端-service]
- evidence: `admin/users_service.py:718-729`（reset_password 的 AuditLog 写法）
- priority: medium

### D-006@v1：已认证即可改，login_enabled 不阻断
- type: boundary
- status: accepted
- source: architecture
- question: login_enabled=false 的用户能否改密？
- answer: 端点仅依赖 `get_current_user`（access_token 有效即通过），不检查 login_enabled。边缘场景（被禁登录但仍有有效 access_token）允许改密，行为符合「已认证用户的自服务」。
- normalized_requirement: 端点依赖 `get_current_user`，无额外权限/状态校验。
- impacts: [FR-01]
- evidence: `core/auth_deps.py:56`（get_current_user）
- priority: low

## 5. 技术方案

### 5.1 后端（auth 模块）

**新增 schema** — `backend/app/modules/auth/schema.py`：
```python
class ChangePasswordRequest(BaseModel):
    """Body of ``POST /api/auth/change-password``."""
    model_config = ConfigDict(extra="forbid")
    old_password: str
    new_password: str = Field(min_length=8)
```
并在 `__all__` 导出。

**新增 AppError 子类** — `backend/app/core/errors.py`：
```python
class PasswordIncorrect(AppError):
    code = "HTTP_401_PASSWORD_INCORRECT"
    http_status = status.HTTP_401_UNAUTHORIZED
```
（沿用既有 AppError 子类的「类属性 code+http_status」模式，见 errors.py 各 Workspace*/Auth* 子类。）并在 errors.py 导出区加入。

**新增 service 方法** — `backend/app/modules/auth/service.py` `AuthService`：
```python
async def change_password(self, *, user_id: uuid.UUID, old_password: str, new_password: str) -> None:
    user = await self._db.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise AuthUserInactive("User not found.")  # 复用既有错误或专用 NotFound
    if not password_hasher.verify(old_password, user.password_hash):
        raise PasswordIncorrect("旧密码错误。")
    user.password_hash = password_hasher.hash(new_password)
    user.updated_at = _utc_now()
    # 撤销全部 session（execute-only，不单独 commit，D-004：
    # 与密码更新+审计一起在末尾原子提交，避免 revoke_all_user_sessions
    # 内部 commit 破坏事务）
    now = _utc_now()
    await self._db.execute(
        update(SessionRow)
        .where(col(SessionRow.user_id) == user_id)
        .where(col(SessionRow.revoked_at).is_(None))
        .values(revoked_at=now)
    )
    await self._db.flush()
    # 审计 D-005
    self._db.add(AuditLog(
        id=uuid.uuid4(), workspace_id=None, actor_id=user_id,
        action="user.password_change", resource_type="user",
        resource_id=user_id,
        details_json=json.dumps({"changed_self": True}, ensure_ascii=False),
        timestamp=now,
    ))
    await self._db.commit()
    log.info("auth.password_change", user_id=str(user_id))
```
- 复用：`password_hasher`（构造时已 `configure`）、`_utc_now`（已有）、`update`/`col`（service.py 已 import）、`SessionRow`（service.py 已 import）。**不**复用 `revoke_all_user_sessions`（其内部 commit 破坏原子性，见 D-004）。
- `AuditLog` 从 `app.modules.workflow.model` 导入（参考 `admin/users_service.py:41`）。
- `json` 模块按需 import。

**新增端点** — `backend/app/modules/auth/router.py`：
```python
@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    payload: ChangePasswordRequest,
    user: Annotated[User, Depends(get_current_user)],
    session: SessionDep,
    settings: SettingsDep,
) -> None:
    await AuthService(session, settings=settings).change_password(
        user_id=user.id, old_password=payload.old_password, new_password=payload.new_password,
    )
```
- 风格对齐既有 `/login` 端点（`SessionDep`/`SettingsDep`/`AuthService(session, settings=settings)`）。
- response：204 No Content（无响应体）。`ChangePasswordRequest` 加入 router 的 schema import。

**错误处理**：`PasswordIncorrect` 经全局异常处理器（既有，处理所有 AppError 子类）转 401 JSON envelope；`new_password <8` 由 Pydantic schema 转 422。无需新增异常处理代码。

### 5.2 前端

**新增个人中心页** — `frontend/src/app/(dashboard)/account/page.tsx`（新增）：
- antd `Form` + `Form.Item`（rules: required / min 8 / 新=确认），三个 `Input.Password`：旧密码 / 新密码 / 确认新密码。
- 提交调 `changePassword(old, new)`；成功 `message.success("密码已修改，其他设备需重新登录")` 并重置表单；失败（401 旧密码错）`Form.Item` 校验态 + 错误文案。
- 样式参考 CLAUDE.md 规则 17 前端样式系统（卡片式表单，对齐 `(dashboard)/settings/*` 页风格）。

**新增 API 函数** — `frontend/src/lib/auth.ts`：
```ts
export async function changePassword(oldPassword: string, newPassword: string) {
  await apiFetch("/api/auth/change-password", {
    method: "POST",
    json: { old_password: oldPassword, new_password: newPassword },
  });
}
```
（风格对齐 `login()`：`apiFetch(url, { method, json })`。）

**类型同步**：`frontend/src/lib/api-types.ts` 由 `scripts/gen-api-types.mjs` 从后端 OpenAPI 自动生成——后端 schema/端点落地后，execute 阶段重新生成 api-types（新增 `ChangePasswordRequest` 类型自动出现）。无需手写类型。

**顶栏入口** — `frontend/src/components/top-bar.tsx`（既有，含用户头像下拉）：
- 在用户下拉菜单加「个人中心」项（lucide `UserRound` / `CircleUser` 图标），`href="/account"`。
- 「修改密码」可复用同一下拉项跳 `/account`（锚定表单）或直接跳 `/account`，避免重复入口；设计上「个人中心」一项即可，后续可在个人中心页扩展更多账户信息。

**路由白名单**：`(dashboard)/layout` 若有路由守卫/白名单（参考 `layout.test.tsx` 对 `/admin/users` 的白名单断言），需把 `/account` 加入白名单。execute 阶段确认。

## 6. 数据 / 契约变更

- **无数据库迁移**：复用 `User.password_hash` 字段（既有），不新增表/字段。
- **新增 API 契约**：`POST /api/auth/change-password`（请求 `ChangePasswordRequest`，响应 204）。
- **OpenAPI**：端点自动出现在 OpenAPI schema → `gen-api-types.mjs` 生成前端类型。

## 6.5 生命周期契约表

本变更涉及 `Session`（auth 模块）的状态转换，给出事件×状态矩阵。本变更**不新增 session 状态**，仅新增一个撤销触发事件（change-password）。

**Session 状态定义**（既有，`auth/model.py`）：
- `active`：`revoked_at IS NULL`，refresh token 可用
- `revoked`：`revoked_at` 已置位，refresh token 失效

**关键字段**：`Session.id` / `Session.user_id` / `Session.refresh_token_hash`（bcrypt）/ `Session.revoked_at`（DateTime｜None）/ `Session.expires_at`。

**事件×状态转换矩阵**：

| 事件 \ 当前状态 | active | revoked |
|---|---|---|
| login（既有） | （创建新 active session，不动既有） | （创建新 active session） |
| refresh（既有） | active→revoked（旧 session 撤销）+ 签发新 active | 视为 reuse-attack → 撤销该用户全部 active |
| logout（既有） | active→revoked（幂等） | 幂等无变化 |
| reuse-attack 检测（既有） | 该用户全部 active→revoked | — |
| **change-password（本变更新增事件）** | **该用户全部 active→revoked**（execute-only UPDATE） | 幂等无变化 |

**本变更新增事件的契约**：
- 触发：`AuthService.change_password` 旧密码 verify 通过 + 新密码 hash 落库成功后。
- 动作：`UPDATE session SET revoked_at=now WHERE user_id=:uid AND revoked_at IS NULL`（撤销该用户全部 active session，不区分当前/其他）。
- 对当前会话的影响：当前请求的 access_token 是**无状态 JWT**（不绑 session），撤销 session 不影响已签发的 access_token，故当前会话在 `auth_access_ttl_minutes`（默认 30min）内仍可用；其他设备 refresh 时命中 revoked session → 失效下线。
- 原子性：该 UPDATE 与 `password_hash` 更新、`AuditLog` 写入在同一事务，末尾统一 commit（D-004 / X-001 修正）。

> `AuditLog` 为不可变追加日志（无生命周期）；`User.password_hash` 为字段原地更新（无状态机），不纳入本表。

## 7. 错误处理

| 场景 | HTTP | code | 处理 |
|---|---|---|---|
| 旧密码错误 | 401 | `HTTP_401_PASSWORD_INCORRECT` | 前端表单旧密码字段标红 + 文案「旧密码错误」 |
| 新密码 <8 位 | 422 | （Pydantic 默认） | schema 层拦截，前端 min 8 校验兜底 |
| 未认证 | 401 | （get_current_user） | 前端 401 拦截跳登录 |
| 改密成功 | 204 | — | 前端 success 提示 + 当前会话保留 |

## 8. 审计

`AuditLog(action="user.password_change", actor_id=<self>, resource_type="user", resource_id=<self>, details_json={"changed_self":true})`。对齐 `user.password_reset`（管理员重置）语义，区分「自己改」vs「被重置」。

## 9. 验收标准（AC）

- **AC-01**：`POST /api/auth/change-password` 带正确 access_token + 正确旧密码 + 合法新密码 → 204，DB 中 `User.password_hash` 已更新。
- **AC-02**：旧密码错误 → 401 `HTTP_401_PASSWORD_INCORRECT`。
- **AC-03**：新密码 <8 位 → 422。
- **AC-04**：未带 token → 401。
- **AC-05**：改密成功后，用**旧密码**登录 → 401（密码已变）。
- **AC-06**：改密成功后，该用户其他设备持有的 refresh token 刷新 → 失败（session 已撤销）；当前 access_token 在 30min 内仍可用。
- **AC-07**：审计表新增 `action="user.password_change"` 记录，actor=自己。
- **AC-08**：前端 `/account` 页表单校验（新密码≥8、新=确认）+ 提交成功提示 + 旧密码错误展示。
- **AC-09**：顶栏头像下拉有「个人中心」入口，点击跳 `/account`。

## 10. 风险与对策

- **R-001**：当前会话仅保留 access_token 有效期内（≤30min），超时需重新登录。用户已接受（方案 A trade-off）。若后续要长期保留，升级方案 B（重新签发当前 token pair），记为 superseded D-004@v2。
- **R-002**：未做强制改密码，默认密码用户可不改密。对策：默认密码提示文案引导（ql-20260715-002 已加）；后续可按需追加强制改密码功能。
- **R-003**：`change_password` 中 revoke + audit + commit 需在同一事务，失败回滚。对策：service 方法内统一 commit，异常自动回滚。
- **R-004**：前端 api-types 需重新生成，否则类型缺失。对策：execute 阶段固定跑 `gen-api-types.mjs`。

## 11. 模块影响

| 模块 | 改动 |
|---|---|
| **auth**（主） | service 新增 `change_password` + router 新增端点 + schema 新增 `ChangePasswordRequest` |
| **core** | `errors.py` 新增 `PasswordIncorrect`（复用 password_hasher，不改 security） |
| **workflow** | 复用 `AuditLog` model（不改） |
| **frontend_app** | 新增 `(dashboard)/account/page.tsx` |
| **frontend_components** | `top-bar.tsx` 用户下拉加「个人中心」入口 |
| **frontend_lib** | `auth.ts` 新增 `changePassword`；`api-types.ts` 自动重新生成 |

## 12. 兼容与回退

- 纯新增端点 + 页面，不改既有 login/refresh/logout 行为，**无破坏性**。
- 回退：删除端点 + service 方法 + 前端页面/入口即可，无数据迁移。
- brownfield：项目未上线（CLAUDE.md 规则 11），不要求历史兼容。

## 13. 文件变更清单

### 后端（修改/新增）
- `backend/app/core/errors.py`（修改：新增 `PasswordIncorrect` 子类 + 导出）
- `backend/app/modules/auth/schema.py`（修改：新增 `ChangePasswordRequest` + `__all__` 导出）
- `backend/app/modules/auth/service.py`（修改：`AuthService.change_password` 方法 + AuditLog/json import）
- `backend/app/modules/auth/router.py`（修改：`POST /change-password` 端点 + schema import）
- `backend/tests/modules/auth/test_change_password.py`（新增：覆盖 AC-01~07）
- `backend/openapi.json`（自动重新生成：`scripts/dump_openapi.py` 经 `gen-api-types` 刷新，含新端点 `ChangePasswordRequest` schema）

### 前端（修改/新增）
- `frontend/src/app/(dashboard)/account/page.tsx`（新增：个人中心页 + 修改密码表单）
- `frontend/src/lib/auth.ts`（修改：新增 `changePassword`）
- `frontend/src/lib/api-types.ts`（自动重新生成：`scripts/gen-api-types.mjs`）
- `frontend/src/components/top-bar.tsx`（修改：顶栏用户下拉「个人设置」改造为「个人中心」入口）
- `frontend/src/app/(dashboard)/layout.tsx`（修改：路由白名单 `WORKSPACE_WHITELIST` 加 `/account` 放行）
- `frontend/src/app/(dashboard)/layout.test.tsx`（修改：白名单测试同步加 `/account` 放行断言）
- `frontend/src/app/(dashboard)/account/page.test.tsx`（新增：表单组件测试，覆盖 AC-08）

## 14. 自审

- [x] 需求覆盖：FR-01~08 全部对应对话式探索确认的需求
- [x] Grill 覆盖：D-001~D-006 当前版本全部在 design 引用，无未覆盖决策
- [x] 约束一致：auth `APIRouter(prefix="/auth")`、AppError 子类（类属性 code+http_status）、`apiFetch(url,{method,json})`、端点显式 `status_code`
- [x] 真实性：AuthService/password_hasher/revoke_all_user_sessions/AuditLog/api-types 均来自真实代码或标注「新增」
- [x] YAGNI：非目标明确（强制改密码/强度等级/新≠旧/速率限制/密码历史）
- [x] 验收标准：AC-01~09 具体可测
- [x] 非目标清晰：§3
- [x] 兼容策略：§12 纯新增无破坏
- [x] 风险识别：R-001~04 + 对策
- [x] 生命周期契约表：§6.5（Session active/revolved 状态机 + 事件×状态矩阵）
- [x] 文件变更清单：§13
- 备注：`change_password` 中 `user is None` 为防御分支（`get_current_user` 已保证 user 存在），execute 用合适 NotFound 错误或省略；`204 No Content` 无 response_model 是 FastAPI 204 惯例。
