---
author: qinyi
created_at: 2026-07-05 02:10:00
change: 2026-07-05-daemon-client-change-binding-fix
stage: archive
---

# Module Impact — daemon-client 写回流程对齐 daemon-entity-binding

> 本变更修复 daemon-entity-binding 在「写回任务队列」层的 4 处适配遗漏 + 抽共享解析。
> 模块映射基于文件路径推断（_module-map.yaml 不存在，模块文档基建待 scan 生成）。

## 影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| workspace/member_runtimes | 新增 + 逻辑变更 | queries.py（新）、resolver.py、tests/helpers_writeback.py（新）、tests/test_resolver.py（新） | 新增 queries.py 提取 placement 三查询为模块级共享；resolver 新增 resolve_runtime_for_writeback（写回链路共享解析，含 legacy fallback + NoOnlineDaemonError→DaemonClientNoActiveSession 转译）；新增 binding fixture + 六边界单测 | false |
| agent/placement | 调用关系变更 | placement.py | 三个私有查询方法（_query_daemon_online_by_id / _query_runtime_by_daemon_and_provider / _get_daemon_enabled_providers）改薄壳委托到 queries.py（DRY，派发语义零变更） | false |
| change_writer | 接口变更 + 逻辑变更 | proxy.py、router.py、schema.py、service.py、tests/test_proxy.py | D-002：ProxyCreateChangeRequest 删 runtime_id 字段、create_change 签名删 runtime_id；D-001：proxy_create_change 校验改调 resolve_runtime_for_writeback 现算 runtime（不再直读 workspace.daemon_runtime_id） | false |
| change | 接口变更 + 逻辑变更 | service.py、router.py、tests/test_files_router.py | D-001：write_file + _enqueue_edit_write 补 user_id 参数（调用链 router→service→_enqueue）；_enqueue_edit_write runtime_id 改调 resolve_runtime_for_writeback 现算 | false |
| spec_workspace | 逻辑变更 | router.py、tests/test_sync_manual.py | D-001：sync-manual daemon-client 分支 runtime_id 改调 resolve_runtime_for_writeback 现算（不再读 binding.runtime_id / ws.daemon_runtime_id）；分流条件不再依赖 runtime_id 非空，避免错走 server-local | false |
| daemon/runtime | 逻辑变更 | service.py、tests/test_runtime_admin_management.py、tests/test_lease_service.py | D-003：delete_runtime RESTRICT 检查改查 daemon_task_leases + daemon_change_writes 的 in-flight runtime_id（旧查 workspaces.daemon_runtime_id 新链路恒 NULL 失效）；保留软删 workspace SET NULL 清理（legacy FK） | false |
| frontend | 接口变更 | lib/changes.ts、lib/api-types.ts、create-change/page.tsx、__tests__/page.test.tsx | D-002：ProxyCreateChangeInput 删 runtime_id；page 简化（删客户端 daemon 在线校验，改由后端心跳兜底）；OpenAPI 重生成 | false |
| docs/契约 | 配置变更 | backend/openapi.json | proxy-create 请求体删 runtime_id 字段，OpenAPI schema 同步 | false |

## 未匹配文件

无（所有文件均按 backend/frontend 顶层模块路径映射）。

## 三重交叉验证

- **声明范围**（design §4/§5）：change_writer/proxy.py、change_writer/router.py、change_writer/service.py、change/service.py、change/router.py、spec_workspace/router.py、daemon/runtime/service.py、frontend × 3 —— 与 tasks 一致。
- **任务范围**（plan.md task-01~08 allowed_paths）：覆盖上述 + 新增 queries.py / resolver 函数 / test_resolver.py / helpers_writeback.py。
- **真实变更**（git diff a14c45c5..HEAD，23 文件）：与声明 + 任务范围一致，无遗漏、无多余。
- **以 git diff 为准**：真实 = 声明 = 任务，三者闭环。

## 备注

- _module-map.yaml 缺失（specDir 未跑过 scan 生成模块映射）；本表按 `backend/app/modules/<module>/` + `frontend/src/` 路径推断模块归属。
- daemon-entity-binding 的 module-impact 未引用（本变更是其后继修复，模块文档已在彼变更归档时同步）。
