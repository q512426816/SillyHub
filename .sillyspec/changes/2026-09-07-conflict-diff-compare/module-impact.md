---
author: qinyi
created_at: 2026-09-07 14:05:00
---
# 模块影响分析（Module Impact）— 变更中心冲突对比弹窗 + quick 条目 ql 编号展示

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend:daemon-router | 修改 | compare 端点（GET sillyspec-conflicts/{change}/compare：RuntimeAdminUser + _get_owned_instance 越权 404 + change 白名单 + workspace 成员校验 + 504）+ DaemonHeartbeatSillySpecConflict 加可选 ql_id（零改写透传语义不变） |
| backend:daemon-compare-service | 新增 | sillyspec_compare.py：send_rpc 编排（显式 15s）+ 平台侧 spec_root/progress 读取（containment 校验）+ difflib 四分类与 diff_rows + 双截断护栏 + progress_rows 归一化 |
| backend:daemon-tests | 新增 | test_sillyspec_compare.py（权限三态/白名单/504/四分类/diff 对齐/截断/containment/ql_id 透传） |
| sillyhub-daemon:sillyspec-manager | 修改 | conflictSnapshot(change, kind)（双前缀冲突记录读取 + 文件快照 + progress envelope 过滤 + ql_id guard.json + local_updated_at）；collectStatusOnce 后处理 pending_conflicts 补 ql_id |
| sillyhub-daemon:daemon-core | 修改 | _registerSillySpecRpcHandler 注册 sillyspec_conflict_snapshot（挂 _registerExplorerRpcHandler 旁） |
| sillyhub-daemon:tests | 新增 | sillyspec-conflict-snapshot.test.ts（11 用例行为矩阵） |
| frontend:lib-daemon | 修改 | getSillySpecConflictCompare（apiFetch 先例） |
| frontend:changes-components | 修改+新增 | platform-sync-section.tsx 行改造（ql 标题/发生时间/按钮收敛）+ conflict-compare-modal.tsx 新增（时间条/文件清单/side-by-side diff/进度对比表/裁决条） |
| frontend:changes-tests | 新增+修改 | conflict-compare-modal.test.tsx 新增 + platform-sync-section.test.tsx 适配 |
| frontend:workspace-components | 修改 | changes-overview-card.tsx 只读清单 ql 标题 + 其测试文件 ql 分支单测 |
| docs（.sillyspec modules） | 修改 | sillyhub-daemon.md / backend.md 新契约条目 |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| backend/openapi.json、frontend/src/lib/api-types.ts | 生成物，task-05 跑 pnpm gen:types 再生成，不手改 |
| .sillyspec/.runtime/stage-reviews/* | 流程运行时产物（Design Grill / plan review 证据），不入模块映射 |

## 关联任务

W1 task-01/03（双端测试先行）→ W2 task-02/04（daemon/backend 实现）→ W3 task-05（类型生成）→ W4 task-06（前端测试）→ W5 task-07/08（弹窗+行改造）→ W6 task-09（三端全跑）→ W7 task-10/11（实机集成验收+模块文档）。

## 更新结果

| 目标 | 操作 | 状态 |
|---|---|---|
| （首版于 plan Wave 校验步生成；execute/verify 阶段更新，archive 终审） | — | — |
