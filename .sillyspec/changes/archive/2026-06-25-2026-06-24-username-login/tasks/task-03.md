---
task_id: task-03
title: 后端 service — login 纯 username、create/update_user 唯一校验、_resolve_username 容忍 email=None
author: WhaleFall
created_at: 2026-06-25T08:43:50
priority: P0
status: pending
depends_on: [task-02]
blocks: [task-05]
decision_ids: [D-001@v1, D-002@v1, D-004@v1]
requirement_ids: []
allowed_paths:
  - backend/app/modules/auth/service.py
  - backend/app/modules/admin/users_service.py
---

# task-03 — 后端 service 改造（login / create_user / update_user / _resolve_username / bootstrap）

> 覆盖 `design.md` Phase 2，D-001（纯登录名登录）、D-002（存量 username 沿用）、D-004（username 可编辑）。
> 前置：task-02（schema 已把 `UserCreateRequest.email` 改 Optional、`username` 必填；`UserUpdateRequest` 增 `username`/`email`）。
> 后续：task-05（router 透传 username/email）、task-08（测试）。

## 1. 修改文件

| 文件 | 改动点 |
|---|---|
| `backend/app/modules/auth/service.py` | `login()` 移除含 @ 分支（D-001）；`bootstrap_admin_and_seed_rbac` 保持 `username=admin`（admin）。spike-01 前置空 username 检查在 execute 阶段做，本任务不改 bootstrap 写入逻辑。 |
| `backend/app/modules/admin/users_service.py` | `create_user`（email 可选、username 必填、display_name 用 username 兜底）；`_resolve_username`（容忍 email=None、不再 fallback）；`update_user`（增 username/email 可选参数 + 唯一校验 + 409 冲突）。 |

## 2. 覆盖来源

- `design.md` §3 Phase 2（第 50-61 行）
- `decisions.md`：D-001@v1（纯 username 登录）、D-002@v1（存量沿用）、D-004@v1（username 可编辑）
- `plan.md` task-03 行（W2）
- 现状代码（已读）：
  - `auth/service.py:75-107`（login 双分支）、`161-179`（两个 _lookup_* helper）、`297-346`（bootstrap）
  - `admin/users_service.py:132-191`（create_user）、`193-208`（_resolve_username）、`210-294`（update_user）

## 3. 实现要求

### 3.1 auth/service.py — login() 纯 username（D-001）

- 移除 `if "@" in normalized:` 分支判断，**始终**走 `_lookup_active_user_by_username(normalized)`。
- **保留** `_lookup_active_user_by_email` 方法不删（design.md 明确要求避免误伤潜在调用方，未来可能复用）。
- 错误信息「Invalid email or password.」保持不变（避免契约变化 + 不泄露账号存在性）。
- 注释由「邮箱或账号登录」改为「纯登录名（username）登录」。
- `normalized` 仍 `account.strip().lower()`，因为 `username` 在 DB 与 `_resolve_username` 中也统一小写存储。

### 3.2 admin/users_service.py — create_user

- 签名：`email: str | None = None`（改可选）；`username: str`（改必填，去掉 `| None`）。
- `display_name` 兜底：`display_name or resolved_username`（原 `email.split("@",1)[0]`，email=None 时会崩；username 必填必非空，安全）。
- `email` 非空时仍走 `email.lower().strip()`；为 None 时 `User(email=None, ...)`（依赖 task-04 migration 把列改 nullable）。
- `_resolve_username(username, email=None)`：username 必填，不再 fallback email 前缀。
- AuditLog `details_json` 中 `{"email": user.email, ...}`：email 可能为 None，`json.dumps` 支持 None，无需特判。

### 3.3 admin/users_service.py — _resolve_username 容忍 email=None

- 签名：`_resolve_username(self, username: str, email: str | None = None, *, exclude_id: uuid.UUID | None = None) -> str`。
- `base = username.strip().lower()`（不再 `username or email.split(...)`；username 必填，短路安全）。
- 去重序号逻辑保留（a/a2/a3 防撞），冲突查询新增 `WHERE User.id != exclude_id`（供 update_user 改名时排除自身，避免「把自己当成冲突」）。

### 3.4 admin/users_service.py — update_user 增 username/email + 唯一校验（D-004）

- 新增可选参数：`username: str | None = None`、`email: str | None = None`。
- username 变更控制流：
  1. `if username is not None and username != target.username:`
  2. 调 `_resolve_username(username, email=target.email, exclude_id=target_id)` 得到 resolved；
  3. 若 `resolved != username.strip().lower()`（说明被加了序号，即目标名已被他人占用）→ 抛 `HTTPException(409, detail={"code": "USERNAME_ALREADY_TAKEN", "username": username})`；
  4. 否则 `target.username = resolved`。
- email 变更控制流：
  1. `if email is not None and email.lower().strip() != (target.email or ""):`
  2. `normalized_email = email.lower().strip()`；
  3. 非空时查 `SELECT 1 FROM users WHERE email = :e AND id != :self AND deleted_at IS NULL LIMIT 1`，命中 → `HTTPException(409, detail={"code": "EMAIL_ALREADY_TAKEN"})`；
  4. 空字符串视为「清空邮箱」：`target.email = None`（若 normalized_email == ""）。
  5. 否则 `target.email = normalized_email`。
- username/email 唯一性冲突统一用 409（与 D-004「唯一冲突报错」一致），不静默改名。
- AuditLog `details_json` 增 `"username": username, "email": email` 字段（仅记录入参，None 也写）。

### 3.5 auth/service.py — bootstrap_admin seed（保持）

- `username=admin_email.split("@",1)[0]`（329 行）保持不变（admin）。
- `display_name` 兜底（331-332 行）保持 `or admin_email.split("@",1)[0]`：bootstrap 始终有 email（`platform_bootstrap_admin_email` 为空时 303 行已 return），不会崩。
- **spike-01**：execute 阶段在 task-03 实施前查 `SELECT count(*) FROM users WHERE username IS NULL`；若有空值，先补默认登录名（email 前缀）。本任务的 service.py 改动不含此回填脚本，由 execute 时人工/脚本处理（plan.md spike-01 约定）。

## 4. 接口定义（方法签名 + 控制流伪代码）

### 4.1 AuthService.login

```python
async def login(
    self,
    *,
    account: str,
    password: str,
    user_agent: str | None,
    ip: str | None,
) -> tuple[User, TokenPair]:
    # 纯登录名（username）登录（D-001）。account 字段名保留（零契约改动），
    # 后端当 username 查；不再识别 @ email。
    normalized = account.strip().lower()
    user = await self._lookup_active_user_by_username(normalized)
    if user is None or not password_hasher.verify(password, user.password_hash):
        raise AuthInvalidCredentials("Invalid email or password.")  # 文案保持，不泄露存在性
    if not user.login_enabled:
        raise AuthUserLoginDisabled(...)
    pair = await self._issue_token_pair(user, user_agent=user_agent, ip=ip)
    user.last_login_at = _utc_now()
    await self._db.commit()
    return user, pair
```

### 4.2 UserService.create_user（新签名）

```python
async def create_user(
    self,
    *,
    email: str | None = None,           # 可选（D-003：非空仍唯一）
    password: str,
    username: str,                      # 必填（D-001/D-004）
    display_name: str | None = None,
    is_platform_admin: bool = False,
    login_enabled: bool = True,
    organization_ids: list[uuid.UUID] | None = None,
    role_ids: list[uuid.UUID] | None = None,
) -> User:
    self._set_audit_context()
    pw_hash = password_hasher.hash(password)
    now = datetime.now(UTC)
    resolved_username = await self._resolve_username(username, email)  # username 必填
    normalized_email = email.lower().strip() if email else None
    user = User(
        id=uuid.uuid4(),
        email=normalized_email,
        username=resolved_username,
        password_hash=pw_hash,
        display_name=display_name or resolved_username,   # 用 username 兜底（原 email.split 会崩）
        status="active",
        is_platform_admin=is_platform_admin,
        login_enabled=login_enabled,
        created_at=now,
        updated_at=now,
    )
    self.session.add(user)
    await self.session.flush()
    # ... organization_ids / role_ids / AuditLog（保持）...
    await self.session.commit()
    await self.session.refresh(user)
    return user
```

### 4.3 UserService._resolve_username（容忍 email=None + exclude_id）

```python
async def _resolve_username(
    self,
    username: str,
    email: str | None = None,
    *,
    exclude_id: uuid.UUID | None = None,
) -> str:
    """username 必填，小写归一；前缀重复自动加序号（a/a2/a3…）。

    email 仅作兼容签名保留，不再参与 base 计算（username 必填）。
    exclude_id 用于 update 改名时排除自身，避免自伤。
    """
    base = username.strip().lower()      # 不再 `username or email.split(...)`，username 必填
    candidate = base
    suffix = 2
    while True:
        stmt = select(User.id).where(User.username == candidate)
        if exclude_id is not None:
            stmt = stmt.where(User.id != exclude_id)
        exists = await self.session.execute(stmt.limit(1))
        if exists.scalars().first() is None:
            return candidate
        candidate = f"{base}{suffix}"
        suffix += 1
```

### 4.4 UserService.update_user（增 username/email + 唯一校验）

```python
async def update_user(
    self,
    target_id: uuid.UUID,
    *,
    display_name: str | None = None,
    is_platform_admin: bool | None = None,
    status: str | None = None,
    login_enabled: bool | None = None,
    username: str | None = None,         # 新增（D-004）
    email: str | None = None,            # 新增
    organization_ids: list[uuid.UUID] | None = None,
    role_ids: list[uuid.UUID] | None = None,
) -> User:
    target = await self.session.get(User, target_id)
    if target is None or target.deleted_at is not None:
        raise HTTPException(404, "User not found")
    # ... self-disable / last-admin 保护（保持）...

    self._set_audit_context()

    # ---- username 变更 + 唯一校验（D-004）----
    if username is not None and username.strip().lower() != (target.username or ""):
        resolved = await self._resolve_username(username, target.email, exclude_id=target_id)
        if resolved != username.strip().lower():
            # 被加了序号 → 目标名已被他人占用
            raise HTTPException(
                status_code=409,
                detail={"code": "USERNAME_ALREADY_TAKEN", "username": username},
            )
        target.username = resolved

    # ---- email 变更 + 非空唯一校验（D-003）----
    if email is not None:
        normalized_email = email.lower().strip()
        prev = (target.email or "").lower()
        if normalized_email != prev:
            if normalized_email:  # 非空 → 查重
                hit = await self.session.execute(
                    select(User.id)
                    .where(User.email == normalized_email)
                    .where(User.id != target_id)
                    .where(col(User.deleted_at).is_(None))
                    .limit(1)
                )
                if hit.scalars().first() is not None:
                    raise HTTPException(
                        status_code=409,
                        detail={"code": "EMAIL_ALREADY_TAKEN"},
                    )
                target.email = normalized_email
            else:
                target.email = None  # 清空邮箱

    # ... display_name / is_platform_admin / status / login_enabled（保持）...
    # ... AuditLog details_json 增 "username": username, "email": email ...
    target.updated_at = datetime.now(UTC)
    self.session.add(target)
    # ... org/role rewrite / revoke / commit ...
    await self.session.commit()
    await self.session.refresh(target)
    return target
```

## 5. 边界处理（≥5 条）

1. **email=None 不崩**：`create_user` 中 `display_name or resolved_username`（不再 `email.split`）；`User(email=None)` 合法（依赖 task-04 列改 nullable）；`_resolve_username` base 仅用 username，email 参数虽传但不被 `.split`。
2. **username 改名自伤防护**：`update_user` 调 `_resolve_username(..., exclude_id=target_id)`，冲突查询 `WHERE id != self`，避免「我现在的名字和我自己冲突」导致永远改名失败或被加序号变成 `admin2`。
3. **冲突 409 不静默**：username 被占用时（resolved 被加了序号）直接抛 `HTTPException(409, USERNAME_ALREADY_TAKEN)`，不静默接受 `xxx2`；email 占用抛 `EMAIL_ALREADY_TAKEN`。前端据 409 detail 友好回显（task-06）。
4. **display_name 兜底**：原 `email.split("@")[0]` 在 email=None 时 AttributeError；改用 `resolved_username`（必填、已 strip/lower、非空），安全。
5. **存量空 username 风险（spike-01）**：execute task-03 前必须查 `SELECT count(*) FROM users WHERE username IS NULL`。若有空值，纯 username 登录会让这些用户锁死（`_lookup_active_user_by_username` 查不到空 username）。对策：先回填默认登录名（如 email 前缀），再上线。本任务 service 改动不含回填脚本。
6. **email 清空 vs 改名歧义**：`update_user(email="")` → `normalized_email == ""` → 视为清空（`target.email = None`）；`update_user(email=None)` → 不动 email（None 表示「未传该字段」）。区分明确，避免误清空。
7. **大小写归一**：username 与 email 在写入/比对前统一 `.strip().lower()`，与 `_resolve_username` base 计算、`login()` 的 `normalized` 一致，防止 `Admin` 与 `admin` 被当两人。
8. **保留 `_lookup_active_user_by_email`**：不删，避免误伤；login 不再调用它，但方法仍在，未来找回密码等场景可复用。

## 6. 非目标

- 不改 `LoginRequest.account` 字段名（零契约改动，design.md §5）。
- 不在 DB 层加 username CHECK 约束（应用层校验格式，design.md §5）。
- 不删 `_lookup_active_user_by_email` 方法。
- 不改 bootstrap_admin 写入逻辑（保持 username=admin）；spike-01 回填脚本不在本任务。
- 不改 router 透传（task-05）；不改前端（task-06/07）；不写 migration（task-04）。
- 不改 `delete_user/disable_login` 等其他方法签名。

## 7. 参考

- `design.md` §3 Phase 2、§5 非目标、§6 风险
- `plan.md` task-03（W2）、spike-01
- `decisions.md` D-001/D-002/D-004@v1
- 现状：`auth/service.py:75-107/161-179/297-346`、`admin/users_service.py:132-208/210-294`

## 8. TDD 步骤（task-08 落测试，本任务只定契约）

1. **login 纯 username**（D-001）：
   - 用 username 登录成功；
   - 用 email 登录失败（401，即便 email 存在）。
2. **create_user email 可选 / username 必填**（D-001/D-003）：
   - `create_user(username="alice")` 成功，email=None；
   - `create_user(username="alice", email="a@x.com")` 成功；
   - username 缺失 → 由 schema 层 422（task-02），service 层不重复校验。
3. **create_user username 撞名自动加序号**：
   - 已有 alice → 新建 alice 得到 `alice2`。
4. **update_user 改 username 唯一冲突 409**（D-004）：
   - 已有 alice、bob；update bob → username="alice" 抛 409 USERNAME_ALREADY_TAKEN。
5. **update_user 改 username 自身不冲突**：
   - alice 改名 "alice"（同名）不动；改名 "alice2"（无人占）成功。
6. **update_user 改 email 唯一冲突 409**（D-003）：
   - alice 有 a@x.com、bob 有 b@x.com；update bob → email="a@x.com" 抛 409 EMAIL_ALREADY_TAKEN。
7. **update_user 清空 email**：
   - alice update email="" → email 变 None；其他用户也能 email=None 共存（PG 多 NULL 不冲突）。
8. **display_name 兜底**：
   - `create_user(username="alice", email=None, display_name=None)` → display_name == "alice"。
9. **bootstrap**：启动后 admin 用户 username == admin，可用 admin 登录。

## 9. 验收标准

| 编号 | 验收项 | 验证方式 | 覆盖 |
|---|---|---|---|
| AC-1 | `login()` 不再含 @ 分支，纯走 `_lookup_active_user_by_username` | 读改后 `auth/service.py`，grep `@` 不在 login 方法体出现；task-08 用例「email 登录失败」通过 | D-001 |
| AC-2 | `_lookup_active_user_by_email` 方法仍存在（未误删） | grep `_lookup_active_user_by_email` 命中方法定义 | — |
| AC-3 | `create_user` 签名 `email: str \| None = None`、`username: str`（必填） | 读改后 `users_service.py` 签名 | D-001/D-003 |
| AC-4 | `create_user` 中 `display_name` 兜底用 resolved_username，不再 `email.split` | grep `email.split` 不在 create_user 方法体；email=None 时不抛 AttributeError | D-001 |
| AC-5 | `_resolve_username` 接受 `email=None` 且 base 不依赖 email；支持 `exclude_id` | email=None 调用不崩；update 改名传 exclude_id 不自伤 | D-002/D-004 |
| AC-6 | `update_user` 新增 `username`/`email` 可选参数 | 读改后签名 | D-004 |
| AC-7 | username 改名冲突抛 409 `USERNAME_ALREADY_TAKEN`（不静默加序号给调用方） | task-08 用例通过 | D-004 |
| AC-8 | email 改值时非空唯一校验，冲突抛 409 `EMAIL_ALREADY_TAKEN`；空串清空为 None | task-08 用例通过 | D-003 |
| AC-9 | 改名/改 email 时排除自身 id（自伤防护） | update alice→username="alice" 不报 409 | D-004 |
| AC-10 | `bootstrap_admin` seed 保持 `username=admin`（未被本任务改动破坏） | 启动后 admin 可用 admin 登录；spike-01 已确认无空 username 行 | D-002 |
| AC-11 | spike-01 前置：execute 前查 `count(*) WHERE username IS NULL == 0`（或已回填） | execute 阶段记录查询结果 | D-002 |
| AC-12 | backend `ruff check` + `mypy`（本任务两文件）通过 | execute 阶段 lint | — |
