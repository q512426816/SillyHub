---
author: qinyi
created_at: 2026-08-09 07:10:00
scale: large
risk_level: unit-sufficient
review_round: 2
---

# 设计文档（Design）— changes.ts 迁 api-types（消除手写类型 drift）

> CLAUDE.md 规则 20：前端接口类型必须从后端 OpenAPI 生成（`pnpm gen:types` →
> `frontend/src/lib/api-types.ts`），禁止手写。`changes.ts` 仍手写 ~20 个 change/stage
> 类型，已与后端 schema **drift**（如 `ChangeSummary` 凭空多 `created_at`，后端从不返回；
> 多处字段 required vs optional 不一致）。本次把手写类型改为从 `api-types` 的
> `components["schemas"]` 导出 alias（与 `agent-profiles.ts` / `api-keys.ts` 同源范式），
> 彻底还债并修复 drift 引入的调用方断裂。

## 1. 背景

- `frontend/src/lib/changes.ts` 手写 change/stage 相关类型 ~20 个，是 change-center-on-demand
  变更（2026-08-08）遗留的 baseline debt。
- `api-types.ts`（openapi-typescript 产物，db5d0ed3 已 regen）是**正确的**，与后端
  `backend/app/modules/change/schema.py` 一致。`changes.ts` 手写是 drift 方。
- 实测 drift（field-by-field 比对）：
  - `ChangeSummary`：手写有 `created_at: string`，**schema 与后端均无此字段** → phantom。
    grep 全前端 0 调用方（`r.created_at`/`run.created_at` 命中是 Run/audit 类型，非 Change）。
  - `ChangeSummary.current_stage` / `ChangeRead.current_stage` / `ArchiveGateResponse.checks`
    / `ChangeReparseResponse.warnings`：手写 required，schema optional（`?`）。
- 调用方影响实测可控：`current_stage` 23 处调用大多已防御（`?? "scan"` / `&&` / `===`）；
  `reparseResult.warnings.length`（tasks/page.tsx:165）无 guard 需补；`checks` 深度访问少。
- **Design Grill round-1 复核发现**（review_round=2 修订）：原 §4 误判「10 个手写类型 openapi 无
  schema」，实测 `backend/app/modules/change/schema.py:202/234/280/315/331` 同名定义了
  `TransitionRequest`/`FeedbackRequest`/`TransitionDispatchResponse`/`TransitionResponse`/
  `VerifyGateResponse` 5 个 schema（api-types.ts @9687/15669/15633/15717/15976）。逐字段比对后分两档：
  - `FeedbackRequest`（schema 多可选 `target_stage`，后端 `submit_feedback(*, target_stage=None)`
    已支持，手写漏了 → **真 drift，迁）**；`TransitionDispatchResponse`（schema 把 agent_run_id/
    stage/reason/mission_id/mode 标可选，后端条件返回更准确 → **迁，机械补 guard）**。
  - `TransitionRequest`（schema 的 worker_preset/main_agent_config 是 `{[key:string]:unknown}`
    loose dict）/ `TransitionResponse`（schema 的 `change` 是 loose dict）/ `VerifyGateResponse`
    （schema 的 `source` 是 loose `string`）→ schema **lossy/loose 会降级前端精确类型**，作为
    规则 20 的有据例外保留手写（见 §4）。

## 2. 目标 / 非目标

**目标**
- FR-01：`changes.ts` 中凡 openapi schema 已定义**且 schema 为 faithful/超集表示**的类型，改为
  `components["schemas"]` alias，不再手写（规则 20）。schema lossy/loose 会降级类型安全的，
  按规则 20 的有据例外保留手写（见 §4，例外须在注释标 shadow 的 schema 名）。
- FR-03：修复 drift 引入的调用方类型断裂（required→optional 字段补 null guard；FeedbackRequest
  迁移顺带补回后端已支持、前端漏掉的 `target_stage` 能力）。
- FR-04：移除 phantom `ChangeSummary.created_at`（随迁移消失，0 调用方）。
- NFR-01：保留有价值 JSDoc——**可测判据**：每个迁 alias 的类型在 alias 声明上方保留 ≥1 行描述
  **业务语义/取值枚举**的 JSDoc（如 pending_review 四取值、source 三取值、6 检查项名）；
  纯字段罗列、schema 已自描述的字段级注释可省（以 agent-profiles.ts/api-keys.ts 范式为准）。
- NFR-02：`pnpm typecheck` + `pnpm test` + `pnpm gen:types:check` 全过。

**非目标（Non-Goals）**
- 不改后端（`schema.py` / `openapi.json` / `api-types.ts` 保持现状——它们是正确的源）。
- 不迁 FR-02 列表（schema 未定义的手写类型，无源可迁）。
- 不重构 change 模块的 UI/交互逻辑，仅类型契约 + 必要 guard。

## 3. 迁移方案（FR-01 — 11 类型迁 alias）

`changes.ts` 顶部加 `import type { components } from "@/lib/api-types";`，下列 11 个类型改 alias
（逐一 grep + 逐字段比对 schema body，均 faithful/超集——无 `[key:string]` loose dict 降级）：

| # | 手写类型 | alias | drift 处理 |
|---|---|---|---|
| 1 | `ChangeSummary` | `components["schemas"]["ChangeSummary"]` | 删 phantom `created_at`（0 调用方，迁移即消失） |
| 2 | `ChangeRead` | `components["schemas"]["ChangeRead"]` | `current_stage`/`pending_review`/`stages` 等 optional，调用方多已防御，typecheck 兜底 |
| 3 | `ChangeList` | `components["schemas"]["ChangeList"]` | `items` 用 schema `ChangeSummary`（无 created_at） |
| 4 | `ChangeWarning` | `components["schemas"]["ChangeWarning"]` | 精确匹配，无 drift |
| 5 | `ChangeReparseStats` | `components["schemas"]["ChangeReparseStats"]` | 精确匹配 |
| 6 | `ChangeReparseResponse` | `components["schemas"]["ChangeReparseResponse"]` | `warnings` optional → 调用方补 guard |
| 7 | `ArchiveCheckItem` | `components["schemas"]["ArchiveCheckItem"]` | 精确匹配 |
| 8 | `ArchiveGateResponse` | `components["schemas"]["ArchiveGateResponse"]` | `checks` optional → 调用方按需 guard |
| 9 | `CreateChangeResponse` | `components["schemas"]["ChangeCreateResponse"]` | **名映射**（手写 CreateChangeResponse ↔ schema ChangeCreateResponse；schema 多可选 `agent_dispatch`，非破坏） |
| 10 | `FeedbackRequest` | `components["schemas"]["FeedbackRequest"]` | **drift 修复**：schema 多可选 `target_stage`（后端 `submit_feedback` 已支持，手写漏）；body 构造 `{category, text}` 仍合法 |
| 11 | `TransitionDispatchResponse` | `components["schemas"]["TransitionDispatchResponse"]` | schema 把 agent_run_id/stage/reason/mission_id/mode 标可选（后端条件返回更准确，手写 required 过严）；调用方按需补 `?.` |

> execute 代码准备期复核纠正：原列 `DispatchResponse`（旧 #9）schema 实为 **lossy**
> （`last_dispatch`/`dispatch_result` 是 `{[key:string]:unknown}` loose dict，`current_stage` required），
> 迁过去会丢失 `DispatchResult` 精确结构（agent-status 展示读 `.status`/`.run_id`/`.gate_status`）→
> 移入 §4 保留（与 TransitionResponse 同类 lossy 例外）。

**JSDoc 保留（NFR-01 可测判据）**：alias 声明上方保留 ≥1 行业务语义 JSDoc（如 `ChangeRead`
pending_review 四取值、`VerifyGateResponse` source 三取值、`ArchiveCheckItem` 6 检查项名、
`FeedbackRequest` category A/B/C/D 语义）。纯字段罗列、schema 已自描述的字段级注释可省。

## 4. FR-02 — 保留手写（schema lossy/loose 降级类型安全的有据例外）

下列 9 个类型 openapi **有同名 schema 但 schema 是 lossy/loose 表示**（或无 schema），迁过去会
降级前端精确类型，作为规则 20 的有据例外保留手写（注释中标 shadow 的 schema 名 + 保留理由）：

| 手写类型 | shadow 的 schema | 保留理由（schema lossy 点） |
|---|---|---|
| `DispatchResponse` | `DispatchResponse` | schema 的 `last_dispatch`/`dispatch_result` 是 `{[key:string]:unknown}` loose dict，手写 `last_dispatch` 是精确 `DispatchResult`（`.status`/`.run_id`/`.gate_status` 等调用方依赖）；schema `current_stage` required vs 手写 `\| null` |
| `TransitionRequest` | `TransitionRequest` | schema 的 `worker_preset`/`main_agent_config` 是 `{[key:string]:unknown}[]` loose dict，手写是精确 `{agent_type;model;objective;role}[]` / `{agent_type?;provider?;model?}`；schema 的 `team_mode` required（手写 optional，前端按需 `body.team_mode=true`） |
| `TransitionResponse` | `TransitionResponse` | schema 的 `change` 是 `{[key:string]:unknown}` loose dict，手写是 `ChangeRead` 精确结构（23 处 `.change.xxx` 调用依赖） |
| `VerifyGateResponse` | `VerifyGateResponse` | schema 的 `source` 是 loose `string`，手写是 `"gate_result"\|"gate_cmd"\|"unavailable"` 精确 union（调用方 `===` 比较依赖 exhaustiveness） |
| `HumanGate` | — | 无 schema（前端 UI 状态枚举） |
| `ReviewResponse` | — | 无 schema（= TransitionResponse 结构但后端 review 端点无独立 response schema） |
| `ReviewEntry` | — | 无 schema（前端聚合类型） |
| `DispatchResult` | — | 无 schema（`DispatchResponse.last_dispatch` 在 schema 里是 loose dict，手写精确结构被 `DispatchResponse` 保留手写所依赖） |
| `ProxyCreateChangeInput` | — | 无 schema（daemon-client 代理请求，前端本地契约） |

**规则 20 例外判据（写入 §9 D-004，供未来 review 复核）**：仅当 (a) schema 是 loose dict/union
降级精确类型，且 (b) 手写精确类型有 ≥1 处调用方依赖（`.field` 深访问 / `===` union 比较）时，
允许保留手写并注释标 shadow schema。不满足则必须迁。

## 5. 调用方 drift 修复（FR-03）

> plan 独立审查核验纠正：三套 ReparseResponse 勿混淆——`tasks/page.tsx` 用
> **TaskReparseResponse**（@/lib/tasks，warnings required，**不受影响**）；`scan-docs/page.tsx`
> 用 ScanDocReparseResponse（已 `warnings &&` 防御）；`sillyspec-step-progress.tsx` 不 import
> changes.ts（仅接 currentStage prop）。**ChangeReparseResponse.warnings 的真调用方是 changes 列表页。**

- `frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx:188`：`setWarnings(resp.warnings)`
  中 resp 是 ChangeReparseResponse，warnings 迁后变 optional；`setWarnings`
  （Dispatch<SetStateAction<ChangeWarning[]>>）不接受 undefined → 补 `resp.warnings ?? []`。
- `current_stage`（23 处）：大多已 `??`/`&&`/`===` 防御；typecheck 暴露的未防御点按需补
  `?.` / `??`（机械，主要在 `changes/[cid]/page.tsx`）。
- `TransitionDispatchResponse` 字段（agent_run_id/stage/reason/mission_id/mode）迁后变 optional，
  调用方（`changes/[cid]/page.tsx` dispatch 结果展示，大多已 `??`/truthy 防御）按 typecheck
  暴露点补 `?.`（机械，预计 ≤5 处）。
- `FeedbackRequest` 迁移是超集（多可选 target_stage），body 构造 `{category, text}` 不破，
  无调用方 guard 需求；submitFeedback 入参可选增 `targetStage?: string`（增强，非 drift 断裂）。
- `checks`：深度访问少，typecheck 兜底。
- phantom `created_at`：0 调用方，迁移即消失，无需改调用方。

## 6. 文件变更清单（File Changes）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/lib/changes.ts | 11 类型 alias 化 + 9 shadow 注释 + JSDoc 迁移（§3/§4/NFR-01） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx | ChangeReparseResponse.warnings 变 optional，setWarnings(resp.warnings) 补 ?? []（§5） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | current_stage / TransitionDispatchResponse 字段 optional guard（§5，按 typecheck 暴露点） |

> typecheck 可能再暴露 ≤3 个 changes/ 子页面调用方 guard，执行时按错误清单补（task-02 allowed_paths 覆盖 changes/ 目录相关页面）。

### 不修改文件

- backend/app/modules/change/schema.py（后端正确源）
- backend/openapi.json
- frontend/src/lib/api-types.ts（gen:types 产物；无后端改动 → 无需 regen）
- frontend/src/lib/api-keys.ts（已 alias 范式，无 drift）
- frontend/src/lib/agent-profiles.ts（已 alias 范式，无 drift）

## 7. 风险登记（Risk）

- **R-01（低）**：typecheck 暴露的 drift 断裂点多于预期 → 执行时按错误清单逐个补 guard，
  全是机械 nullable 处理，无逻辑风险。缓解：执行后 `pnpm typecheck` 必过。
- **R-02（低）**：`ChangeRead`/`ChangeSummary` optional 字段在运行时确为 undefined（后端
  省略）→ 调用方若之前依赖手写 required 假设（实际 runtime 早就是 undefined）→ 行为不变，
  仅类型变严。无运行时回归。
- **R-03（低）**：JSDoc 迁到 alias 后与 schema 字段长期可能不同步 → 接受（JSDoc 描述语义，
  schema 描述结构；语义注释允许滞后于结构，优于无注释）。

## 8. 生命周期契约

**不涉及生命周期契约**（本变更仅前端类型 alias 化 + null guard，不触碰 session/lease/
agent_run/daemon/lifecycle/state_transition/claim/heartbeat 任何生命周期事件或状态机）。

## 9. 决策（Decisions）

- **D-001**：scale=large（多文件 + 类型契约变更 + drift 修复），走完整 4-doc 流程（用户选
  正式 change）。
- **D-002**：方案 A（全量迁 + JSDoc 挂 alias）而非 B（裸 alias 丢 JSDoc）或 C（仅叶子）。
  理由：彻底还规则 20 的债 + JSDoc 不丢 + drift 断裂实测可控。
- **D-003**：`CreateChangeResponse` 名映射到 schema `ChangeCreateResponse`（手写名 ↔ schema
  名不同，alias 桥接，调用方用名不变）。
- **D-004**：FR-02 例外判据——schema lossy/loose（loose dict/union 降级精确类型）且手写精确
  类型有调用方依赖时，允许保留手写并注释标 shadow schema（规则 20 有据例外）。review_round=1
  原 D-004 误判这 5 个类型「无 schema」，经独立 Grill 子代理复核 + 主 agent 逐字段比对
  schema.py/api-types.ts 纠正：`FeedbackRequest`/`TransitionDispatchResponse` 迁（faithful/超集），
  `TransitionRequest`/`TransitionResponse`/`VerifyGateResponse` 留（lossy，见 §4 表）。

## 10. 自审（Self-Review）

- ✓ FR-01 的 11 类型已逐一 grep + 逐字段比对 schema **body** 确认 faithful/超集（见 §3 表，含 round-2
  新增 FeedbackRequest/TransitionDispatchResponse；execute 准备期再纠正：DispatchResponse lossy 移 §4）。
- ✓ §4 保留的 9 类型已确认 schema lossy 点 + 调用方依赖（shadow schema 名 + 保留理由入表）。
- ✓ phantom `created_at` 已确认 0 调用方（§1/§5）。
- ✓ 调用方影响已实测（current_stage 23 处、warnings 1 处无 guard、TransitionDispatchResponse
  字段可选化 ≤5 处 guard）。
- ✓ 不涉及后端 / schema / API / 状态机 / 权限（纯前端类型契约）。
- ✓ 验收可机械判定（typecheck + test + gen:types:check）。
- ✓ NFR-01 补齐可测判据（alias 上 ≥1 行业务语义 JSDoc，对照 agent-profiles.ts 范式）。
- ⚠️ **round-1 自审盲区（已纠正）**：原 §4/§10 声称 5 个类型「无 schema」，未实际 grep
  schema.py/api-types.ts，被独立 Grill 子代理复核证伪（specVerdict/qualityVerdict 双 fail）。
  本 round-2 已逐字段比对纠正（D-004 记录教训）。盲区根因：round-1 仅凭记忆/直觉判定 schema
  存在性，未交叉验证源文件。
- ⚠️ 自审局限：typecheck 实际暴露的断裂点要在执行阶段才知道确数（R-01），但都是机械 guard。

## 11. 需求追溯

- FR-01：§3 类型映射表（11 alias）。
- FR-02：§4 保留手写清单（9 例外 + 判据）。
- FR-03：§5 调用方 drift 修复。
- FR-04：§3 #1（phantom created_at 删除）。
- NFR-01：§3 JSDoc 保留判据 + §2 目标可测定义。
- NFR-02：§2 目标 + 执行验收。
