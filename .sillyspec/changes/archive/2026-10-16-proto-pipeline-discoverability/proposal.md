---
author: flow-machine-draft
created_at: 2026-10-15T16:08:36.337Z
---
# 提案书（Proposal）— 2026-10-16-proto-pipeline-discoverability

## 动机

任务原话转写：可发现性缺口：PROTOTYPE.md 与 FRONTEND_PAGE_STYLE.md 只在 SillyHub 项目图 scan 面，multi-agent-platform 图 scan 面无原型管线指向，knowledge-search/server-logs 两会话据此误判项目无管线产手绘稿（用户裁决的两点堵法）。

成功标准：
- CONVENTIONS.md 新增「前端原型管线」节：pnpm prototype:build 入口、frontend/src/components/prototype/ 源目录、frontend/prototype-dist/ 产物目录、SillyHub 图 PROTOTYPE.md/FRONTEND_PAGE_STYLE.md 相对路径指引、frontend 触达的 UI 变更定稿原型必须走此管线（历史手绘原型是管线收编前旧物不构成惯例）
- local.yaml 顶层新增 ui_prototype: { form: real-code } 含管线位置注释
- sillyspec readUiPrototypeForm 实测解析该登记为 registered real-code
- 纯文档+配置零代码面

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. CONVENTIONS.md 新增「前端原型管线」节：pnpm prototype:build 入口、frontend/src/components/prototype/ 源目录、frontend/prototype-dist/ 产物目录、SillyHub 图 PROTOTYPE.md/FRONTEND_PAGE_STYLE.md 相对路径指引、frontend 触达的 UI 变更定稿原型必须走此管线（历史手绘原型是管线收编前旧物不构成惯例）
2. local.yaml 顶层新增 ui_prototype: { form: real-code } 含管线位置注释
3. sillyspec readUiPrototypeForm 实测解析该登记为 registered real-code
4. 纯文档+配置零代码面

## 成功标准（可验证）

1. CONVENTIONS.md 新增「前端原型管线」节：pnpm prototype:build 入口、frontend/src/components/prototype/ 源目录、frontend/prototype-dist/ 产物目录、SillyHub 图 PROTOTYPE.md/FRONTEND_PAGE_STYLE.md 相对路径指引、frontend 触达的 UI 变更定稿原型必须走此管线（历史手绘原型是管线收编前旧物不构成惯例）
2. local.yaml 顶层新增 ui_prototype: { form: real-code } 含管线位置注释
3. sillyspec readUiPrototypeForm 实测解析该登记为 registered real-code
4. 纯文档+配置零代码面
