---
author: qinyi
created_at: 2026-08-17 13:55:00
---

# 任务清单（Tasks）— 扫描统一到会话

- [ ] task-01: 后端 — start_scan_dispatch 的 AgentSession 补绑 workspace_id
- [ ] task-02: 后端 — scan_generate 返回 session_id（含早返回分支）+ router 端点回填
- [ ] task-03: 后端 — AgentSessionListItem 补 mode（agent/router 工作区组装点 + change/router 变更级组装点）
- [ ] task-04: 类型同步 — pnpm gen:types（api-types.ts + openapi.json）+ daemon.ts 手写 AgentSessionListItem 补 mode
- [ ] task-05: 前端 — 配置卡扫描成功后跳转会话页（router.push ?session=），移除内嵌运行面板
- [ ] task-06: 前端 — 会话页深链 attach（?session= 读取 + 竞态处理 + 未命中直接加载）
- [ ] task-07: 前端 — 会话列表扫描徽标（session-list-layout 补 kind + workspace-session-section 传值）
- [ ] task-08: 前端 — 移除智能体控制台（agent 页、page.tsx/components 页导航、menu-permissions 菜单组、use-agent-runs 及其测试）
- [ ] task-09: 测试适配与清理（后端解包三元组/mode 断言；前端 router.push/深链/徽标断言；menu-permissions/permission 测试清理；borrow-trigger-contract 保留）
- [ ] task-10: 全量验证（backend pytest 模块级 + frontend vitest + lint + typecheck + 死链 grep 复查）
