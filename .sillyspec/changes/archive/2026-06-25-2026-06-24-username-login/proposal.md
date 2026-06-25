---
author: WhaleFall
created_at: 2026-06-25T08:31:51
---

# proposal — 登录名（username）作为登录主账号，邮箱改非必填

变更：`2026-06-24-username-login`

## 动机

平台 `/admin/users` 当前以邮箱作为登录账号（`User.email` 必填 + 唯一）。业务上并非所有用户都有/都需要邮箱（如内部系统账号、外包人员），强制邮箱既不必要也增加管理负担。用户希望引入独立的「登录名」作为登录主账号，邮箱改为可选。

## 关键问题（为什么现有方案不够）

1. **登录强依赖邮箱**：`User.email` 必填，无邮箱的用户无法建账号。
2. **登录名字段已存在但未启用为主账号**：`User.username` 字段 + 唯一索引 `ux_users_username` 已就位，登录逻辑（`login()` 含@走 email 否则走 username）也已支持 username 登录，但管理后台表单不暴露 username 编辑、email 仍强制必填——能力具备，入口缺失。
3. **alembic 链断裂阻塞 schema 变更**：`email` 改 nullable 需要新 migration，但当前 `202606281200_merge_multi_heads.py` 引用不存在的 revision，`alembic heads` 报错，必须先修。

## 变更范围

- **后端 `auth`**：`login()` 改纯 username（移除 email 分支，保留方法不删）；`UserRead.email` 改可空。
- **后端 `admin`/`settings`**：`UserCreateRequest`（email 可选、username 必填）、`UserUpdateRequest`（增 username/email 可编辑）、`UserRead`（email 可空）；`UserService.create_user`/`update_user` 支持 username 必填/改名唯一校验、email 可选；两 router 的 create/update 端点手动透传补 username/email。
- **DB migration**：删除多余坏 merge revision；新增 `email DROP NOT NULL`。
- **前端**：`admin-user-drawer` 加登录名（必填可编辑）、email 可选；用户列表显登录名列；登录页文案改「登录名」、默认回填 `admin`；类型与测试同步。
- 详见 `design.md`、`decisions.md`（D-001~D-005@v1）。

## 不在范围内（显式清单）

- ❌ 不做邮箱验证 / 找回密码邮件流程（现有密码重置走管理员 `resetUserPassword`）。
- ❌ 不改 `LoginRequest.account` 字段名（保留，零契约改动）。
- ❌ 不给 `username` 加 DB CHECK 约束（应用层校验格式）。
- ❌ 不改 `ux_users_email_active` 为部分唯一索引（依赖 PG NULL 语义即可）。
- ❌ 不做存量 username 批量通知/重设（沿用已生成值；execute 前查 NULL 兜底）。
- ❌ 不改 RBAC / API Key / session 机制（仅登录账号字段语义）。

## 成功标准（可验证）

1. `/admin/users` 新建用户必须填「登录名」，邮箱可不填；保存后可用登录名登录。
2. 编辑用户可改登录名，与他人重复时友好报错（409）。
3. 登录页只引导「登录名」；用 email 无法登录（纯 username 查询）。
4. 存量用户沿用原 username 正常登录（零数据迁移）。
5. 非空 email 全局唯一；多个空 email 共存不报错。
6. `alembic heads` 单一 head，`alembic upgrade head` 成功。
7. 后端 ruff/mypy/pytest + 前端 tsc/lint/test 全绿。
