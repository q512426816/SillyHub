---
author: qinyi
created_at: 2026-08-29 20:52:40
---
# 模块影响分析（Module Impact）— 审批流站内通知推送

> 输入：design.md §6 文件变更清单 + plan.md 任务总表（TaskCard 未生成，粒度与 archive 口径一致）。
> 映射源：`.sillyspec/docs/backend/modules/_module-map.yaml`（backend 细粒度）+ `.sillyspec/docs/multi-agent-platform/modules/_module-map.yaml`（顶层）。

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend/notification（新模块，映射待建） | 新增 | model/schema/service/events/router/tests 全套 + Alembic 迁移；`_module-map.yaml` 需 execute 后补 notification 条目（task-12 一并处理 local.yaml 测试映射时同步） |
| backend/auth | 修改 | rbac.py 新增 list_user_ids_with_permission 反查（镜像 has_permission 三段语义）；新建 tests/modules/auth 用例（模块原无 tests 目录，task-03） |
| backend/platform_sync | 修改 | service.py upsert_progress 尾部新增待办产生旁路钩子（in-hand latest_progress 判定，best-effort）；既有 progress/_pk/router 测试回归（task-04/task-12） |
| backend/change | 修改 | service.py 四门 + approve/reject 末尾新增结果通知与待办消解（_maybe_notify_session 同层）；既有 review/approval_notify_session/step_progress 测试回归（task-05/task-12） |
| backend/daemon | 修改 | permission_service.py handle_permission_request/_on_timeout 挂 owner 定向通知（owner=AgentSession.user_id）；既有 session_permissions/permission_http_uplink 测试回归（task-06/task-12） |
| backend（main.py / migrations/env.py） | 修改 | include_router 注册 notification 路由；env.py 模型登记清单加行（漏=迁移不生成表） |
| frontend | 修改 | 新增 lib/notifications.ts、components/notifications/notification-bell.tsx（+tests）；修改 top-bar.tsx（挂铃铛）、lib/query-keys.ts、api-types.ts（gen:types 产物）；top-bar.test.tsx 回归（task-09~13） |
| sillyspec（.sillyspec/local.yaml） | 依赖变更 | modules 块补 notification 子模块测试映射（verify 模块对账防 fallback 全量；gitignored 落主仓） |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| backend/openapi.json + frontend/src/lib/api-types.ts | gen:types 生成产物（非手写源码），归 frontend/backend 模块 gen 流程（task-09），不单独映射 |
| prototype-notification-bell.html | 变更目录内设计原型，非运行时代码，无需模块映射 |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `docs/backend/modules/notification.md` | 已新增 notification 模块卡（定位/契约摘要/触发点/注意事项） | done |
| `docs/backend/modules/_module-map.yaml` | 已补 notification 条目（paths/entrypoints/main_symbols/depends_on/used_by） | done |
| `docs/backend/modules/auth.changelog.md` | list_user_ids_with_permission 变更索引（sidecar，不堆卡正文） | done |
| `modules/frontend.changelog.md`（顶层） | 通知铃铛与数据层变更索引（sidecar） | done |
| `docs/backend/modules/{platform_sync,change,daemon}.changelog.md` | 三触发点钩子变更索引（sidecar） | done |
| `_module-map.yaml`（顶层 multi-agent-platform） | 无变化（backend/frontend 子项目粒度未变） | skipped |
