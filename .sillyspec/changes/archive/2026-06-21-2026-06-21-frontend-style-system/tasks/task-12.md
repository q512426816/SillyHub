---
id: task-12
title: tsc + Docker rebuild 实测核心页 + 截图对比原型
change: 2026-06-21-frontend-style-system
status: pending
priority: P0
depends_on: [task-11]
blocks: []
covers: [验收]
allowed_paths:
  - frontend/package.json
  - frontend/Dockerfile
created_at: 2026-06-22T00:18:09
author: qinyi
---

## 目标

前端样式系统重设计的最终验收关卡：在真实构建链路（tsc → next build → Docker 镜像 → 容器运行）下确认零编译错误、核心页 200 渲染、视觉风格与原型一致，无功能回归。

本任务为纯验证任务，原则上不修改源码；如需微调 lint/build 配置（如放宽 next.config、eslint 规则）才触及 `frontend/package.json` 或 `frontend/Dockerfile`。

## 背景 / 依据

- 文档依据：本变更 `design.md`、`prototype-frontend-style-system.html`（视觉基准）
- memory `docker-backend-no-hot-reload`：Docker 容器跑镜像内代码、不热重载 → 改完前端源码必须 `docker compose build frontend` 再 `up`，否则实测的是旧镜像
- memory `docker-frontend-healthcheck-proxy`：frontend 容器 healthcheck `unhealthy` 是探针误报（busybox wget 走 Docker 注入的 http_proxy、忽略 no_proxy），服务实际正常 → 以 `curl`/浏览器实际响应为唯一判据，不被 healthcheck 状态误导
- 构建方式（已读 `frontend/package.json` + `frontend/Dockerfile`）：
  - 包管理器 pnpm（`packageManager: pnpm@9.6.0`）
  - typecheck 脚本：`tsc --noEmit`
  - build 脚本：`next build`（Dockerfile 第 39 行 `pnpm build`，输出 standalone）
  - Dockerfile 多阶段：deps → builder(`next build`) → runtime(node server.js)，EXPOSE 3000
  - healthcheck（第 65-66 行）：`wget -qO- http://127.0.0.1:3000`（即被代理污染的探针）

## 验证步骤

1. **tsc 零错误**
   ```bash
   cd frontend && pnpm typecheck   # = npx tsc --noEmit
   ```
   期望：0 error。任一报错 → 回到对应 task 修复，不放过。

2. **next build 成功**
   ```bash
   cd frontend && pnpm build       # = next build
   ```
   期望：构建成功（生成 `.next/standalone`）。失败 → 定位是 TS/导入/CSS 问题，回到对应 task。

3. **Docker rebuild frontend 镜像**
   ```bash
   docker compose build frontend
   docker compose up -d
   ```
   依据 memory：不 rebuild 实测的是旧代码。rebuild 失败 → 查 Dockerfile/构建参数。

4. **核心页实测（至少 4 个）**
   ```bash
   curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/login
   curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/ppm/kanban
   curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/ppm/project-plans
   curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/workspaces
   ```
   期望：全部 200。浏览器打开目视确认渲染（非白屏、非报错页）。

   注意：忽略 `docker ps` 里 frontend 的 `unhealthy` 状态（healthcheck 代理误报，见背景），以 curl + 浏览器为准。

5. **截图对比原型**
   - 用浏览器对 4 个核心页截图
   - 并排对照 `prototype-frontend-style-system.html`（用浏览器打开该文件截图）
   - 对比维度（不求像素级一致）：
     - 配色统一（主色/背景/卡片色是否与原型一致）
     - 状态色（success/warning/danger 是否符合设计 token）
     - 圆角（卡片/按钮圆角风格）
     - 字体（字号层级、行高节奏）
   - 偏差记录到本任务 "验收记录"，必要时回到对应 task 修样式。

## 边界

1. **healthcheck unhealthy ≠ 服务挂**：代理误报，以 curl/浏览器实际响应为准，禁止因 `docker ps` 显示 unhealthy 就回滚。
2. **tsc/build 任一失败必追根**：不允许 `// @ts-ignore`/`any`/放宽 tsconfig 敷衍绕过，回到对应 task 修真实问题。
3. **截图对比看风格不看像素**：重点配色/状态色/圆角/字体一致性，不要求与原型像素级 1:1；刻意放过轻微间距差。
4. **核心页至少实测 4 个**：login + kanban + project-plans + workspaces 为最低线，少一个不算通过。
5. **发现功能回归必记录并修**：样式改动导致按钮点击失效/表单提交失败/路由跳转异常等 → 记录到 "回归清单"，回到对应 task 修，不在本任务直接改业务代码。

## 非目标

- 不做完整 E2E（Playwright 全量用例不在本任务）
- 不做性能基准（Lighthouse / 首屏时间 / bundle size 分析）
- 不做跨浏览器测试（仅 Chrome/Edge 一档）

## 验收表格

| AC ID | 验收项 | 期望 | 实测 | 结果 |
|-------|--------|------|------|------|
| AC-01 | `tsc --noEmit` | 0 error | | |
| AC-02 | `pnpm build`（next build） | 成功，产出 standalone | | |
| AC-03 | Docker rebuild + 核心页 curl | build 成功且 4 个核心页 200 | | |
| AC-04 | 截图 vs 原型 | 配色/状态色/圆角/字体一致 | | |
| AC-05 | 功能回归 | 无（按钮/表单/路由正常） | | |

## 回归清单（发现时填）

| 页面 | 回归现象 | 根因 task | 状态 |
|------|----------|-----------|------|
|      |          |           |      |

## 验收记录（执行时填）

- tsc 输出摘要：
- build 输出摘要：
- docker compose build frontend 结果：
- 核心页 curl 状态码：login= kanban= project-plans= workspaces=
- 截图对比结论：
