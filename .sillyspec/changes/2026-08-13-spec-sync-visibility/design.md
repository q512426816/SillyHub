---
author: qinyi
created_at: 2026-08-13T22:10:00
scale: large
risk_level: unit-sufficient
change: 2026-08-13-spec-sync-visibility
---

# P1：工作区配置页「同步到服务器」可见性增强

## 背景与目标

用户在工作区配置页点「同步到服务器」等 5 个操作按钮时，存在三个可见性盲区：

1. **失败原因不可见**：同步失败时前端只显示「同步失败。同步到服务器失败」，看不到后端真实错误（P0 ql-007 修的 NUL 500 就是被这条盲区掩盖——用户点了几次失败都不知道是 NUL 字节问题）。
2. **按钮语义不透明**：5 个按钮（初始化/扫描/同步到服务器/导入/生成项目）只有「生成项目」有说明 title，其余 4 个仅靠中文动词；几乎所有 disabled 场景（并发互斥、非 owner、操作进行中）灰掉时无任何原因提示。
3. **进度不可量化**：同步这类耗时操作只有「同步中…」转圈，无文件级进度（用户原话："久的操作最好有个进度展示，如果是文件同步的就展示当前同步数和总数"）。

**目标**：让同步操作对用户透明可观测——失败看得见原因、按钮看得懂含义、进度看得见文件数。

**前置依赖**：P0（ql-20260813-007，commit 88899f9c）已根治同步恒失败的 NUL bug。本 change 在可同步成功的基础上做可见性增强。

## 设计目标（FR）

- **FR-01 失败原因透传**：同步失败时前端展示后端真实 error message（非写死文案）。
- **FR-02 按钮含义提示**：5 个按钮每个有 antd Tooltip 解释「这个按钮干什么」。
- **FR-03 disabled 原因提示**：按钮灰掉时 Tooltip 切到原因文案（并发互斥/非 owner/操作进行中）。
- **FR-04 规范对齐**：5 按钮对齐 `FRONTEND_PAGE_STYLE.md` §5/§11（shadcn Button→antd、size sm→middle、"…中"文案→动词原形+loading、window.confirm→antd Modal.confirm）。
- **FR-05 同步终态计数**：同步完成后显示「已同步 N 个文件变更」。
- **FR-06 同步实时进度（阶段级）**：同步过程中显示 antd Progress 条 + N/M（阶段级：打包中/上传中/落盘中，非逐文件跳动）。**降级（BL-2）**：全量首同步期间（walkComplete 前 total 未知）仅显示阶段名「打包中」，N/M 仅在增量路径 / 全量 walkComplete 后显示。

## 非目标（Non-Goals）

- **不做逐文件级实时进度**：③b 采用阶段级（D-001@V1），逐文件需重构后端 apply_ops 逐 op 事务回写 outbox，复杂度过高，本 change 不做。
- **不改 workspace-card.tsx**：工作区列表卡片有同款 shadcn/sm/"…中"违规，但避免范围蔓延，留后续独立 quick。
- **不改同步状态机**：pending/claimed/done/failed 流转不变，只加只读进度列 + 新增 progress 上报端点（不置终态）。
- **不做导入/生成项目的量化进度**：仅同步加 N/M（用户明确点名"文件同步"）；导入已有 SSE phase 文案（打包中/落盘中…）保持。

## 总体方案

四块需求按 Wave 分阶段，前轻后重，纯前端先行：

### Wave 1：失败原因透传（纯前端，FR-01）

后端**已就绪**（`DaemonChangeWrite.error` 字段 + `complete_change_write` 落库 + `sync_manual_get_pending` 已返回 error 字段）。只改前端：

- `frontend/src/lib/spec-workspaces.ts`：`PendingSyncItem` **整体对齐后端返回**——既有类型字段（`id/workspace_id/change_key/kind`）与后端 `sync_manual_get_pending` 返回（`task_id/runtime_id/error/created_at/completed_at`）**完全脱节（既有 schema 漂移，Design Grill checklist #10 指出）**。W1 重定义为与后端一致的形状：`{task_id, status, runtime_id, error?: string|null, created_at, completed_at?: string|null}`，并排查所有消费处（`workspace-config-card.tsx` handleSyncManual 轮询用 `items[0]`/`latest.status`）同步改字段名。
- `frontend/src/components/workspace-config-card.tsx:269-271`：失败分支 `setSyncError("同步到服务器失败")` → `setSyncError(latest.error ?? "同步到服务器失败")`。渲染层（723-729）已预留 `syncError` 展示位，无需改。

### Wave 2：按钮提示 + 规范对齐（纯前端，FR-02/03/04）

主文件 `frontend/src/components/workspace-config-card.tsx`（5 按钮 414-481）：

- **antd Tooltip 包裹每个按钮**：tooltip 文案解释按钮含义（初始化="将平台配置下发到本地项目目录并拉取文档缓存"；扫描="把仓库的规范文档读取到平台"；同步="把本地缓存的规范变更推送回服务器，供其他成员可见"；导入="从仓库 .sillyspec 导入规范文档"；生成项目=沿用现有 title）。
- **disabled 时 Tooltip 切原因**：用 `<Tooltip title={disabled ? "原因文案" : "说明文案"}><span><Button disabled={...}>...</Button></span></Tooltip>` 包裹——span 包裹让 disabled 按钮也能触发 Tooltip（antd disabled Button 默认不响应 hover）。原因文案按 disabled 条件生成（如「扫描进行中，请稍候」/「仅 owner 可扫描」/「请先完成初始化」）。
- **规范对齐 §5/§11**：shadcn `Button`（`@/components/ui/button`）→ antd `Button`；`size="sm"` → 默认 middle；"…中…"文案 → 动词原形 + `loading` prop；`window.confirm`（316,337 重新扫描确认）→ antd `Modal.confirm`。范式参考 `agent-profile-form.tsx:377-398`。
- 补 `renderGuidance`（648-701）缺口：导入/生成项目进行中加引导框（现仅按钮文字有进度）。

### Wave 3：同步终态计数（后端+迁移+前端+gen:types，FR-05）

让同步完成后显示「已同步 N 个文件变更」。

- **后端模型加列**：`backend/app/modules/daemon/model.py`（`DaemonChangeWrite` ~399-488）加 `files_total: int | None`、`files_processed: int | None`（nullable 兼容旧行）+ Alembic 迁移（up 加列 / down 删列）。
- **轮询返回**：`backend/app/modules/spec_workspace/service.py:441-451`（`sync_manual_get_pending`）返回 dict 加 `files_total`、`files_processed`。
- **daemon 上报 total（单一写者，BL-1 修正）**：**终态计数也走 Wave 4 的 progress 端点，不走 complete 回执**。daemon spec-sync 分支（`task-runner.ts:2285-2317`）在 `completeChangeWrite` **之前**调一次 progress 上报 `{files_total, files_processed: files_total}`（全部处理完），再调 complete（complete 只翻 status，不碰计数列）。total 计算：增量路径 = `ops.length`（`spec-sync.ts:523` computeIncrementalOps 后）；全量路径 = packSpecDir 后的文件数。**complete_change_write 的 ChangeWriteCompleteRequest 不加 files_total/files_processed 字段**（BL-1 方案 A：单一写者消除双写覆盖冲突）。
- **前端展示**：`spec-workspaces.ts` `PendingSyncItem` 加 `files_total?`、`files_processed?`（随 W1 类型对齐一并加）；`workspace-config-card.tsx` done 分支展示「已同步 N 个文件」（N=files_total，M/M 文案样式参考 `sillyspec-step-progress.tsx:209`）。
- **gen:types**：迁移改 model 后跑 `pnpm gen:types`（先 `pnpm exec tsc --version` 确认 node_modules 健康），同步 `api-types.ts` + `backend/openapi.json`。注：progress 端点是 daemon 内部 API（非前端直调），gen:types 主要同步 model 加列对 sync_manual_get_pending 响应 schema 的影响。

### Wave 4：同步实时进度（阶段级，跨三端，FR-06）

方案 A（D-001@V1）：阶段级进度，非逐文件。

- **后端新增进度端点**：`PATCH /api/daemon/change-writes/{id}/progress`，body `{claim_token, files_total?, files_processed?}`。claim 校验（claim_token 匹配才写，防他人篡改）；写 `files_total/processed`，**不置终态、不改 status**（status 仍由 complete_change_write 终态回执置 done/failed）。
- **daemon 拆 onProgress 回调**：`sillyhub-daemon/src/spec-sync.ts` `postSpecSync`（504-554）加 `onProgress?: (p: {files_total?: number; files_processed?: number}) => void` 参数。调用点：
  - **增量路径**（`cached !== null`）：computeIncrementalOps 后（total=`ops.length` 已知）上报 `{files_total: ops.length, files_processed: 0}`。
  - **全量路径**（`cached === null`，BL-2 修正）：`packSpecDir` 加 `onWalkComplete?(filesCount: number)` 钩子——walkDir 收集完 entry、拼 tar 之前回调一次（此时 total=filesCount 已知，tar 还没拼，有真实上报窗口）。postSpecSync 在 onWalkComplete 时上报 `{files_total, files_processed: 0}`，pack 完成后上报 `{files_total, files_processed: files_total}`（全量是一次性整树发，无中间 processed）。
  - 两条路径在 `client.postSpecSync(Incremental)` 成功后、`completeChangeWrite` 之前，均上报 `{files_total, files_processed: files_total}`（终态计数，单一写者，对齐 Wave 3 BL-1 方案 A）。
  - task-runner spec-sync 分支（2285-2317）把 onProgress 接到新 progress 端点（hub-client 加 `reportChangeWriteProgress` 方法）。
- **前端展示**：`workspace-config-card.tsx` syncing 分支（704-714）渲染 antd `Progress`（`percent = files_processed/files_total*100`，kanban `kanban-task-detail-drawer.tsx:192` 范式）+ 「同步中 {processed}/{total}」文案。files_total 未知（全量 walkComplete 前）时退化为阶段文案「打包中…」（不显示 N/M，BL-2 降级）。
- **取舍说明（D-001@V1 + BL-2）**：processed 只能阶段级（pack/post），无法逐文件跳动——后端 apply 在 daemon HTTP 请求内同步执行，无逐 op 回调。**全量首同步期间**（walkComplete 回调前 total 未知）progress 仅显示阶段名「打包中」，N/M 仅在 walkComplete 后 / 增量路径显示（FR-06 显式降级，见 FR-06 措辞）。UI 文案避免用户误以为能逐文件实时。

## 文件变更清单（File Changes）

### 后端
- `backend/app/modules/daemon/model.py`（DaemonChangeWrite 加 files_total/files_processed 列）
- `backend/migrations/versions/<新>_daemon_change_write_progress.py`（新迁移）
- `backend/app/modules/daemon/schema.py`（**新增 ChangeWriteProgressRequest**；不改 ChangeWriteCompleteRequest——BL-1 方案 A）
- `backend/app/modules/daemon/change_write_router.py`（**不改 complete ok 分支**；新增 PATCH progress 端点 + status==claimed 校验）
- `backend/app/modules/spec_workspace/service.py`（sync_manual_get_pending 返回加字段）
- `backend/openapi.json` + `frontend/src/lib/api-types.ts`（gen:types 同步）

### daemon
- `sillyhub-daemon/src/spec-sync.ts`（postSpecSync 加 onProgress 回调；packSpecDir 加 onWalkComplete 钩子——BL-2 全量路径 total 上报窗口；total 计算）
- `sillyhub-daemon/src/task-runner.ts`（spec-sync 分支：complete 前最后一次 progress 上报 processed=total + 接 onProgress 到 progress 端点）
- `sillyhub-daemon/src/hub-client.ts`（**不改 completeChangeWrite**；新增 reportChangeWriteProgress 方法）
- `sillyhub-daemon/src/daemon.ts`（RunnerHubClient 接口声明加 reportChangeWriteProgress）

### 前端
- `frontend/src/lib/spec-workspaces.ts`（PendingSyncItem **整体对齐后端**（W1）：task_id/status/runtime_id/error/completed_at + files_total/files_processed）
- `frontend/src/components/workspace-config-card.tsx`（W1 失败透传 + W2 5 按钮 Tooltip/规范对齐 + W3 done 计数 + W4 syncing Progress）
- `frontend/src/components/workspace-config-card.test.tsx`（mock 补字段 + 新增失败原因可见/进度展示用例）

## 接口定义

### 现有端点加字段
- `GET /api/workspaces/{id}/spec-workspace/sync-manual/pending` 返回项加：`error: str | null`、`completed_at: datetime | null`、`files_total: int | null`、`files_processed: int | null`。
- `POST .../complete-change-write`（回执）**不加计数字段**（BL-1 方案 A：complete 只翻 status，计数单一写者走 progress 端点）。

### 新增端点（Wave 4）
- `PATCH /api/daemon/change-writes/{change_write_id}/progress`
  - body: `{claim_token: str, files_total?: int, files_processed?: int}`
  - 校验（BL-3 定契约）：change_write 存在 + claim_token 匹配 + **status == claimed 才允许写**（`status ∈ {pending, done, failed}` 一律 409——progress 语义是「claim 后执行中的进度」，pending 未认领 / 终态已完成均拒绝；防重放/篡改）。
  - 行为：写 files_total/processed（仅更新传入的非 None 字段），**不改 status/completed_at**（终态仍由 complete_change_write 置）。
  - 响应：`{ok: true}` 或 4xx（404 不存在 / 409 claim 不匹配或 status != claimed）。

## 决策记录（decisions.md）

- **D-001@V1 ③b 进度粒度=阶段级**：daemon completeChangeWrite 终态一次性回执 + 后端 apply 在 daemon HTTP 内同步执行（无逐 op 回调），逐文件级需 apply_ops 改逐 op 提交事务回写 outbox（task_id 透传 sync 请求头），复杂度过高。本 change 取阶段级（pack/post），UI 文案体现阶段非精确文件数。
- **D-002@V1 迁移 nullable 兼容**：files_total/processed nullable，兼容已有 outbox 旧行。数据可清空（CLAUDE.md 规则 11）但仍走规范 Alembic 迁移（up/down）。
- **D-003@V1 Wave 分阶段**：W1-2 纯前端先落地（无依赖、风险低）；W3 含迁移+gen:types；W4 跨三端+新端点+回调。workspace-card.tsx 同款违规本 change 不动（避免蔓延），留后续 quick。
- **D-004@V1 计数列单一写者（Design Grill BL-1 收敛）**：files_total/files_processed **只由 progress 端点写**，complete_change_write 不碰计数列（不加字段、不回写）。终态计数 = daemon 在 complete 前最后一次 progress 上报 `{total, processed: total}`。消除 Wave3/Wave4 双写覆盖冲突。

## 风险登记（Risk）

| # | 风险 | Wave | 缓解 |
|---|---|---|---|
| 1 | Wave 2 改 shadcn→antd 波及整页样式（含 import 重构） | W2 | 仅 5 按钮组件替换，不动布局；tsc+vitest 全量回归；对齐 agent-profile-form 既有范式 |
| 2 | ~~Wave3/Wave4 双写计数列覆盖冲突~~（Design Grill BL-1） | W3/4 | **已收敛（D-004）**：单一写者=progress 端点，complete 不碰计数列 |
| 3 | Wave 4 progress 端点竞态（daemon 上报 vs complete 终态） | W4 | status==claimed 才允许写（BL-3），终态/pending 一律 409；端点幂等 |
| 4 | daemon onProgress 回调时序 flaky | W4 | 充分单测（增量 ops.length / 全量 onWalkComplete / complete 前终态上报三阶段点）；回调失败仅 warn 不阻塞同步主流程 |
| 5 | gen:types node_modules 半坏报假错 | W3 | gen:types 前 `pnpm exec tsc --version` 确认；必要时 `pnpm install --force` |
| 6 | 全量首同步 total 在 walkComplete 前不可得（Design Grill BL-2） | W4 | packSpecDir 加 onWalkComplete 钩子（walk 完成立即上报 total，tar 还没拼有窗口）；回调前 UI 退化为阶段名「打包中」（FR-06 已声明降级） |
| 7 | 用户预期管理：阶段级非逐文件 | W4 | UI 文案写"打包中/上传中/落盘中"阶段名，不暗示精确文件数 |

## 生命周期契约

不涉及生命周期契约（本 change 不改 daemon outbox / lease / agent_run 的状态流转：pending→claimed→done/failed 不变，仅新增只读进度列 files_total/files_processed + 一个不置终态的 progress 上报端点）。

## 自审（Self-Review）

- [x] 必填章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）。
- [x] frontmatter 字段齐全（author/created_at/scale/risk_level）。
- [x] 含「自审」字面章节。
- [x] 涉及 daemon/outbox 关键词，已含「生命周期契约」豁免说明。
- [x] D-001/002/003/004 决策已记录，design 引用所有当前版本。
- [x] 文件变更清单列出全部新增/修改文件（后端 6 + daemon 4 + 前端 3，含 gen:types 产物）。
- [x] FR-01~06 每条对应明确 Wave + 文件。
- [x] Design Grill 三 blocker 已收敛：BL-1（D-004 单一写者）/BL-2（onWalkComplete 钩子 + FR-06 降级声明）/BL-3（接口定义 status==claimed 校验契约）。既有 PendingSyncItem schema 漂移已并入 W1 整体对齐。
- ⚠️ 自审存疑：无（Design Grill 指出的契约空缺均已补进正文，非推给 plan）。
