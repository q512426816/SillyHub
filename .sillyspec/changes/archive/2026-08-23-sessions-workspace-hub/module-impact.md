---
author: qinyi
created_at: 2026-08-23 05:00:00
---

# 模块影响分析（Module Impact）— 会话门户工作区中心化与预会话态

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| frontend/components-sessions | 修改（重） | session-list-panel.tsx 重构为两层筛选 tab+工作区分组手风琴+机器小节+owner chip（退役引擎胶囊/全局虚拟滚动/机器多选）；sessions-portal.tsx 双态接线+preContext 解析（迁入 resolveDefaultMachineId+LS_KEY）；新增 pre-session-picker.tsx；new-session-form.tsx 与 workspace-session-picker.tsx 退役删除；测试大改写+迁移 |
| frontend/components-daemon | 修改（中） | session-panel.tsx 预会话态（page 分支 null 同构空态+守卫清单+首句 createSession 链路，dialog 模式零改动）；runtime-session-helpers.tsx 零改动 |
| frontend/lib（daemon.ts/api-types.ts） | 修改（轻） | 列表 limit 参数收口；api-types.ts 随 gen:types 生成更新（owner_name） |
| frontend/app-sessions-pages | 修改（轻） | 三页面薄壳微调（change 页传 preContext；sessions 页面测试迁移预会话语义） |
| backend/modules-daemon | 修改（轻） | 列表端点 owner_name join users + limit le=500（router/schema/session-service 三文件+pytest） |
| sillyhub-daemon | 依赖变更 | 无（协议零变更，design §7.5） |

## 未匹配文件

无（design §6 全部路径落入上述模块）。

## 更新结果（verify/收尾阶段回填）

| 目标 | 操作 | 状态 |
|------|------|------|
| docs/frontend/modules/components-sessions.md | 已更新（task-08）：SessionListPanel 工作区树契约（两层筛选 tab/分组手风琴/机器小节/owner chip/保留能力/退役清单/组头＋回调/defaultExpandedWorkspaceId/change 平铺现状）、SessionsPortal 双态接线（三分支/浮层/深链/页头按钮/D-005 迁入）、新增 PreSessionPicker 条目、NewSessionForm/WorkspaceSessionPicker 标注退役删除 | done（2026-08-23） |
| docs/frontend/modules/components-daemon.md | 已更新（task-08）：SessionPanel 预会话态契约（sessionId=null 同构空态/preContext/onPreSessionCreated/null 守卫清单/首句失败保留输入/change 变更名查询）；测试清单补 session-panel-pre-session；SUPPORTED_SESSION_PROVIDERS 内联处改 pre-session-picker | done（2026-08-23） |
| backend daemon 模块文档 | 已更新（task-08）：列表端点 owner_name（IN 批量注入/null 兜底）+ limit le=500 | done（2026-08-23） |
| docs/frontend/modules/_module-map.yaml | 未增删模块；仅符号级更新 components-sessions.main_symbols（删 NewSessionForm，增 SessionsPortal/PreSessionPicker/resolveDefaultMachineId） | done（2026-08-23） |

回归证据见同目录 `regression-evidence.md`（backend 978 passed / frontend 1921 passed / typecheck 零错误 / lint 零新增警告）。
