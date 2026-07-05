---
author: qinyi
created_at: 2026-07-05 02:05:00
change: 2026-07-05-workspace-config-card
stage: archive
---

# 模块影响分析 — 工作区配置卡

## 变更范围三重交叉验证

| 来源 | 文件列表 |
|---|---|
| 声明范围（design §6 文件清单） | workspace-config-card.tsx(新) + workspace-config-card.test.tsx(新) + page.tsx(改) + page.test.tsx(改) |
| 任务范围（plan.md task-01~09） | 同上（task-01~06/08 → workspace-config-card.tsx/test.tsx；task-07/09 → page.tsx/test.tsx） |
| 真实变更（git diff HEAD + status） | M page.test.tsx + M page.tsx + ?? workspace-config-card.tsx + ?? workspace-config-card.test.tsx |

**三重一致 ✅**（以 git diff 为准，4 frontend 文件）。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| frontend | 逻辑变更 + 新增 | `frontend/src/components/workspace-config-card.tsx` (新 803 行) | 新建 WorkspaceConfigCard 单组件：Props(workspace/specWs/myBinding/boundDaemon/isOwner/onRefresh/componentCount?) + 6 状态分支(loading/error/未绑定/已绑定未初始化/已绑定已初始化/server-local) + 「我的接入」组(5 字段+编辑入口) + 「工作区文档存储」组(6 字段，**R-07 不展示 spec_version**) + 5 handlers 等价迁入(initPollRef/syncPollRef/visibilitychange/5min/409/SSE/卸载清理) | false |
| frontend | 逻辑变更 | `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` (848→320 行 -528) | 删除"规范管理"SectionCard + 配置 state/handlers/initPollRef/syncPollRef，替换为 `<WorkspaceConfigCard>` 7 props；保留共享 state(workspace/specWs/myBinding/boundDaemon/boundDaemonProviders/boundRuntime/componentCount/...) + 其他区块(基本信息/默认智能体/Overview/Quick nav)行为不变 | false |
| frontend | 新增 | `frontend/src/components/workspace-config-card.test.tsx` (新 627 行) | 组件测试 18 用例：六态分支 + 编辑就地展开/保存/收起 + cache_root tooltip 三平台 + 操作按钮(initPollRef/syncPollRef/visibilitychange/5min/409/unmount) | false |
| frontend | 逻辑变更 | `frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx` (593→308 行) | 删 16 迁入卡片的 case + 加 5 接线断言 + vi.mock WorkspaceConfigCard；保留 default_agent × 3 回归守护 | false |

## 未匹配文件

无（4 文件全匹配 frontend 模块）。

注：worktree 的 `.sillyspec/changes/2026-07-05-workspace-config-card/`（sillyspec 元数据，非源码）+ `meta.json`（sillyspec worktree meta）不算变更文件，归档不纳入。

## 模块文档同步建议

`frontend.md`（daemon specDir `docs/multi-agent-platform/modules/frontend.md`）建议补充：
- 工作区详情页"规范管理（Spec Workspace）"区已升级为 `WorkspaceConfigCard` 组件（per-member「我的接入」可编辑组 + 共享「工作区文档存储」只读组）
- 详情页 page.tsx 从 848 行精简到 320 行（配置逻辑迁入卡片，减载 528 行）
- 新增组件入口：`components/workspace-config-card.tsx`（自包含，接收 workspace/specWs/myBinding/boundDaemon/isOwner/onRefresh/componentCount? props）
- `WorkspaceConfigCard` 内部承载 5 操作按钮 handlers（init/scan/sync/import/generateProjects，从 page.tsx 等价迁入，含轮询/状态机）
- 不展示工作区级 spec_version（frontend 类型 + backend SpecWorkspaceRead schema 均无此字段，workspace-config-flow task-09 遗漏，R-07），版本仅 myBinding.init_synced_spec_version

## 不涉及的模块

- backend：无（纯前端变更，所需 API `GET /my-binding` + `GET /spec-workspace` 已存在）
- sillyhub-daemon：无（不读 daemon 写的 .sillyspec-platform.json，信息由 DB 字段覆盖）
- deploy / ci / build：无（无配置/构建/CI 改动）
