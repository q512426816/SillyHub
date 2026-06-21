---
author: qinyi
created_at: 2026-06-22T00:50:00
---

# task-06: 前端登录页 — 邮箱/账号输入 + 平台选择 + 跳转

## 目标
登录输入框支持邮箱或账号，新增 antd `Segmented` 平台选择（默认 SillyHub、localStorage 持久），登录成功按选择跳转。

## 涉及文件
- frontend/src/app/(auth)/login/page.tsx
- frontend/src/lib/auth.ts

## 实现要点
- 登录页输入框 label 改「邮箱/账号」；去 `type="email"` 与对应邮箱格式校验，仅保留 required
- 新增 antd `Segmented`，选项「项目管理平台」/「SillyHub」，值 `ppm` / `sillyhub`，默认 `sillyhub`
- 选中值写 `localStorage`（如 `login_platform`），挂载时回填
- 登录成功后按平台跳转：`ppm` → `/ppm/projects`，`sillyhub` → `/workspaces`
- `auth.ts`：`login(email, …)` → `login(account, …)`；请求体字段名同步改 `account`
- 记住我缓存键从 `email` 改 `account`（读取/写入处同步）

## 覆盖
FR-5, FR-6, D-004@V1

## 验收
- 邮箱与账号两种输入均能登录
- 切换平台选择后刷新页面仍保留上次选择
- 选「项目管理平台」登录成功跳 `/ppm/projects`；选「SillyHub」跳 `/workspaces`
- 前端 tsc / lint 通过
