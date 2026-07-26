---
author: qinyi
created_at: 2026-07-27 00:09:32
change: 2026-07-26-ungate-workspace-entry
---

# 模块影响分析（Module Impact）— 工作区入口门禁后移

## 概述

本变更为**纯前端 UX 改造**：把「绑定 daemon」从工作区进门闸降级为可选配置，daemon 要求下沉到真正依赖它的操作点（runtime / scan-docs 读源码页），无 binding 时内联空态（DaemonRequiredNotice）。无后端 / 无 schema / 无 API / 无 daemon 协议变更（design §8 + §7.5 生命周期豁免）。

## 三重交叉验证（以 git diff 为准）

| 来源 | 范围 |
|---|---|
| 声明范围（design §6 文件清单） | 8 源码改 + 2 新建（frontend） |
| 任务范围（plan.md task-01~10） | 同 design §6，task-08 components 合理跳过、task-09 复用既有零改动 |
| 真实变更（git diff + untracked） | 10 个 frontend 源码/测试文件 + docs/sillyspec 坑文档 + .claude/CLAUDE.md + 本变更 .sillyspec spec |

三者一致：所有代码改动落在 `frontend/**`（task-08 components/page.tsx 经 spike-01 证 daemon 无关不接入，task-09 概览 page.tsx 复用既有零改动，均符合 design/plan 声明）。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| frontend | 逻辑变更 | `frontend/src/app/(dashboard)/workspaces/page.tsx` | `handleActivate` 移除未绑定→Dialog 分支，always `router.push`；删 `bindingTarget` state + 列表页 `WorkspaceBindingDialog` 进门用法 + ql-004 入口 `canBorrow` 判定 | false |
| frontend | 逻辑变更 | `frontend/src/components/workspace-switcher.tsx` | `handleClickEntry` always `switchWorkspace`；删 `bindingTargetId` + 顶栏 Dialog + `canBorrow` + 未用 import | false |
| frontend | 逻辑变更 | `frontend/src/app/m/workspaces/page.tsx` | 移动端 `handleActivate` always 提示电脑端；删 `bindingTarget`/Dialog/`canBorrow` + 卡片未绑定引导文案 | false |
| frontend | 逻辑变更 | `frontend/src/components/workspace-binding-guard.tsx` | `unbound` → `return null`（不再渲染绑定表单阻断）；已绑定保留「编辑我的接入配置」入口；删 `canBorrow`/`useSession` 未用 import | false |
| frontend | 新增 | `frontend/src/components/daemon-required-notice.tsx` | 新组件 DaemonRequiredNotice（feature/workspaceId/canBorrow/onConfigured 契约，复用 WorkspaceAccessGuide，内联非阻断） | false |
| frontend | 新增 | `frontend/src/components/daemon-required-notice.test.tsx` | 新组件 4 单测（渲染/canBorrow 借用提示/配置展开+回调） | false |
| frontend | 逻辑变更 | `frontend/src/app/(dashboard)/workspaces/[id]/runtime/page.tsx` | `fetchMyBinding` 判定前置；无 binding 主区渲染 DaemonRequiredNotice；有 binding 走原运行时（零回归） | false |
| frontend | 逻辑变更 | `frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx` | 同 runtime，binding 判定前置 + 无 binding 空态 + 有 binding 原 reparse/扫描树 | false |
| frontend | 逻辑变更 | `frontend/src/app/(dashboard)/workspaces/__tests__/page.test.tsx` | CB-1 改判未绑定→router.push；删 AC-5 onBound 用例 | false |
| frontend | 逻辑变更 | `frontend/src/components/__tests__/workspace-switcher.test.tsx` | 改判未绑定→switchWorkspace；删 onBound；加 canBorrowSharedDaemon 不被调用断言 | false |

影响类型汇总：**逻辑变更 ×8 + 新增 ×2**，全部落在 frontend 模块，影响明确（needs_review 全 false）。

## 未匹配文件

| 文件 | 归类 | 说明 |
|---|---|---|
| `docs/sillyspec/execute-worktree-assess-baseline-drift-by-metadata.md` | sillyspec 工具坑文档 | execute 阶段记录的 sillyspec 工具缺陷，非本变更代码模块（CLAUDE.md 规则15 活跃坑） |
| `docs/sillyspec/execute-worktree-pnpm-monorepo-no-node-modules.md` | sillyspec 工具坑文档 | 同上，execute worktree 坑记录 |
| `.claude/CLAUDE.md` | 项目规则 | 规则 11 混入「PPM 模块已上线」备注，**与本变更无关**，建议提交时分离（独立 commit 或确认归属） |
| `.sillyspec/changes/2026-07-26-ungate-workspace-entry/*` | 本变更 spec | design/plan/tasks/verify-result/verify-required-evidence/prototype，归档对象自身 |

## 模块文档同步建议

- `frontend` 模块卡片（`.sillyspec/docs/multi-agent-platform/modules/frontend.md`）：建议在「变更索引」追加本变更条目（ungate-workspace-entry：门禁后移 + DaemonRequiredNotice 统一空态，4 入口 + runtime/scan-docs 接入，纯前端零回归），needs_review 保持 false（变更性质明确，契约/数据模型未变）。
- `_module-map.yaml`：frontend 模块 paths/entrypoints 无需改动（未新增路由或顶层入口，仅改既有页面行为 + 新增一个非路由组件）。

## 结论

单模块（frontend）纯逻辑变更，无跨模块契约影响，无 schema/API/后端变更。e2e 已双账号（180072 无 binding + admin 已 binding）验证 6 条 evidence 全 satisfied，零回归。
