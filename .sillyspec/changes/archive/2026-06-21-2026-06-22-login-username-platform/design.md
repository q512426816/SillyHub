---
author: qinyi
created_at: 2026-06-22T00:42:00
---

# design — 登录支持邮箱/账号 + 平台选择

> id: 2026-06-22-login-username-platform
> 方案: A（alembic 一体迁移）

## 背景

当前登录仅支持 email：`User` 无 username 字段，`AuthService._lookup_active_user_by_email` 按 `email.lower()` 查。用户希望：① 用「邮箱」或「账号」都能登录；② 旧用户补账号 = email 前（@ 前）那段；③ 登录页选择进入「项目管理平台(ppm)」或「SillyHub」。

## 设计目标

- `User` 新增 `username`（全局唯一），登录支持邮箱/账号双查
- 旧用户一次性迁移：username = email 本地部分，前缀重复加序号（a/a2/a3）
- 登录页 antd `Segmented` 平台选择，登录后按选择跳转（ppm→/ppm/projects、sillyhub→/workspaces）

## 非目标

- 不改 JWT / RBAC / Session 生命周期 / 权限体系
- 不做账号自助找回或修改账号 UI（仅登录 + admin 创建时可选填）
- 不做 MFA

## 拆分判断

单一登录功能，<3 独立模块/角色，无批量重复模式 → 不拆分，不走批量。

## 总体方案

### Phase 1 — 后端模型 + 迁移（alembic 一体）
| 项 | 内容 |
|---|---|
| User 字段 | 加 `username: str`（String(100)） |
| migration（单 revision） | ① ADD COLUMN username NULL → ② 回填 `lower(email @前段)`，前缀重复加序号（Python op 遍历去重）→ ③ CREATE UNIQUE INDEX `ux_users_username` |

### Phase 2 — 后端登录双查
| 项 | 内容 |
|---|---|
| `LoginRequest` | `email` → `account`（语义泛化） |
| `AuthService.login(account,…)` | `@ in account` → email 路径；否则走 `_lookup_active_user_by_username`；两路均 `.lower().strip()` |

### Phase 3 — 后端 admin 用户 CRUD
| 项 | 内容 |
|---|---|
| `UserCreateRequest` | 加 `username`（可选，留空自动 = email 前缀 + 去重加序号） |
| `UserRead` | 加 `username` |
| `create_user` | 同步 username 生成逻辑 |

### Phase 4 — 前端登录页 + 平台选择 + 跳转
| 项 | 内容 |
|---|---|
| 输入框 | label「邮箱/账号」，放宽校验（去 `type:email`，仅 required） |
| 平台选择 | antd `Segmented`（项目管理平台 / SillyHub，默认 SillyHub，localStorage 持久回填） |
| 跳转 | ppm → `/ppm/projects`，sillyhub → `/workspaces` |
| `auth.ts` | `login(email,…)` → `login(account,…)`；记住我缓存键改 `account` |

### Phase 5 — 测试
后端：login 双查（email/username/不存在/密码错）+ 迁移前缀去重；前端：平台选择 + 跳转。

## 文件变更清单

| 操作 | 文件 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/auth/model.py` | User 加 `username` 字段 |
| 新增 | `backend/alembic/versions/2026xxxx_add_user_username.py` | 加列 + 回填 + 唯一索引 |
| 修改 | `backend/app/modules/auth/schema.py` | `LoginRequest.email`→`account`；`UserRead` 加 username |
| 修改 | `backend/app/modules/auth/service.py` | login 双查 + `_lookup_active_user_by_username` + **bootstrap_admin 补 username 生成**（否则 NOT NULL 失败） |
| 修改 | `backend/app/modules/auth/router.py` | login 调用点 `email=payload.email` → `account=payload.account` |
| 修改 | `backend/app/modules/admin/schema.py` | `UserCreateRequest`/`UserRead` 加 username |
| 修改 | `backend/app/modules/admin/users_service.py` | create_user 生成 username |
| 修改 | `backend/app/modules/admin/router.py` | create_user 调用传 `username=payload.username` |
| 修改 | `frontend/src/lib/auth.ts` | `login(account,…)` |
| 修改 | `frontend/src/app/(auth)/login/page.tsx` | label + Segmented + 跳转 + 缓存键 |
| 新增 | `backend/app/modules/auth/tests/`（或同级） | login 双查测试 |
| 新增 | migration 测试 | 前缀去重测试 |

## 接口定义

```
LoginRequest: { account: str (min_length=3), password: str (min_length=1) }
POST /api/auth/login → TokenPair（不变）

分流：account.lower().strip() 含 '@' → 按 email 查；否则按 username 查
UserRead 新增字段: username: str
```

## 数据模型

`users` 表 + `username VARCHAR(100) NOT NULL`（迁移回填后）+ `UNIQUE INDEX ux_users_username (username)`。

## 兼容策略（brownfield）

- alembic 一体迁移回填所有旧用户，回填完成后 username 非空；前端登录字段同步 `account`
- 回退：migration `downgrade` 删列 + 删索引
- 不变：JWT / RBAC / Session / 其余 API / 表结构

## 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R1 | email 本地部分含特殊字符(`.` `_` `+` `-`) 作 username | 低 | 原样存储/查询，仅去重加序号，不做字符白名单 |
| R2 | 前缀重复加序号后用户不知道自己序号 | 中 | admin 可查/改 username；`/me` 返回 username |
| R3 | 迁移时唯一索引与存量冲突 | 低 | 回填先去重再加 NOT NULL/UNIQUE；顺序保证 |
| R4 | LoginRequest 字段改名 `email`→`account` 破坏前端 | 低 | 前端 auth.ts + 登录页同步改；字段改名属一次性改造 |
| R5 | username 大小写敏感导致登录失败 | 低 | 统一 `.lower().strip()` 存储与查询（对齐 email 现状） |

## 内联决策（来自需求澄清）

- D-001@V1 新建用户 username：可选，留空自动 email 前缀 + 去重（统一迁移逻辑）
- D-002@V1 username 大小写：`.lower().strip()` 存储/查询
- D-003@V1 username 唯一：全局唯一索引，参照 `ux_users_email_active`
- D-004@V1 登录默认平台：Segmented 默认 SillyHub，选择 localStorage 持久
- D-005@V1 bootstrap_admin 补 username：新建管理员时 username = email 前缀（与迁移统一），避免 username NOT NULL 后 bootstrap 失败（Design Grill 发现的一致性遗漏）

## 生命周期契约表

登录/会话相关事件（沿用现有 `AuthService`，本次仅扩展登录入口为 account=email 或 username，**不改变 Session 状态机**）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| login（email 或 username） | client | backend | `account`, `password` | 无 session → 新建 active session |
| refresh | client | backend | `refresh_token` | 旧 session revoked → 新 active session |
| logout | client | backend | `refresh_token` | active → revoked |

## 自审

- 必填章节齐全（背景/目标/非目标/拆分/方案/文件清单/接口/数据模型/兼容/风险）
- 本次不改 Session 状态机，仅扩展登录入口（`account` = email 或 username），契约表列出现有事件供对照
- Design Grill 已修正 `bootstrap_admin` 缺 username 的一致性遗漏（D-005@V1）
- 无 P0 未决项
