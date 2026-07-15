<!-- author: WhaleFall -->
<!-- created_at: 2026-07-15T11:13:18 -->

# 提案（Proposal）：用户自助修改密码

> 变更：`2026-07-15-change-password` ｜ 关联 quicklog：ql-20260715-002-9c5b（默认密码方案）

## 背景

系统此前只有**管理员重置别人密码**（`POST /api/admin/users/{id}/reset-password` → `UserService.reset_password`），用户自己无法改密码。`auth` 模块现有端点 `login / refresh / logout / me / api-keys` 无 change-password；前端无个人中心/账户页（`(dashboard)/settings` 是平台级 API Keys/Git/MCP/Skills 配置）。

ql-20260715-002-9c5b 把新建用户改成固定默认密码 `SillyHub@123`，形成闭环缺口：用户拿到默认密码登录后无法自助改密，只能找管理员重置。

## 目标

补齐「用户自助修改密码」能力，闭环默认密码方案：登录用户可在个人中心修改自己密码（旧密码验证 + 新密码 + 确认），改密成功后保留当前会话、撤销其他设备会话。

## 方案概述（方案 A · 标准）

- **后端**（auth 模块）：新增 `POST /api/auth/change-password` + `AuthService.change_password`（verify 旧密码 → hash 新密码 → execute-only 撤销全部 session → AuditLog → 统一 commit）。新增 `PasswordIncorrect`(401) 错误。
- **前端**：新建个人中心页 `/account`（antd Form 修改密码表单）+ `lib/auth.ts changePassword` + 顶栏头像下拉「个人中心」入口。`api-types.ts` 由 gen-api-types 自动生成。
- 复用：`core.security.password_hasher`、`AuditLog`（workflow.model）、现有 `(dashboard)` 布局与前端样式系统。

## 范围

auth 模块（service/router/schema）+ core.errors（新增错误类）+ frontend_app（新页）+ frontend_components（顶栏入口）+ frontend_lib（auth.ts/api-types）。详见 design.md §5、§11。

## 非目标（YAGNI）

- 不做「默认密码/重置后首次登录强制改密码」（仅提示文案引导）
- 不做密码强度等级（大小写+数字+符号强制），仅 min_length=8
- 不做新密码禁止与旧密码相同
- 不做改密速率限制、密码历史

## 影响与风险

- 纯新增端点 + 页面，不改既有 login/refresh/logout 行为，无破坏性（design §12）。
- 主要风险 R-001：当前会话仅保留 access_token 有效期内（≤30min），用户已接受方案 A trade-off；R-002 未做强制改密码（提示引导）。详见 design.md §10。
