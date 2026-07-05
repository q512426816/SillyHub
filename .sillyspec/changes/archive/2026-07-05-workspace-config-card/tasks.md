---
author: qinyi
created_at: 2026-07-05 01:12:09
change: 2026-07-05-workspace-config-card
stage: brainstorm
---

# Tasks — 工作区配置卡（WorkspaceConfigCard）

任务列表（细节在 plan 阶段展开为 Wave + 步骤 + allowed_paths + 测试用例）。

| ID | 任务名称 | 主要文件 | 覆盖 FR / D |
|---|---|---|---|
| T-01 | 新建 WorkspaceConfigCard 组件骨架 + Props 类型签名 + 6 状态分支框架（loading/error/未绑定/未初始化/已初始化/server-local） | `frontend/src/components/workspace-config-card.tsx` | FR-005 / FR-006 / D-005@V1 |
| T-02 | 实现「我的接入」组渲染（5 字段映射：daemon-chip/路径/路径来源/init 徽标/上次接入同步 + 「编辑我的接入」按钮） | `workspace-config-card.tsx` | FR-001 / FR-008 / D-001@V1 |
| T-03 | 实现「工作区文档存储」组渲染（7 字段映射：spec_root/runtime_root 派生/cache_root+tooltip/spec_version/sync_status 徽标/last_synced_at/strategy） | `workspace-config-card.tsx` | FR-001 / FR-004 / D-001@V1 / D-004@V1 |
| T-04 | 实现编辑入口就地展开（复用 WorkspaceAccessGuide 编辑模式 + 回填 + 保存调 upsertMyBinding + onRefresh + 收起） | `workspace-config-card.tsx` | FR-008 |
| T-05 | 实现未绑定首次引导（WorkspaceAccessGuide 首次模式）+ server-local 字段条件隐藏（daemon/cache_root）+ 说明文案 | `workspace-config-card.tsx` | FR-006 |
| T-06 | 操作按钮 handlers 等价迁入（handleInit/handleScan/handleSyncManual/handleImport/handleGenerateProjects + initPollRef/syncPollRef 轮询 + visibilitychange 暂停 + 5min 上限 + 409 重扫确认 + SSE onProgress + 卸载清理 + owner 门禁） | `workspace-config-card.tsx` | FR-007 |
| T-07 | 详情页 page.tsx 改造（删除第 598-825 行「规范管理」SectionCard + 配置 state/handlers/initPollRef/syncPollRef，替换为 `<WorkspaceConfigCard workspace={workspace} specWs={specWs} myBinding={myBinding} boundDaemon={boundDaemon} isOwner={isOwner} onRefresh={load} />`；保留 workspace/specWs/myBinding/boundDaemon/boundDaemonProviders/boundRuntime/componentCount/... 共享 state） | `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` | FR-003 / D-003@V1 |
| T-08 | 组件测试 workspace-config-card.test.tsx（六态分支 + 编辑流程就地展开/保存/收起 + server-local 隐藏 + cache_root tooltip 文案 + 各操作按钮行为含轮询/卸载清理/visibilitychange） | `frontend/src/components/workspace-config-card.test.tsx` | FR-006 / FR-007 / FR-008 / NFR-01 / NFR-03 |
| T-09 | 更新详情页现有测试 page.test.tsx（适配新卡片结构：断言无"规范管理"区 + `<WorkspaceConfigCard>` 渲染 + 其他区块行为不变） | `frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx` | FR-003 / NFR-05 |

## 依赖关系（粗）

- T-01 是 T-02 / T-03 / T-04 / T-05 / T-06 的基础
- T-07 依赖 T-01~T-06 完成（卡片可用后才能替换 page.tsx）
- T-08 与 T-01~T-06 同步写（TDD：先写测试覆盖每个状态/按钮行为，再实现）
- T-09 在 T-07 改造 page.tsx 后适配

## 不在任务范围

- 不新增 backend 任务（无 API / schema 改动）
- 不新增 daemon 任务（daemon 端不改）
- 不新增 migration 任务（无 DB 变更）

## 细节

Wave 分组 + 每任务步骤 + allowed_paths + 测试用例 + 验收点在 plan 阶段（`sillyspec run plan`）展开。
