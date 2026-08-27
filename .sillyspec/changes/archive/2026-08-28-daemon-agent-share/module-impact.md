---
author: qinyi
created_at: 2026-08-28 01:23:10
---

# 模块影响分析（Module Impact）— 守护进程共享与平台共享智能体

> 首版（plan 审查步生成）。execute/verify 按实际代码变更回填「更新结果」，archive 终审。
> 映射依据：`.sillyspec/docs/backend/modules/_module-map.yaml`（backend 子模块粒度）+
> `.sillyspec/docs/multi-agent-platform/modules/_module-map.yaml`（根模块粒度）。

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend/daemon | 新增 + 修改 | 新增 grants 子包（model/queries/schema/service/router/tests：统一授权表 + shared-agents API）；修改 session/service.py（钉定校验扩授权 + platform 档案分支）、runtime/service.py 与 schema.py、router.py（shared_to_me 装配 + 路由挂载） |
| backend/agent | 修改 | placement.py（钉定复查授权分支 + 借用审计 grant_id）、borrow_resolver.py（数据源切 grants）、model.py（DaemonBorrowAudit 加 grant_id 列） |
| backend/workspace | 修改 | member_runtimes 三件（router/service/queries：开关端点双写 grants、借用查询薄壳委托） |
| backend/build（迁移） | 新增 | Alembic 新迁移：daemon_runtime_grants 建表（NULLS NOT DISTINCT）+ daemon_borrow_audit.grant_id + 存量 shared 迁移 |
| frontend | 新增 + 修改 | 新增 shared-machines-section / platform-shared-agents-card 组件；修改 runtimes/page.tsx、session-config-bar.tsx、floating-session-host.tsx、session-panel.tsx、lib/daemon.ts、use-daemon-machines.ts、api-types.ts（gen:types） |
| sillyhub-daemon | 无变化 | 零文件变更（allowed_roots 沙箱/工具白名单链路复用，D-009 收窄在后端 tool_config） |

## 未匹配文件

无（design §6 文件清单全部命中上述模块；backend/migrations 归入 backend/build 条目）。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `docs/backend/modules/daemon.md` | 已更新（grants 子域端点/表/钉定授权 D-012 语义） | done |
| `docs/backend/modules/agent.md` | 已更新（borrow_resolver 切 grants/审计 grant_id/platform_shared_tool_config） | done |
| `docs/backend/modules/workspace.md` | 已更新（member_runtimes 双写 grants/薄壳/grant_id 响应） | done |
| `docs/frontend/modules/*` 细粒度卡 ×5（components-daemon / app-pages / lib-daemon / lib-use-daemon-machines / components-sessions） | 已更新（两新组件/页面区块与统计/API 封装/hook sharedToMe/选择器徽标；首版「frontend.md」单行系笔误——前端为细粒度卡体系，无 frontend.md 大卡） | done |
| `sillyhub-daemon` 模块卡 | 更新（session-manager.ts 写守卫 overlay 增量，D-011） | done |
| `_module-map.yaml`（backend/frontend） | 无变化（未增删模块；grants 为 daemon 子包，不新增模块条目） | skipped |
