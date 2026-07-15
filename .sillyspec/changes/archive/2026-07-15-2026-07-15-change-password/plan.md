<!-- author: WhaleFall -->
<!-- created_at: 2026-07-15T11:21:45 -->

# 实现计划（Plan）：用户自助修改密码

> 变更：`2026-07-15-change-password` ｜ plan_level = **full** ｜ 依据：design.md（§5 技术方案 / §13 文件变更清单 / §9 AC）

## Wave 分组与依赖

### Wave 1 — 后端契约基础（并行）
- [x] task-01: `core/errors.py` 新增 `PasswordIncorrect`(401) AppError 子类并导出
- [x] task-02: `auth/schema.py` 新增 `ChangePasswordRequest{old_password, new_password(min 8)}` 并 `__all__` 导出

### Wave 2 — 后端 service + router（串行，依赖 Wave 1）
- [x] task-03: `auth/service.py` 新增 `AuthService.change_password`（verify 旧密码 → hash 新密码 → execute-only 撤销 session → AuditLog → 统一 commit）—— 依赖 task-01
- [x] task-04: `auth/router.py` 新增 `POST /api/auth/change-password`(204) —— 依赖 task-02、task-03

### Wave 3 — 后端测试（依赖 Wave 2）
- [x] task-05: `tests/modules/auth/test_change_password.py` 覆盖 AC-01~07 —— 依赖 task-03、task-04

### Wave 4 — 前端 API 层（依赖 Wave 2 后端端点就绪）
- [x] task-06: 跑 `gen-api-types.mjs` 重新生成 `api-types.ts` + `lib/auth.ts` 新增 `changePassword` —— 依赖 task-04

### Wave 5 — 前端页面 + 入口（依赖 Wave 4）
- [x] task-07: 新建 `(dashboard)/account/page.tsx` 个人中心页（antd Form 修改密码表单）—— 依赖 task-06
- [x] task-08: `top-bar.tsx` 顶栏头像下拉加「个人中心」入口 + 确认 `/account` 路由白名单 —— 依赖 task-07（链接目标）

### Wave 6 — 前端测试 + 联调（依赖 Wave 5）
- [x] task-09: `account/page.test.tsx` 表单组件测试（校验/提交/错误展示，AC-08）—— 依赖 task-07
- [x] task-10: 联调验证（对照 AC-01~09：改密成功/旧密码错/其他会话撤销/审计）—— 依赖全部

## 任务总表

| 任务 | 描述 | 优先级 | 依赖 | allowed_paths |
|---|---|---|---|---|
| task-01 | 新增 PasswordIncorrect 错误类 | high | — | backend/app/core/errors.py |
| task-02 | 新增 ChangePasswordRequest schema | high | — | backend/app/modules/auth/schema.py |
| task-03 | AuthService.change_password 方法 | high | task-01 | backend/app/modules/auth/service.py |
| task-04 | POST /change-password 端点 | high | task-02, task-03 | backend/app/modules/auth/router.py |
| task-05 | 后端 change_password 测试 | high | task-03, task-04 | backend/tests/modules/auth/test_change_password.py |
| task-06 | 前端 api-types 重新生成 + changePassword | high | task-04 | frontend/src/lib/api-types.ts, frontend/src/lib/auth.ts |
| task-07 | 个人中心页 /account | high | task-06 | frontend/src/app/(dashboard)/account/page.tsx |
| task-08 | 顶栏入口 + 路由白名单 | medium | task-07 | frontend/src/components/top-bar.tsx, frontend/src/app/(dashboard)/layout.tsx(白名单确认) |
| task-09 | account 页表单测试 | medium | task-07 | frontend/src/app/(dashboard)/account/page.test.tsx |
| task-10 | 联调验证 | high | task-05, task-09 | （验证，对照 AC） |

## 关键路径

task-01 → task-03 → task-04 → task-06 → task-07 → task-09 → task-10

（task-02 与 task-01 并行先就绪供 task-04；task-05/task-08 在各自 Wave 内紧跟前置）

## 跨任务契约自检

- **provider task-04**（POST /change-password）承诺：请求体 `ChangePasswordRequest{old_password:str, new_password:str(min8)}`（task-02 定义）、响应 204、错误 401 `HTTP_401_PASSWORD_INCORRECT`（task-01 定义）。
- **consumer task-06**（changePassword）依赖：上述请求体字段 + 响应码；经 `gen-api-types.mjs` 从后端 OpenAPI 自动生成 TS 类型，字段一致性由生成器保证。
- **consumer task-07**（account 页）依赖：`changePassword(old, new)`（task-06 提供）+ 错误 401 展示。字段 old_password/new_password 两边一致。

## 文件覆盖自检（对照 design.md §13）

| design.md §13 文件 | 覆盖 task |
|---|---|
| backend/app/core/errors.py | task-01 ✓ |
| backend/app/modules/auth/schema.py | task-02 ✓ |
| backend/app/modules/auth/service.py | task-03 ✓ |
| backend/app/modules/auth/router.py | task-04 ✓ |
| backend/tests/modules/auth/test_change_password.py | task-05 ✓ |
| frontend/src/app/(dashboard)/account/page.tsx | task-07 ✓ |
| frontend/src/lib/auth.ts | task-06 ✓ |
| frontend/src/lib/api-types.ts | task-06 ✓（自动生成） |
| frontend/src/components/top-bar.tsx | task-08 ✓ |
| frontend/src/app/(dashboard)/account/page.test.tsx | task-09 ✓ |

所有 design.md §13 源码文件均被至少一个 task 覆盖，无遗漏。

## 决策覆盖矩阵（D-xxx@vN → task）

| 决策 | 覆盖 task |
|---|---|
| D-001 旧密码错 401 PasswordIncorrect | task-01, task-03, task-05(AC-02) |
| D-002 body 只收 old+new | task-02, task-06 |
| D-003 新密码 min8 允许新=旧 | task-02, task-07 |
| D-004 execute-only 撤销 + 统一 commit | task-03, task-05(AC-06) |
| D-005 审计 user.password_change | task-03, task-05(AC-07) |
| D-006 已认证即可改 | task-04, task-05(AC-04) |

无 P0/P1 unresolved blocker（X-001 已在 design 修正）。

## 全局验收标准（对照 design.md §9 AC-01~09）

1. 后端：`POST /api/auth/change-password` 正确 token + 旧密码 + 合法新密码 → 204，password_hash 已更新（AC-01）。
2. 后端：旧密码错 → 401 `HTTP_401_PASSWORD_INCORRECT`（AC-02）；新密码 <8 → 422（AC-03）；未带 token → 401（AC-04）。
3. 后端：改密后旧密码登录 → 401（AC-05）；其他设备 refresh 失效 + 当前 access_token 30min 内可用（AC-06）；审计 user.password_change（AC-07）。
4. 前端：/account 表单校验（新≥8、新=确认）+ 成功提示 + 旧密码错展示（AC-08）；顶栏下拉「个人中心」入口跳 /account（AC-09）。
5. 兼容性（brownfield）：纯新增端点 + 页面，不改 login/refresh/logout 既有行为；ruff/mypy/tsc/vitest/pytest 全绿；回退只需删除新增物。

## 调用点搜索（task-04 端点新增 / task-06 前端类型）

- 后端：`POST /api/auth/change-password` 为全新端点，无既有调用点；`ChangePasswordRequest` 为新 schema，仅在 task-04 router 引用。
- 前端：`changePassword` 为新函数，仅 task-07 account 页调用；`api-types.ts` 由生成器全量重生，无手动调用点。
- 搜索命令记录：`grep -rn "change-password\|changePassword\|ChangePasswordRequest" backend/app frontend/src` → execute task-04/06 前确认无遗漏引用。
