---
author: qinyi
created_at: 2026-08-14T02:40:00
scale: large
risk_level: unit-sufficient
change: 2026-08-14-spec-sync-per-file-progress
---

# spec-sync 逐文件级进度（升级 P1 FR-06）

## 背景与目标

上个 change `2026-08-13-spec-sync-visibility`（已归档，commit c96edcce）实现了同步进度展示（FR-06），
但 design D-001 取「阶段级非逐文件」。实测发现 `files_processed` 只有 **0 → total 两个上报点**
（daemon `onWalkComplete`/`computeIncrementalOps` 报 processed=0，complete 前报 processed=total），
中间无推进——前端 antd Progress 条实际只看到 0/N 或瞬间 done，看不到逐文件跳动。

**根因**：后端 apply 在 daemon 单次 `postSpecSync` HTTP 内同步执行，daemon 在 apply 期间无法逐文件
回写 processed。

**目标**：让 `files_processed` 在同步过程中**逐文件真实递增**（1/35...35/35），前端 Progress 条
看到逐文件推进。推翻 P1 D-001「阶段级」决策，升级为「逐文件级」。

## 前置依赖

P1（2026-08-13-spec-sync-visibility，commit c96edcce）已建：progress 端点（status==claimed 校验 BL-3）、
`files_total/files_processed` 列（迁移 20260813173000）、D-004 单一写者（complete 不碰计数列）、前端
antd Progress 条 + 轮询展示。**本 change 复用这些，不重写**。

## 方案选择（推翻初版方案C）

**初版方案C（daemon 分批发 ops）经 Design Grill 审查否决**：分批与 apply_ops 的乐观锁（base_version）
不兼容——批1 推进 server version 后，批2 的 base_version 过期必然误判 conflict。详见 decisions.md D-003。

**本 design 采用方案 A（task_id 透传 + 后端 apply 循环内独立 session 回写 processed）**：
- daemon 单次 HTTP（不分批，无乐观锁矛盾）。
- daemon 在 sync HTTP 头透传 `X-Change-Write-Id`（task_id）。
- 后端 apply_sync/apply_ops 循环内每处理一个文件，用**独立 session** UPDATE
  `daemon_change_writes.files_processed += 1`（不动主事务）。
- processed 真逐文件递增（1/35...35/35）。

**事务原子性取舍（D-001）**：循环内 processed 回写用独立 session + 独立事务（每文件一次 commit）。
主 apply 事务若中途失败回滚，processed 已推进但不一致——但终态 complete 会把 status 翻 done/failed，
processed 的中间值无实际危害（前端 done 后不再读 processed）。这是方案 A 的已知取舍。

## 设计目标（FR）

- **FR-01 task_id 透传**：daemon `postSpecSync`/`postSpecSyncIncremental` HTTP 请求带
  `X-Change-Write-Id: <task_id>` 头。
- **FR-02 后端循环内逐文件回写 processed**：`_write_spec_root` per-file merge 循环 / `apply_ops`
  逐 op 循环内，每处理一个文件用独立 session UPDATE `files_processed += 1`。
- **FR-03 files_total 上报不变**：保持 P1（onWalkComplete/ops.length 报 total）。
- **FR-04 前端不改**：P1 Progress 条 + 轮询 files_processed 已就位，daemon 逐文件递增后自然跳动。

## 非目标（Non-Goals）

- **不分批发 ops**（方案 C 已否决，乐观锁矛盾，D-003）。
- **不改 progress 端点 / D-004 / BL-3**：复用 P1。processed 仍只由"写 daemon_change_writes"更新
  （本 change 是 apply 循环内直接 UPDATE，不经过 progress 端点 HTTP——但仍是 D-004 单一写者语义：
  complete_change_write 不碰计数列，processed 由 apply 路径写）。
- **不改前端**：P1 已就位。
- **不保证 processed 与主事务强一致**：方案 A 取 eventual（processed 中间值可能超前于已 commit 的
  文件，但终态一致）。

## 总体方案

### daemon：task_id 透传（hub-client.ts + spec-sync.ts）

`postSpecSync`/`postSpecSyncIncremental` 的 fetch 请求加 `X-Change-Write-Id` 头（task_id 从
task-runner spec-sync 分支传入）。task-runner 调 postSpecSync 时把 `taskId` 透传给 spec-sync.ts
的 postSpecSync（新增参数 `changeWriteId?: string`）。

### 后端：apply 循环内独立 session 回写（service.py）

`_write_spec_root`（apply_sync 全量）+ `apply_ops`（增量）的 per-file 循环内：
1. 从请求头解析 `X-Change-Write-Id`（router 层透传给 service，或 service 接收 change_write_id 参数）。
2. 每处理一个文件后，用 `get_session_factory()` 开独立 session，UPDATE
   `daemon_change_writes SET files_processed = files_processed + 1 WHERE id = change_write_id`，commit。
3. 独立 session 用完即关（短生命周期，避免连接池压力）。

**性能取舍（D-002）**：N 个文件 = N 次独立 UPDATE（轻量单行更新，无重 IO）。活跃 spec 树数十~百文件
可接受；超大树（万级）可优化为每 K 文件回写一次（本 change 不做，留优化空间）。

### 路由层：解析 X-Change-Write-Id 头（router.py）

`sync_spec_workspace`（tar 端点）+ `sync_spec_workspace_incremental`（ops 端点）从 `Request.headers`
解析 `X-Change-Write-Id`，透传给 `apply_sync`/`apply_ops` 的 `change_write_id` 参数。

## 文件变更清单（File Changes）

### daemon
- `sillyhub-daemon/src/hub-client.ts`（postSpecSync/postSpecSyncIncremental 加 X-Change-Write-Id 头）
- `sillyhub-daemon/src/spec-sync.ts`（postSpecSync 接收 changeWriteId 参数透传给 client）
- `sillyhub-daemon/src/task-runner.ts`（spec-sync 分支调 postSpecSync 时传 taskId）

### backend
- `backend/app/modules/spec_workspace/router.py`（sync/sync-incremental 端点解析 X-Change-Write-Id 头透传 service）
- `backend/app/modules/spec_workspace/service.py`（apply_sync/apply_ops 接收 change_write_id，循环内独立 session 回写 processed）

### 不改（复用 P1）
- progress 端点 / model 列 / 迁移（P1 已就位）
- 前端 workspace-config-card Progress 条 / 轮询（P1 已就位）
- DaemonChangeWrite model（files_processed 列已在）

## 接口定义

无新端点。HTTP 头约定：
- daemon → backend sync/sync-incremental 请求加 `X-Change-Write-Id: <uuid>`（可选，缺省则不回写 processed，向后兼容）。

## 决策记录（decisions.md）

- **D-001@V2 逐文件级（推翻 P1 D-001 阶级级）**：P1 D-001 取阶段级（0→total），实测中间无推进。
  本 change 改逐文件（1/35...35/35）。取舍：apply 循环内独立 session 回写破主事务强一致
  （processed 中间值可能超前，终态 complete 覆盖一致），换真实逐文件进度。
- **D-002@V1 N 次 UPDATE 性能**：每文件一次独立 UPDATE（单行轻量）。活跃树数十~百文件可接受；
  超大树留"每 K 文件回写一次"优化空间（本 change 不做）。
- **D-003@V1 方案C（分批发 ops）否决**：分批与 apply_ops 乐观锁（base_version）不兼容——批1 推进
  server version 后批2 base_version 过期误判 conflict。Design Grill 审查揪出，改采方案 A。

## 风险登记（Risk）

| # | 风险 | 缓解 |
|---|---|---|
| 1 | 循环内 N 次独立 session UPDATE 连接池压力 | 单行轻量 UPDATE；短生命周期 session；超大树留 K 文件合并优化 |
| 2 | 主事务失败时 processed 已推进不一致 | 终态 complete 翻 status=done/failed，前端 done 后不读 processed；processed 中间值无实际危害 |
| 3 | X-Change-Write-Id 头缺失（旧 daemon） | 后端头缺失则不回写 processed（向后兼容，回退 P1 行为 0→total） |
| 4 | 独立 session 写时 outbox 行非 claimed（如已 done） | UPDATE 加 `WHERE status='claimed'` 守卫，非 claimed 不写（对齐 BL-3） |

## 生命周期契约

不涉及生命周期契约（本 change 不改 daemon outbox 状态机 / progress 端点 / lease。processed 回写是
apply 循环内的 UPDATE（D-004 单一写者语义：complete 不碰计数列不变），status==claimed 守卫对齐 BL-3）。

## 自审（Self-Review）

- [x] 必填章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）。
- [x] frontmatter 字段齐全（author/created_at/scale/risk_level）。
- [x] 含「自审」字面章节。
- [x] 涉及 daemon/outbox 关键词，已含「生命周期契约」豁免说明。
- [x] D-001@V2/D-002@V1/D-003@V1 决策已记录（含方案C 否决理由）。
- [x] 文件变更清单：daemon 3 + backend 2，前端不改（复用 P1）。
- [x] 与 P1 衔接明确：progress 端点/D-004/BL-3/前端 Progress 复用不重写。
- [x] 方案C 乐观锁矛盾已规避（改方案 A 不分批）。
- [x] 风险4 加 status='claimed' 守卫（对齐 BL-3，防终态行被写）。
- ⚠️ 自审存疑：router 解析 X-Change-Write-Id 头的具体方式（Request.headers vs 依赖注入）需 plan 细化；
  独立 session 回写的异常处理（UPDATE 失败是否阻塞 apply 主流程——应 best-effort 仅 warn）需 plan 明确。
