---
id: task-09
title: 全量验证 lint/typecheck/test + grep 确认 + 后端零改动确认
priority: P0
estimated_hours: 2
depends_on: [task-08]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07]
decision_ids: []
allowed_paths: []
author: qinyi
created_at: 2026-06-22T11:24:44+08:00
---

# task-09 — 全量验证 lint/typecheck/test + grep 确认 + 后端零改动确认

> 变更：`2026-06-22-unify-agent-run-sse-hook`（Wave 4 收尾）
> 类型：**纯验证任务**，不新增/不修改任何代码文件（`allowed_paths: []`）。
> 仅当本任务验证发现回归时，才回退到对应前序 task 修复（见"边界处理"）。

## 修改文件

无。本任务为验证任务，零代码改动。所有路径仅在测试失败时回退到前序 task 在其自身 `allowed_paths` 内修复。

## 覆盖来源

- **design.md**：§13 Design Grill（Step12 交叉审查，status passed，无 P0/P1）；§5.2 Wave 4 范围（"删 streamAgentRunLogs + 清理 import，全量验证"）；§10 风险登记 R-04（删后漏改调用方 → `pnpm typecheck` 兜底）。
- **plan.md**：全局验收标准 9 条（`## 全局验收标准` 列表）；覆盖矩阵（验证证据列）。
- **proposal.md**：成功标准 9 条（`## 成功标准（可验证）` 列表）。
- **requirements.md**：FR-01..FR-07（全部功能性需求由本任务作为最终质量门）。

## 验证步骤

> 每一条与"成功标准 + 全局验收标准"一一对应。命令在仓库根 `C:\Users\qinyi\IdeaProjects\multi-agent-platform` 下执行（除标注 `cd frontend` 的前端命令）。

| # | 验证项 | 命令 | 期望结果 | 通过标准 | 来源 |
|---|---|---|---|---|---|
| 1 | 前端 lint | `cd frontend && pnpm lint` | exit 0，无 error/warning | exit code = 0 | 成功标准 6 / 全局验收 6 |
| 2 | 前端 typecheck（TS strict） | `cd frontend && pnpm typecheck` | exit 0，无类型错误（含删 streamAgentRunLogs 后无悬挂引用，R-04 兜底） | exit code = 0 | 成功标准 6 / 全局验收 6 / R-04 |
| 3 | 前端单测（vitest 全量） | `cd frontend && pnpm test` | 全部 suite 通过，含新增 `use-agent-run-stream.test.ts` 与 `agent-run-panel.test.tsx` | exit code = 0，无 failed | 成功标准 6/7/8 / 全局验收 7 |
| 4 | 删除确认 — `streamAgentRunLogs` | `grep -rn "streamAgentRunLogs" frontend/src` | 无输出（0 行） | 命令退出且 stdout 为空 | 成功标准 3 / 全局验收 3 / FR-01 |
| 5 | 4 调用点均渲染 `<AgentRunPanel>` | `grep -rn "AgentRunPanel" frontend/src/app` | 命中 ≥4 处实际渲染（根 page、agent/page、changes/[cid]），历史展开的 `<AgentLogViewer>` 直接用法不计 | 渲染点计数 ≥4（含 3 个文件，changes 页两触发点合并为 1 个 panel 也算调用点收敛达标） | 成功标准 4 / 全局验收 4 / FR-01/FR-03 |
| 6 | 旧胶水无残留 | `grep -rn "connectBootstrapStream\|eventSourceRef\|dispatchOwnsSseRef\|connectLogStream" frontend/src` | 无输出（或仅在 panel/hook 内部出现，需人工核对语义不是旧胶水复现） | stdout 为空，或残留行经人工确认为非旧胶水 | 成功标准 4 / 全局验收 4 |
| 7 | 后端零改动 | `git diff --stat backend sillyhub-daemon` | 输出为空（无任何 backend/daemon 文件变更） | `--stat` 输出 0 行 | 成功标准 9 / 全局验收 8 |
| 8 | pending_input UI 一致性（人工核对） | 人工：对比 `agent/page.tsx`（活跃 run）、`changes/[cid]/page.tsx`（task 执行）、根 `page.tsx`（Bootstrap run）三处 `<AgentRunPanel>` 渲染出的 pending_input 输入框 | 命名/样式/行为一致（同一 `AgentLogInputControls` 契约：`inputValues`/`submittingInputs`/`inputErrors`/`repliedInputs`/`onChange`/`onSubmit`） | 三处人工核对一致 | 成功标准 5 / 全局验收 5 / FR-05 |
| 9 | AskUserQuestion 审批卡片弹出（手动验收） | 手动：启动前端 + daemon + backend，`/workspaces/{id}/agent` 触发 scan run；`/workspaces/{id}/changes/[cid]` 触发含 `AskUserQuestion` 的 task | 两处页面均弹出审批卡片，不再 5min 兜底超时 | 两处均见卡片 + 用户可决策（无 `permission request timeout (5min fallback)` 日志） | 成功标准 1/2 / 全局验收 1/2 / FR-04 |
| 10 | brownfield 行为不变（人工/抽查） | 手动：访问任意未使用 AgentRunPanel 的页面（如纯列表页/详情页） | 行为与变更前一致（无回归） | 人工抽查无异常 | 全局验收 9 |

> 步骤 9/10 为人工验收：如本机无运行环境（无法拉起 daemon/backend），则**以 task-02 hook 单测（permission_request→perms 增、permission_resolved→perms 减）+ task-04 panel 集成测试（perms 非空 → 渲染审批卡片，端到端覆盖 bug）作为等效证据**，并在交付说明里标注"自动化已覆盖，手动验收待运行环境"。

## 边界处理

### 测试失败如何回退

本任务不直接修代码。验证若失败，按"失败现象 → 定位 task → 回退修复"路径处理，**修复必须落在对应 task 的 `allowed_paths` 内**：

| 失败现象 | 根因定位 | 回退到 | 修复边界 |
|---|---|---|---|
| `pnpm typecheck` 报 `streamAgentRunLogs` 未定义 / 找不到模块 | task-08 删除后有遗漏的 import 或调用方 | task-08 | 仅在 `frontend/src/lib/agent.ts` 及报错文件内清理 import/调用 |
| `pnpm typecheck` 报某调用点 props 类型不符 | task-05/06/07 迁移时 `<AgentRunPanel>` props 传错 | task-05/06/07（看报错文件归属） | 对应 page.tsx 内 |
| `pnpm lint` 报未使用 import / unused var | task-05/06/07 迁移后旧状态变量/import 未清干净 | task-05/06/07 | 对应 page.tsx 内 |
| `pnpm test` 中 `use-agent-run-stream.test.ts` 失败 | hook 行为回归 | task-02（实现层看 task-01） | `frontend/src/lib/use-agent-run-stream.ts` + 其 `__tests__` |
| `pnpm test` 中 `agent-run-panel.test.tsx` 失败 | panel 注入/字段映射回归 | task-04（实现层看 task-03） | `frontend/src/components/agent-run-panel.tsx` + 其测试 |
| `grep streamAgentRunLogs` 仍有结果 | task-08 删除不彻底，或 execute 期间新增了调用方 | task-08 | 删除残留定义/调用/import |
| `grep connectBootstrapStream\|eventSourceRef\|...` 有残留 | task-05/07 旧胶水未删干净 | task-05（根 page）/ task-07（changes） | 对应 page.tsx 内 |
| `git diff backend sillyhub-daemon` 非空 | 误改后端（违反 §3 非目标） | **当前任务直接 `git checkout -- backend sillyhub-daemon`** 还原 | 还原后重跑步骤 7 确认空 |

### lint 规则适配

- 若 `pnpm lint` 因本次新增文件触发既有规则（如 import 顺序、未使用 `rest`、`React.ReactNode` 等），**优先调整实现以适配规则**（回到对应 task），不放宽 ESLint 配置。
- 仅当规则本身与本次设计冲突（如 `...rest` 兜底被 `no-unused-vars` 误报）时，才在 design D-002 范围内对规则加窄白名单；此种情况需登记新决策，并视为设计变更（非常规）。

### 测试新增

本任务不新增测试。若发现覆盖缺口（如某 FR 既无 task 单测也未在集成测试覆盖），登记为新增 task（不塞进 task-09）。

## 非目标

- **不做新功能** —— 本任务是质量门，不引入任何新代码/新测试/新依赖。
- **不改后端** —— `backend/`、`sillyhub-daemon/` 零改动（成功标准 9），如发现非空直接 `git checkout` 还原。
- **不改前端代码** —— `frontend/src/**` 不在本任务 `allowed_paths` 内（`[]`）；任何代码修复回退到前序 task。
- **不改文档** —— design/proposal/plan/requirements 已定稿，本任务不修订。
- **不接管历史展开**（design §3）—— `agent/page.tsx` expandedLogs + 下载按钮保持现状，不在 grep 通过标准里。
- **不做版本兼容验证** —— 规则 7（未上线），无需回滚/兼容矩阵。
- **不重跑 daemon 服务的 split 变更** —— 与 `2026-06-22-daemon-service-split` 零文件重叠，不在本任务范围。

## 验收标准

全部为绿，缺一不可：

- [ ] **V1**：`cd frontend && pnpm lint` exit 0（步骤 1）
- [ ] **V2**：`cd frontend && pnpm typecheck` exit 0（步骤 2，TS strict 无错）
- [ ] **V3**：`cd frontend && pnpm test` 全过，含 `use-agent-run-stream.test.ts` + `agent-run-panel.test.tsx`（步骤 3）
- [ ] **V4**：`grep -rn streamAgentRunLogs frontend/src` 无结果（步骤 4）
- [ ] **V5**：`grep -rn "AgentRunPanel" frontend/src/app` 命中 ≥4 调用点渲染（步骤 5）
- [ ] **V6**：`grep -rn "connectBootstrapStream\|eventSourceRef\|dispatchOwnsSseRef\|connectLogStream" frontend/src` 无残留（步骤 6）
- [ ] **V7**：`git diff --stat backend sillyhub-daemon` 为空（步骤 7）
- [ ] **V8**：三处 pending_input UI 人工核对一致（步骤 8）
- [ ] **V9**：`/agent` 与 `changes/[cid]` AskUserQuestion 卡片弹出（步骤 9；无运行环境时由 task-02/04 测试等效覆盖，交付说明标注）

> V1–V7 为强自动化门，必须全绿。V8 为人工一致性核对。V9 优先手动验收，受运行环境限制时降级为测试覆盖证据。全部满足后即可进入 sillyspec verify（对照 design + 模块文档做最终一致性检查）。
