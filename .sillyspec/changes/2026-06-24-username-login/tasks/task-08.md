---
task_id: task-08
title: 后端测试 — login 纯 username、create username 必填/缺失 422、update username 冲突 409、email 可选、UserRead email 可空
author: WhaleFall
created_at: 2026-06-25T08:43:50
priority: P0
depends_on: [task-05]
blocks: [task-10]
decision_ids: []
requirement_ids: [SC-1, SC-2, SC-3, SC-5, SC-6]
allowed_paths:
  - backend/app/modules/admin/tests/
  - backend/app/modules/auth/tests/
  - backend/app/modules/settings/tests/
---

# task-08 — 后端测试（login 纯 username / create 必填 / update 冲突 / email 可选 / UserRead 可空）

> 本任务仅产出**测试规格 + 用例清单**，实际 pytest 用例在 task-08 execute 阶段按本文件编写。覆盖成功标准 SC-1/2/3/5/6。

## 1. 背景

task-02（schema）/ task-03（service）/ task-04（migration）/ task-05（router 透传）完成后，后端行为变更需要测试锁定：

- 登录仅认 `username`，email 无法登录（SC-3，D-001@v1）。
- `POST /admin/users` 必填「登录名」（缺失 → 422）；email 可选（None 合法，SC-1/SC-5）。
- `PATCH /admin/users/{id}` 改 username/email 与他人重复 → 409 友好报错；改回自身原值 → 放行（自伤防护，SC-2，D-004@v1）。
- `UserRead.email` 序列化为 `None` 合法（SC-1，可空）。
- 非空 email 全局唯一；多个空 email 共存不报错（SC-5，D-003@v1）。

> 前置门禁 spike-01：execute task-03 前 `SELECT count(*) FROM users WHERE username IS NULL` 必须为 0。本任务测试假设无空 username（或 spike-01 已补默认登录名）。

### 测试基线（已核实）

- 测试根目录：`backend/tests/`（非按模块在 `app/modules/*/tests/`；`allowed_paths` 指向的 app 内 tests 目录在本仓不存在，实际落点见 §2）。
- fixture 来源：`backend/conftest.py`（`db_engine` 内存 SQLite + `BaseModel.metadata.create_all`、`db_session`、`client: AsyncClient`、`auth_admin_token`/`auth_headers`，admin email 固定 `admin@example.com`）。
- 现有相关测试：`backend/tests/modules/admin/test_users_router.py`（admin CRUD + 自伤防护）、`backend/tests/modules/auth/test_seed.py`、`backend/tests/modules/auth/`（无 login 纯 username 用例，本任务新增）。
- 风格：`pytest.mark.asyncio` + `httpx.AsyncClient` + 业务断言精确 status_code（如 `assert resp.status_code == 409`、`resp.json()["code"].endswith("...")`）。

### 既有用例需调整/废弃

- `backend/tests/modules/admin/test_users_router.py::test_login_by_email_or_username`：当前断言「邮箱登录 200」+「账号登录 200」。task-03 改纯 username 后，**邮箱登录应失败（401）**。本任务须：
  - 把该用例改为 `test_login_username_only`（保留 username/大小写不敏感/防枚举断言，**删除邮箱登录成功断言**），或
  - 新增 `test_login_email_rejected` 覆盖邮箱登录失败，并把原用例的邮箱分支移过去。
  - 推荐后者（语义清晰、原用例改动最小）。

- `test_legacy_create_user_forwards` / `test_create_user_with_org_and_role_bindings` / `test_create_user_unknown_org_rejected` / `test_create_user_requires_permission` 等现有 create 用例 body 仍用 `{"email": ...}`，task-02 改 `username` 必填后会变 422。**需补 `username` 字段**（email 可保留也可设 None）。

## 2. 修改文件

> `allowed_paths` 列的 `backend/app/modules/{admin,auth,settings}/tests/` 在本仓不存在；实际测试落点为本节路径（与既有测试同根）。若 SillySpec 严格校验 `allowed_paths`，执行时需把本节三路径补进 frontmatter（或事后用 `sillyspec doctor` 修正）。

### 2.1 新增 / 扩展的测试文件

| 文件 | 动作 | 覆盖 |
|---|---|---|
| `backend/tests/modules/auth/test_login_username.py` | **新建** | SC-3：纯 username 登录、email 登录失败、大小写不敏感、防枚举统一 401 |
| `backend/tests/modules/admin/test_users_router.py` | **扩展** | SC-1/2/5：create username 必填/缺失 422、email 可选；update username 冲突 409、email 冲突 409、自伤放行；UserRead email=None 序列化；多空 email 共存、非空 email 重复 409；并修正既有 create 用例 body 补 username |
| `backend/tests/modules/admin/test_username_uniqueness.py` | **新建**（可选，若 §3 用例过多则拆出） | SC-2/5：username/email 唯一性集中用例，避免单文件过长 |

### 2.2 覆盖来源映射

| 用例簇 | 来源 |
|---|---|
| login 纯 username | `design.md` Phase 2（L52：`login()` 移除 email 分支）、Phase 5（L77）、验收标准 3 |
| create username 必填/缺失 422 | `design.md` Phase 1（L45：`username: Field(min_length=3)` 必填）、验收 1、SC-1 |
| create email 可选（None 合法） | `design.md` Phase 1（L45：`email: str \| None = None`）、Phase 5、SC-5 |
| update username 冲突 409 / 自伤放行 | `design.md` Phase 2（L55：username 变更走 `_resolve_username` 排除自身 id + 冲突 409）、D-004@v1、SC-2 |
| update email 冲突 409 | `design.md` Phase 2（L55：email 变更非空唯一校验）、D-003@v1、SC-5 |
| UserRead email 可空 | `design.md` Phase 1（L43/47：`UserRead.email: str \| None`）、SC-1 |
| 多空 email 共存 | `design.md` Phase 3（L65：PG 多 NULL 不冲突）+ 风险表（L105：SQLite 测试库 UNIQUE 对多 NULL 放行）、SC-5 |
| alembic（SC-6）| 由 task-01/04/10 覆盖，本任务**不写** alembic 集成测试（见 §7） |

## 3. 接口定义（测试用例清单）

> 命名遵循现有风格（`test_<行为>`）。所有用例 `@pytest.mark.asyncio`，HTTP 用 `client` fixture，鉴权用 `auth_headers`，造数用 `db_session` + `User(...)` 直插（参照 `test_users_router.py::target_user`）。

### 3.1 `backend/tests/modules/auth/test_login_username.py`（新建）

| 用例 | 输入 | 期望 | 覆盖 |
|---|---|---|---|
| `test_login_username_only` | 造用户 `username="alice"`；`POST /api/auth/login {"account":"alice", ...}` | 200，返回 access/refresh token | SC-3 / D-001 |
| `test_login_username_case_insensitive` | 同上；`{"account":"ALICE"}` | 200（service 归一小写后命中） | SC-3 |
| `test_login_email_rejected` | 同上；`{"account":"alice@example.com"}` | **401**（纯 username 查询，email 不再作为账号；防枚举统一 401） | SC-3 / D-001 |
| `test_login_wrong_password_enumeration_guard` | `{"account":"alice","password":"wrong"}` | 401，`code` 以 `AUTH_` 开头（与不存在用户同形） | SC-3 |
| `test_login_unknown_user` | `{"account":"ghost","password":"Xx1!abcd"}` | 401（与错密同形） | SC-3 |
| `test_login_disabled_user_blocked` | 造 `login_enabled=False` 用户；username 登录 | 401 `AUTH_USER_LOGIN_DISABLED` | SC-3（沿用现有 `test_login_blocked_when_disabled` 思路，account 改 username） |

> 造数要点：`User(username="alice", email="alice@example.com", password_hash=..., login_enabled=True)` —— email 仍填值用于区分「有 email 也不让 email 登录」；登录请求 body 一律走 username。

### 3.2 `backend/tests/modules/admin/test_users_router.py`（扩展）— create 簇

| 用例 | 输入 | 期望 | 覆盖 |
|---|---|---|---|
| `test_create_user_username_required_422` | `POST /api/admin/users` body **缺 username**（仅 email+password） | **422**（schema `Field(min_length=3)` 必填） | SC-1 |
| `test_create_user_username_too_short_422` | body `username="ab"`（<3） | 422 | SC-1 |
| `test_create_user_email_optional_none` | body `{"username":"bob","password":"...","email":null}` | 201，`resp.json()["email"] is None`，`username=="bob"` | SC-1/5 |
| `test_create_user_email_optional_omitted` | body 不含 email 字段 | 201，`email is None` | SC-1 |
| `test_create_user_then_login_by_username` | create `username="carol"` → `POST /api/auth/login {"account":"carol"}` | 201 + login 200 | SC-1（端到端） |
| `test_create_user_username_conflict_409` | 先造 `username="dave"`；create body 再用 `username="dave"` | **409**（去重序号仅对未显式指定 username 的 fallback 生效；显式重复应直接 409，见 §6.3） | SC-2 |

### 3.3 `test_users_router.py`（扩展）— update 簇

| 用例 | 输入 | 期望 | 覆盖 |
|---|---|---|---|
| `test_update_username_conflict_409` | 造 userA `username="erin"`、userB；`PATCH /admin/users/{B} {"username":"erin"}` | **409**，友好 code（如 `USER_USERNAME_CONFLICT`，以 task-03 实现为准） | SC-2 / D-004 |
| `test_update_username_self_allowed` | 造 userA `username="frank"`；`PATCH /admin/users/{A} {"username":"frank"}`（改回自身原值） | **200**（`_resolve_username` 排除自身 id，不误判冲突） | SC-2 / D-004 |
| `test_update_username_change_success` | `PATCH /admin/users/{A} {"username":"frank2"}` | 200，`username=="frank2"`，且可用新名登录 | SC-2 |
| `test_update_email_conflict_409` | userA `email="a@x.com"`、userB；`PATCH /admin/users/{B} {"email":"a@x.com"}` | **409** | SC-5 / D-003 |
| `test_update_email_self_allowed` | userA `email="a@x.com"`；`PATCH /admin/users/{A} {"email":"a@x.com"}` | 200（排除自身） | SC-5 |
| `test_update_email_case_insensitive_conflict` | userA `email="a@x.com"`；`PATCH /admin/users/{B} {"email":"A@X.COM"}` | **409**（service 归一小写后命中） | SC-5 |
| `test_update_email_set_to_null_allowed` | userA 原 email 非空；`PATCH {"email":null}` | 200，`email is None`（可清空） | SC-5 |
| `test_update_username_omitted_keeps_value` | userA `username="greg"`；`PATCH {"display_name":"G"}` 不传 username | 200，`username=="greg"`（None=不改） | SC-2（契约） |

### 3.4 `test_users_router.py`（扩展）— UserRead / email 可空簇

| 用例 | 输入 | 期望 | 覆盖 |
|---|---|---|---|
| `test_userread_email_nullable` | 造 `User(username="hank", email=None)`；`GET /admin/users/{id}` | 200，`resp.json()["email"] is None`，`username=="hank"` | SC-1 |
| `test_userread_email_null_in_list` | 同上；`GET /admin/users` | 200，对应 item `email is None` | SC-1 |
| `test_multiple_null_emails_coexist` | 造 2 个 `email=None` 用户（不同 username） | create 均 201，DB 无唯一冲突（SQLite UNIQUE 对多 NULL 放行） | SC-5 / D-003 |

### 3.5 既有用例修正（同文件）

| 用例 | 改动 |
|---|---|
| `test_login_by_email_or_username` | **删除邮箱登录成功断言**（r1 200）；保留 username/大小写/防枚举断言；或整体删除并由 §3.1 取代（推荐保留并精简，避免 git 历史断裂） |
| `test_legacy_create_user_forwards` | body 补 `"username":"legacy-xxx"` |
| `test_create_user_with_org_and_role_bindings` | body 补 `username` |
| `test_create_user_unknown_org_rejected` | body 补 `username`（否则先撞 422 username 必填，遮蔽目标 422 org） |
| `test_create_user_requires_permission` | body 补 `username`（403 权限校验先于 422，但补齐避免契约漂移） |
| `test_login_blocked_when_disabled` | account 由 `target_user.email` 改 `target_user.username`（确保 target_user fixture 设了 username） |

> §3.5 的 `target_user` fixture（`test_users_router.py:24-37`）当前未设 username，task-03 后 `_resolve_username` 对显式传入的 username 不再 fallback email 前缀（但仍去重），fixture 需显式 `username="target"`。本任务同步修该 fixture。

## 4. 实现要求

1. **测试隔离**：所有用例通过 conftest `db_engine`（每用例新建内存 SQLite + `create_all`）隔离，**不依赖生产/seed 数据**；唯一可能复用的 seed 是 `auth_headers` 的 `admin@example.com`（admin 用户），用例造数时 username 避开 `admin`。
2. **fixture 复用**：HTTP 用 `client`、鉴权用 `auth_headers`、造数用 `db_session`，与 `test_users_router.py` 一致；不新造 fixture（除非 `target_user` 需补 username 字段）。
3. **断言精确**：
   - 422 / 409 / 401 / 200 / 201 显式断言 `resp.status_code`，禁止 `>= 400` 模糊断言。
   - 业务 code 断言用 `endswith`（如 `resp.json()["code"].endswith("USER_USERNAME_CONFLICT")`），容忍前缀（`AUTH_` / `USER_` 命名空间），具体 code 串以 task-03 实现为准（执行时核对 `users_service.py` 抛出的 `HTTPException(detail={"code": ...})`）。
4. **email=None vs 空串区分**：
   - `email=None`（JSON `null`）= 合法可选空；`email=""`（空串）由 task-02 schema 决定（若未加 `min_length` 则空串也通过、service 层 `.strip()` 后等同空 → 视为空 email；若加了约束则 422）。本任务**只覆盖 `None`**，空串行为不纳入断言（避免与 task-02 schema 边界耦合），§6 列为已知不确定项。
5. **不 mock service**：走真实 HTTP + DB，验证 router 透传（task-05）+ service 唯一校验（task-03）+ schema 校验（task-02）端到端。
6. **异步标记**：每用例 `@pytest.mark.asyncio`（与现仓一致；conftest 未配 `asyncio_mode=auto`）。
7. **数据库隐式约束**：SQLite 测试库靠 `ux_users_username` / `ux_users_email_active` 唯一索引 + service 层显式查询双重防护；测试既验证 service 409（显式查询命中）也验证索引兜底（service 漏判时 IntegrityError 不应泄漏为 500 —— 该场景由 §6.4 标注，若 task-03 未包 IntegrityError → 409 转换则补用例）。

## 5. 边界处理（≥5 条）

1. **username 大小写归一**：service `_resolve_username` 对显式 username `.strip().lower()`；create `username="Alice"` 与存量 `alice` 应判冲突。update 同理。测试用 `test_create_user_username_conflict_409` 覆盖大小写归一冲突（可选加 `username="ALICE"` 变体）。
2. **多空 email 共存的 DB 差异**：PG 与 SQLite 的 UNIQUE 索引对多 NULL 均放行（D-003 依赖此语义）；`test_multiple_null_emails_coexist` 在 SQLite 上验证，若将来切 PG 测试库须复跑（风险表 L105 已记）。
3. **update email 清空 vs 改空串**：`PATCH {"email":null}` = 清空（合法）；`PATCH {"email":""}` 行为由 task-02 决定，本任务不测（§4.4）。
4. **IntegrityError 泄漏防护**：若 service 唯一查询与 insert 之间存在并发窗口（测试单线程不会触发），或 service 未显式查询直接依赖索引，重复 insert 会抛 `IntegrityError` → 默认 500。task-03 应在 service 层 try/except 转 409；本任务用例 `test_update_username_conflict_409` 若实际收到 500 视为 task-03 缺陷，回报并在 task-03 补救（不在本任务绕过）。
5. **自伤防护边界**：`_resolve_username` 排除自身 id —— 改回原值放行（`test_update_username_self_allowed`）；但改成「与自身原值不同、且与他人重复」仍 409（`test_update_username_conflict_409` 已覆盖）。email 自伤同理（`test_update_email_self_allowed`）。
6. **disabled 用户 + 纯 username 登录**：`login_enabled=False` 时 username 登录应 401 `AUTH_USER_LOGIN_DISABLED`（沿用 `test_login_blocked_when_disabled`，account 改 username）；确保 task-03 改纯 username 后 disabled 分支仍生效。
7. **admin seed 复用避让**：`auth_headers` 的 admin 用户 `username`（task-03 后 bootstrap 沿用 `admin`）；造数 username 避开 `admin`/`admin2`，否则撞 seed。create 用例用随机后缀（如 `f"user-{uuid.uuid4().hex[:6]}"`）。
8. **既有 create 用例 body 补 username 不改语义**：§3.5 修正是为对齐 task-02 必填契约，断言主体不变（如 `test_create_user_unknown_org_rejected` 仍断言 422，仅 body 补字段）。

## 6. 非目标

- **不写 alembic 集成测试**（SC-6 由 task-01 修链 + task-04 migration + task-10 `alembic upgrade head` 验证；后端单测用 `BaseModel.metadata.create_all` 建表，不走 migration）。
- **不测前端**（drawer 列表/登录页由 task-09 覆盖）。
- **不测密码强度/重置流程**（既有 `reset_password` 未变）。
- **不测 org/role 绑定新行为**（本变更不动绑定逻辑，既有 `test_create_user_with_org_and_role_bindings` 等仅补 username body）。
- **不测空串 email 行为**（§4.4，归 task-02 schema 边界）。
- **不写性能/并发测试**（IntegrityError 并发窗口属生产风险，单测不覆盖）。
- **不改 service/router/schema 实现**（若用例失败，定位到 task-02/03/05 修复，不在本任务改业务代码）。

## 7. 参考

- `design.md` Phase 1（schema L43-48）、Phase 2（service/router L50-61）、Phase 5（测试 L76-79）、验收标准 1/2/3/5（L83-88）、风险表「SQLite 测试库行为差异」（L105）。
- `plan.md` Wave 4 task-08 行（L31）、覆盖矩阵（L48）、关键路径（task-05 → task-08）。
- `decisions.md` D-001@v1（纯登录名）、D-003@v1（非空 email 唯一）、D-004@v1（username 可编辑）。
- `backend/conftest.py`（fixture：`db_engine`/`db_session`/`client`/`auth_admin_token`/`auth_headers`，admin email `admin@example.com`）。
- `backend/tests/modules/admin/test_users_router.py`（既有 admin CRUD + 自伤防护用例、`target_user` fixture）。
- `backend/tests/modules/auth/test_seed.py`（auth 模块测试风格）。
- `backend/app/modules/admin/users_service.py`（`create_user`/`update_user`/`_resolve_username` 现状，task-03 将改）。
- `backend/app/modules/auth/service.py`（`login` 现状含 email 分支，task-03 将改纯 username）。

## 8. TDD 步骤

> 本任务是规格产出；execute 阶段按下列顺序写测试 + 跑红绿。

1. **先跑现有套件基线**：`cd backend && pytest tests/modules/admin tests/modules/auth -x` 记录当前通过情况（task-02/03/05 未合入前基线）。
2. **写 §3.1 login 用例**（`test_login_username.py`）→ 此时 task-03 未改 service，`test_login_email_rejected` 应**红**（邮箱仍能登录）→ 驱动 task-03。
3. **写 §3.2 create 用例** → `test_create_user_username_required_422` / `email_optional_none` 红（task-02 schema 未改）→ 驱动 task-02。
4. **写 §3.3 update 用例** → `test_update_username_conflict_409` 红（task-03 update_user 未加 username 参数/校验）→ 驱动 task-03 + task-05 透传。
5. **写 §3.4 UserRead/email 可空用例** → `test_userread_email_nullable` 红（task-02 `UserRead.email` 仍必填）→ 驱动 task-02。
6. **修 §3.5 既有用例**（补 username body、删邮箱登录断言）→ 配合 task-02/03 合入后转绿。
7. **task-02/03/04/05 全合入后全量绿**：`cd backend && pytest tests/modules/admin tests/modules/auth -x`。
8. **lint/type**：`cd backend && ruff check tests/modules/admin tests/modules/auth` + `mypy tests/modules/admin tests/modules/auth`（若 mypy 配置覆盖 tests）。
9. **跨路由对齐验证**（settings 共用同 schema/service）：补 1-2 个 settings create/update 端点的等价用例（路径 `/api/settings/users` 或实际前缀，执行时核对 `settings/router.py`），确保 admin/settings 行为一致（风险表「两路由发散」L106）。
10. **回归**：`cd backend && pytest -x`（全量，确保未撞其他模块）。

## 9. 验收标准

| 编号 | 验收项 | 验证方式 |
|---|---|---|
| AC-1 | 新增 `test_login_username.py`，含 `test_login_username_only` / `test_login_email_rejected` / 大小写 / 防枚举用例 | 文件存在 + 用例名 grep 命中 |
| AC-2 | `test_create_user_username_required_422`：缺 username → 422 | pytest 通过 |
| AC-3 | `test_create_user_email_optional_none`：`email:null` → 201 且 `email is None` | pytest 通过 |
| AC-4 | `test_update_username_conflict_409`：改 username 撞他人 → 409 | pytest 通过 |
| AC-5 | `test_update_username_self_allowed`：改回自身原值 → 200（自伤防护） | pytest 通过 |
| AC-6 | `test_update_email_conflict_409`：改 email 撞他人 → 409 | pytest 通过 |
| AC-7 | `test_userread_email_nullable`：`GET /admin/users/{id}` 返回 `email:null` | pytest 通过 |
| AC-8 | `test_multiple_null_emails_coexist`：2 个 `email=None` 用户共存不报错 | pytest 通过 |
| AC-9 | 既有 create/login 用例已修正（body 补 username、删邮箱登录断言），不回归 | pytest 通过 + git diff 核对 |
| AC-10 | settings 路由至少 1 个 create + 1 个 update 等价用例（两路由行为对齐） | pytest 通过 |
| AC-11 | `ruff check` 对新增/扩展测试文件通过 | 本地命令 |
| AC-12 | 全量 `pytest tests/modules/admin tests/modules/auth` 绿 | 本地命令 |
| AC-13 | 用例不依赖生产/seed 数据（仅靠 conftest 内存 SQLite + 显式造数） | 代码审查（无 `select(User).where(User.email == "admin@...")` 之外的 seed 依赖，admin 用户除外） |
| AC-14 | 422/409/401 断言精确（`==` 而非 `>=`） | grep 检查 |
