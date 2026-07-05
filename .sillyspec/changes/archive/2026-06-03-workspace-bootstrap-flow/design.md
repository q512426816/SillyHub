---
author: WhaleFall
created_at: 2026-06-03 15:17:41
---

# Design

## 背景与目标

把「生成项目规范」统一为 Bootstrap 流程（方案 A）：弹窗职责单一化（扫描 + 新建 + 跳转），详情页承载触发 / 实时回显 / 进入恢复，后端负责幂等防重复与成功收尾自动建子组件。复用 `2026-06-02-spec-bootstrap-agent-stream-interaction` 已交付的 scan agent + SSE 基础设施，不重复造管线。

## 架构决策

### 决策 1：弹窗只建项目并跳转，回显全部交给详情页

弹窗 `workspace-scan-dialog.tsx` 移除 `generating` 阶段与 SSE 订阅，「生成项目规范」点击后 `scanGenerate` → `router.push('/workspaces/{id}')`。
- **理由**：单一回显入口避免弹窗 / 详情页两处 SSE 逻辑重复；符合「点击项目详情进入之后实时查询并回显」的需求；刷新 / 重进可恢复。
- **Trade-off**：弹窗内不再即时看到日志，但跳转后详情页立即接管，用户体验连续。

### 决策 2：详情页 load 时查询进行中 run 并自动恢复回显

`workspaces/[id]/page.tsx` 的 `load()` 增加：调用 `listWorkspaceAgentRuns(workspaceId)`，筛出 `change_id == null` 的最近一条 scan/bootstrap run；若其 status 为 `pending`/`running`，则设置 `activeBootstrapRunId` 并用 `AgentRunStreamClient` 连接 SSE 恢复回显。
- **理由**：后端已有 `GET /workspaces/{id}/agent/runs`，无需新接口；判定「还在 Bootstrap」以真实 run 状态为准，比依赖 `sync_status` 字段更准确。
- **Trade-off**：每次进页面多一次列表查询，成本可接受。

### 决策 3：后端 scan_generate 幂等返回进行中 run

`WorkspaceService.scan_generate` 在 `start_scan_dispatch` 前，查询该 workspace 是否已有进行中（pending/running）的 scan run（经 `AgentRunWorkspace` 关联 + `AgentRun.change_id is None`）。若有，直接返回该 run 的 `(workspace_id, run_id)`，不新建。
- **理由**：防重复点击做到后端层，兜住多标签页 / 并发；幂等语义天然支持前端重复调用。

### 决策 4：成功收尾把主 workspace 转 active 并自动 reparse 子组件，失败仅 warning

`AgentService._execute_scan_run` 在 `result.exit_code == 0` 的成功分支（service.py:1126-1165 区间）执行两件收尾：

1. **主 workspace 状态转换**：把发起 Bootstrap 的主 workspace 从 `pending` 置为 `active`（`status="active"` + 刷新 `last_scanned_at`）。这是规范已生成成功的标志，必须独立提交——否则 workspace 永远停在 `pending`，被 `list_()` 的 `status != "pending"` 过滤，导致 `/workspaces` 列表页看不到刚生成的项目。
2. **reparse 子组件**：解析 `spec_root/projects/*.yaml` 创建子 workspace + relations。reparse 包在独立 try/except，失败只记 `log.warning`，不改变 run 的 completed 状态，也不回退已转为 active 的主 workspace。
- **理由**：状态转换与子组件创建都是收尾增强，不应让一次解析异常把成功的 scan 标记为失败或让 workspace 卡在 pending；自动化省去用户手动激活/reparse。
- **Trade-off**：reparse 失败时子组件未建，但 run 仍 completed、主 workspace 仍 active；用户可在详情页手动重试 reparse（现有能力）。

## 文件变更清单

| 文件 | 变更 | 说明 |
|---|---|---|
| `backend/app/modules/workspace/service.py` | 改 | `scan_generate` 增加进行中 scan run 查询与幂等返回（新增 `_find_active_scan_run`） |
| `backend/app/modules/agent/service.py` | 改 | `_execute_scan_run` 成功分支增加收尾 reparse（独立 try/except） |
| `frontend/src/components/workspace-scan-dialog.tsx` | 改 | 移除 `generating` 阶段与 SSE；「生成项目规范」改为 scanGenerate 后 router.push 跳转 |
| `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx` | 改 | `load()` 查询进行中 scan run 并自动恢复 SSE 回显；done 后刷新计数；抽出 `connectBootstrapStream` |
| `frontend/src/lib/agent.ts` | 改 | `AgentRun` 类型补 `change_id` 字段 |
| `backend/tests/modules/workspace/test_scan_generate_service.py` | 改 | scan_generate 幂等返回测试 |
| `backend/app/modules/agent/tests/test_scan_run_reparse.py` | 增 | _execute_scan_run 成功收尾 reparse 测试 |
| `.sillyspec/docs/SillyHub/scan/INTEGRATIONS.md` | 改 | 补充 scan-generate / Bootstrap 数据流说明 |
| `.sillyspec/docs/SillyHub/scan/PROJECT.md` | 改 | 补充 Workspace Bootstrap 流程说明 |

## 数据模型

无新增表 / 字段。涉及现有：

- `AgentRun`（`status`、`change_id`、`exit_code`）
- `AgentRunWorkspace`（`agent_run_id` ↔ `workspace_id` M:N 关联）
- `Workspace`（子 workspace 由 reparse 创建）
- `WorkspaceRelation`（reparse 创建的依赖关系）

## API 设计

无新增 API。复用：

- `POST /api/workspaces/scan-generate`（语义增强为幂等）
- `GET /api/workspaces/{id}/agent/runs`（详情页查询进行中 run）
- `GET /api/workspaces/{id}/agent/runs/{run_id}/stream`（SSE 回显）
- `POST /api/workspaces/{id}/reparse`（后端收尾内部调用其逻辑；前端手动重试仍可用）

## 兼容策略

- 「直接创建」（已检测到 .sillyspec）路径不变。
- `spec-bootstrap` 接口与详情页现有 Bootstrap 按钮逻辑不变，新增的只是「进入页面自动恢复」与「按钮禁用判定」。
- scan_generate 幂等返回不破坏现有「新建并触发」语义（无进行中 run 时行为不变）。

## 风险登记

| 风险 | 等级 | 缓解 |
|---|---|---|
| 详情页恢复回显与现有 handleBootstrap 状态冲突 | 中 | 复用同一组 bootstrap state（activeBootstrapRunId 等），恢复路径只是另一处赋值入口 |
| reparse 在后台 session 中执行的事务边界 | 中 | 在 `_execute_scan_run` 的后台独立 session 内，commit 前调用；失败回滚不影响 run 状态更新（分开 commit 或 warning 跳过） |
| listWorkspaceAgentRuns 返回字段是否含 change_id | 低 | 验证前端 AgentRun 类型含 change_id，否则按返回结构筛选最近 scan run |

## 自审

- 是否引入新表/字段：否。
- 是否复用现有能力：是（scan agent SSE、reparse、agent runs 列表）。
- 是否覆盖全部需求点：生成规范跳转(FR-01)、进入恢复(FR-02)、防重复(FR-03)、自动子组件(FR-04)、刷新计数(FR-05)，均覆盖。
- 表名/字段名是否真实：AgentRun/AgentRunWorkspace/Workspace/WorkspaceRelation 均来自现有代码。
