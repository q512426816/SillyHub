---
author: qinyi
created_at: 2026-08-26 14:05:00
---
# 任务清单（Tasks）

- [x] task-01: 后端 PUT `/workspaces/{id}/mcp-config` 写接口（pydantic 校验 + `<set>` 还原 + 原子写 + 审计）(depends_on: —)
- [x] task-02: 后端写接口测试（权限/校验/secret 还原/原子写/审计/中文报错）(depends_on: task-01)
- [x] task-03: 后端 daemon API 扩展（`workspace_id` 参数 + raw 不脱敏读法 + 兼容回归测试）(depends_on: —)
- [x] task-04: 前端类型重生成（`pnpm gen:types` + 提交 api-types.ts / openapi.json）(depends_on: task-01, task-03)
- [x] task-05: daemon `fetchMcpBundle`（三件套拉取 + 非 stdio 预净化 + 回落）及测试 (depends_on: task-03)
- [x] task-06: 验证工作区会话 workspaceId 下发覆盖率（D-008 前置，缺则 backend 补齐）(depends_on: —)
- [x] task-07: daemon 预取挂点（daemon.ts `_startInteractiveSession`）+ 会话级缓存 + provider 合并注入（内置名入白名单参数 + rejected warn）+ 注释修正 (depends_on: task-05, task-06)
- [x] task-08: daemon 注入链路测试（合并优先级/白名单剔除/回落/restore 缓存）(depends_on: task-07)
- [x] task-09: 前端 mutation 与缓存失效（workspace-skills-view.ts + queryKeys）(depends_on: task-04)
- [x] task-10: 前端页面双态改造（编辑态 textarea + zod 校验 + 提示文案，对照原型）及测试 (depends_on: task-09)
