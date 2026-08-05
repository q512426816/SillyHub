---
author: qinyi
created_at: 2026-08-04 16:30:00
status: 已甄别（非 SillySpec 工具缺陷，归 multi-agent-platform 项目方处理）
---

# 活跃坑（2026-08-04-agent-profile-ui-redesign 归档记录）

> **2026-08-05 甄别**：以下 3 个坑均为 multi-agent-platform **项目自身**问题（前端 antd/jsdom 测试环境、deploy skill 文档/后端 schema、docker 部署运维），**非 SillySpec 工具缺陷**——SillySpec 作为流程控制器无法修这些。甄别归类完成，移 finished；根治归 multi-agent-platform 项目方。

## 🟡 antd v6 Form `:has` 规则 + jsdom nwsapi SyntaxError

- **现象**：表单测试在 jsdom 打开 Select 下拉时，antd v6 Form 的 `:has(> .ant-switch:only-child…)` 规则 + 表单左栏 tailwind 任意值类 `max-h-[68vh]`（未引号转义）生成非法选择器 → nwsapi 抛 SyntaxError 致测试失败。
- **根因**：纯 jsdom 缺陷（真实浏览器用原生 CSS 引擎不受影响）。jsdom cssom 用真实 DOM className 拼选择器，任意值类未转义。
- **规避**：表单测试文件 stub `window.getComputedStyle` 阻断 cascade（等价 setup.ts 的 matchMedia/ResizeObserver polyfill）。
- **状态**：活跃（待测试工具/项目统一处理）。

## 🟡 deploy skill 登录 schema 用 `account` 非 `email`

- **现象**：deploy skill 文档写登录 body `{"email":…, "password":…}`，实际后端 `/api/auth/login` schema 是 `{"account":…, "password":…}`（`email` 字段 → 422 `missing account`）。
- **影响**：按 skill 文档登录失败（422），排查才定位。
- **规避**：登录 body 用 `account` 字段。
- **状态**：活跃（待 deploy skill 文档修正或后端兼容 email）。

## 🟡 全 Docker 部署 backend/frontend 同时重建时，frontend 代理 backend ECONNREFUSED

- **现象**：`docker compose up --build --force-recreate frontend backend` 时，frontend 先起连不上未就绪的 backend，Next 代理连接池缓存失败连接 → 后续所有 `/api/*` 500 ECONNREFUSED（容器内 node 直连却通）。
- **规避**：`docker compose restart frontend` 清连接池；或先起 backend 等 healthy 再起 frontend。
- **状态**：活跃（部署运维坑）。
