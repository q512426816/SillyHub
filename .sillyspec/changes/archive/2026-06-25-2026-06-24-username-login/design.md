---
author: WhaleFall
created_at: 2026-06-24T21:57:58
---

# design — 登录名（username）作为登录主账号，邮箱改非必填

变更：`2026-06-24-username-login`
模块：`auth` + `admin`（+ `settings` 复用同源 schema/service）+ 前端

## 1. 背景与目标

当前登录账号是邮箱（`User.email` 必填 + 唯一），`User.username` 字段虽已存在（唯一索引 `ux_users_username`）但仅为可选、留空时自动取 email 本地部分。用户希望：

- 增加「登录名」字段作为登录主账号（不再用邮箱登录）；
- 邮箱改为非必填。

目标：把 `username` 提升为**必填、可编辑、唯一**的登录主账号，`email` 降为**非必填**（非空仍唯一），登录改为**纯 username**。采用最小兼容改造，复用现有字段与索引，**零数据迁移**（存量 `username` 沿用已从 email 前缀生成的值）。

> 本设计依据 `decisions.md`：D-001@v1（纯登录名登录）、D-002@v1（存量 username 沿用）、D-003@v1（非空 email 仍唯一）、D-004@v1（username 可编辑）、D-005@v1（方案 A 最小兼容 + 删除多余 merge revision）。

## 2. 现状（已核实）

- `auth/model.py` `User`：`email` 必填（`Column(String(255), nullable=False)`）+ `ux_users_email_active(email, unique=True)` 唯一索引；`username` 可选（`nullable=True`）+ `ux_users_username(username, unique=True)`。
- `auth/service.py` `login()`：`account` 含 `@` 走 `_lookup_active_user_by_email`，否则走 `_lookup_active_user_by_username`（双登录已实现）。
- `auth/schema.py` `UserRead.email: str`（必填）；`LoginRequest.account: str`。
- `admin/schema.py`：`UserCreateRequest.email` 必填、`username` 可选；`UserUpdateRequest` 无 username/email；`UserRead.email` 必填。
- `admin/users_service.py`：`create_user(email 必填, username 可选)` → `_resolve_username(username, email)`（留空取 email 前缀 + 去重序号）；`update_user` 无 username/email 修改。
- `settings/schema.py` re-export admin 的 `UserCreateRequest/UserUpdateRequest`，`settings/router.py` + `admin/router.py` 共用 `UserService`（改 admin schema/service 一处两路由共享）。
- 前端 `admin-user-drawer.tsx`：仅 `email` 字段（必填、编辑禁用），无 username；`login/page.tsx` 文案「邮箱 / 账号」。
- **阻塞**：alembic 链断裂 — `202606281200_merge_multi_heads.py` 的 `down_revision=("202606241000","202606281000")`，`202606281000` 不存在 → `alembic heads` 报 `KeyError`。

## 3. 设计

### Phase 0 — 修复 alembic 链断裂（前置）

已核实：`202606281200`（坏 merge）无子、无被引用；`202606241001` 无子。**删除 `202606281200_merge_multi_heads.py`**，链恢复线性 `…→202606241000→202606241001`，head=`202606241001`。新 migration 的 `down_revision="202606241001"`。

> 备选：保留 merge 但修正第二参数指向实际 head。不采用 — 该 merge 引用的两个 down 本就同链（`202606241000` 与 `202606241001` 是父子，非分叉），merge 无意义，删除更干净。

### Phase 1 — 后端 schema

- `auth/schema.py`：`UserRead.email: str | None`。
- `admin/schema.py`：
  - `UserCreateRequest.email: str | None = None`（去 `min_length=3` 必填约束）；`username: str = Field(min_length=3)`（必填）。
  - `UserUpdateRequest` 增 `username: str | None = None`、`email: str | None = None`（可编辑）。
  - `UserRead.email: str | None`。
- `settings/schema.py` 自动同步（re-export）。

### Phase 2 — 后端 service / router

- `auth/service.py` `login()`：移除「含@走 email」分支，**纯走 `_lookup_active_user_by_username(normalized)`**；保留 `_lookup_active_user_by_email` 方法（不删，避免误伤潜在调用方）。
- `admin/users_service.py`：
  - `create_user`：`email` 改可选；`username` 必填传入；`_resolve_username(username, email)` 调整为 `username` 必填（不再 fallback email 前缀，但仍保留去重序号逻辑防撞）；`display_name` 缺省时用 `username` 兜底（原依赖 `email.split`）。
  - `update_user`：增 `username`/`email` 可选参数；`username` 变更走 `_resolve_username`（排除自身 id）+ 冲突抛 `HTTP_409`；`email` 变更小写归一 + 非空唯一校验。
- `admin/router.py` + `settings/router.py`：两路由的 `create_user`/`update_user` 端点是**手动逐字段透传** service（非 `**payload` 解包），需各自补字段：
  - `create` 透传 `username=payload.username`（admin create 已透传，settings create 当前缺）；
  - `update` 透传 `username=payload.username, email=payload.email`（两路由 update 当前均缺）。
  - schema 虽共享（settings re-export admin），但 router 透传层必须分别改。
- `settings/router.py`：除上述透传外，复用同 schema/service，无其他独立改动。
- `bootstrap_admin` seed：保持 `username=admin`（email 前缀），管理员可登录。

### Phase 3 — DB migration

新增 revision（`down_revision="202606241001"`）：`ALTER TABLE users ALTER COLUMN email DROP NOT NULL`（PG）。`ux_users_email_active(email, unique=True)` 唯一索引保留 — PG 中多个 NULL 不冲突，非空 email 仍唯一，满足 D-003。`username` 列保持 `nullable=True`（存量可能空；新用户应用层必填），`ux_users_username(username, unique=True)` 唯一索引保留。

### Phase 4 — 前端

- `lib/admin.ts`：`UserRead.email?: string | null`；`UserCreateRequest.username: string`（必填）、`email?: string | null`；`UserUpdateRequest` 增 `username?`/`email?`。
- `admin-user-drawer.tsx`：增「登录名」字段（必填、可编辑、唯一冲突报错回显）；`email` 改非必填，仅在有值时校验 `EMAIL_PATTERN`；create body 传 `username`，edit body 支持传 `username`/`email`。
- `admin/users/page.tsx`：列表增「登录名」列；各处 `user.email` 展示/标题/toast 改 `user.username` 优先（`email` 兜底）。
- `login/page.tsx`：文案「邮箱 / 账号」→「登录名」；默认回填 `admin@sillyhub.local` → `admin`；`account` 字段保留（后端当 username 查）。
- `admin-user-drawer.test.tsx`：更新「登录名必填 / email 可选」用例。

### Phase 5 — 测试 + 部署

- 后端：`auth` login 纯 username 用例；`admin` create username 必填/缺失 422、update username 冲突 409、email 可选；`UserRead` email 可空序列化。
- 前端：drawer 登录名必填校验、email 可选。
- 重建前后端 Docker 镜像并部署。

## 4. 验收标准

1. `/admin/users` 新建用户必须填「登录名」，邮箱可不填；保存后可用登录名登录。
2. 编辑用户可改登录名（唯一冲突时友好报错，不自伤）。
3. 登录页只引导「登录名」，用 email 无法登录（纯 username 查询）。
4. 存量用户沿用原 username 正常登录（零数据迁移）。
5. 非空 email 仍全局唯一；多个空 email 共存不报错。
6. `alembic heads` 单一 head，`alembic upgrade head` 成功应用 email nullable。
7. 后端 ruff/mypy/pytest + 前端 tsc/lint/test 全绿。

## 5. 非目标

- 不做邮箱验证邮件 / 找回密码邮件流程（现有 `resetUserPassword` 是管理员重置，不走邮件）。
- 不改 `LoginRequest.account` 字段名（保留，零契约改动）。
- 不给 `username` 加 DB CHECK 约束（应用层校验格式）。
- 不改 email 唯一索引为部分唯一索引（依赖 PG NULL 语义即可）。

## 6. 风险与对策

| 风险 | 对策 |
|---|---|
| 删 merge revision 影响 DB 已应用的 alembic 版本 | 该 merge revision 内容为空（仅合并），生产 DB 未应用过坏链；删除安全。execute 前用 `alembic current` 核实。 |
| 存量存在空 `username` 的用户（D-002 假设全部已生成） | execute Phase 2 前先查 `SELECT count(*) FROM users WHERE username IS NULL`；若有，需先补默认登录名（如 email 前缀）再上线纯 username 登录，否则这些用户无法登录。 |
| 存量 username 含去重序号（如 `admin2`）用户不知登录名 | Phase 4 列表显示「登录名」列，管理员可见；不在本期做批量通知。 |
| email 改 nullable 后唯一索引在 SQLite 测试库行为差异 | 测试用 SQLite，UNIQUE 对多 NULL 同样放行；增专门用例覆盖。 |
| settings/admin 两路由行为发散 | 共用 schema + UserService，改一处共享；测试覆盖两路由。 |

## 7. 回退

- 代码回退：git revert 本次变更提交。
- DB 回退：新 migration 提供 `downgrade`（`ALTER TABLE users ALTER COLUMN email SET NOT NULL`）；前提是回退时无空 email 用户（存量都有 email）。
