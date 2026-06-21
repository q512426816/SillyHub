---
author: qinyi
created_at: 2026-06-22T00:50:00
---

# task-07: 测试 — 登录双查 + 迁移去重 + 前端跳转

## 目标
覆盖登录双查各分支、迁移前缀去重逻辑、前端平台选择跳转。

## 涉及文件
- backend/app/modules/auth/tests/（login 双查，新增或同级）
- backend 迁移测试（前缀去重）
- frontend 登录页测试（平台跳转）

## 实现要点
- 后端 login 双查用例：① email 登录成功 ② username 登录成功 ③ 账号不存在 ④ 密码错；均断言 token 或统一错误
- 大小写/空格用例：username `A` 与存储 `a` 应能登录
- 迁移前缀去重用例：构造两个 email 前缀同为 `a` 的用户，跑迁移后断言得到 `a`、`a2`；downgrade 后列消失
- 前端用例：渲染登录页，默认选中 SillyHub；切到 ppm 后登录成功断言 router 跳 `/ppm/projects`；反之跳 `/workspaces`；localStorage 持久回填
- 前端 mock `auth.login(account)` 调用参数

## 覆盖
FR-1, FR-2, FR-5, FR-6

## 验收
- 后端新增测试全部通过
- 迁移 upgrade/downgrade 测试通过
- 前端平台跳转测试通过
