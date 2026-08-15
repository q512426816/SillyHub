---
author: qinyi
created_at: 2026-08-16 00:02:00
scale: large
risk_level: unit-sufficient
---

# 设计文档（Design）— 变更中心 step 级进度展示

## 1. 背景

变更中心目前只显示 change 级 `current_stage`（brainstorm / plan / execute… 一行文本）。用户看不到当前阶段内部走到哪一步（如 brainstorm 的 step 3/8「对话式探索」、quick 的 step 2/3「实现并验证」），变更执行过程是黑盒。

关键实证（2026-08-15 排查）：**数据早已存在**。sillyspec CLI 进度上行的六表 JSON（`latest_progress`）中 `steps[]` 数组含每 step 的 `name / status(completed|pending|in-progress) / output 摘要 / completed_at / ordering / wait_reason 等待原因`，`platform_change_progress.latest_progress` 已落库（每变更约 20KB）。读侧 `_extract_current_stage` 只投影 stage 名，steps 无人消费——纯展示层缺口。

## 2. 设计目标

1. 变更中心**列表页**：阶段徽章增强为 step 级——`step x/y + 当前步名 + 迷你进度条`，进行中蓝脉动 / 等待用户决策黄高亮 / 全完成绿勾。
2. **详情页**：按 stage 分组的完整步骤时间线——已完成步含 output 一句话摘要与完成时间；等待步显示 wait_reason。
3. 实时：智能轮询（列表 30s / 详情 10s），内容比对无变化跳过重渲染，终态停轮，页面不可见暂停。
4. **硬约束（用户明确要求）**：刷新后页面不乱跳——滚动位置 / 选中态 / 展开态不丢失，列表行不因轮询重排（稳定 key diff，不整表重挂载）。
5. 性能：查询零新增（复用现有批量投影 SQL）、零 FS 访问（纯 DB 读，无 Windows bind mount stat 坑）、列表响应每行仅增 ~200B。

## 3. 非目标

- 不改 sillyspec CLI / daemon 的进度上报链路（数据已齐）。
- 不做 SSE / WebSocket 推送（D-001@v1 已选智能轮询；连接管理复杂度不值）。
- 不把 steps 展开成数据库表（无 SQL 查询需求，避免双源一致性维护）。
- 不做跨变更聚合看板 / 历史步骤统计。
- 不展示 `batch_progress`（execute 批量进度，另一形态，本期不涉及）。

## 4. 拆分判断

单一功能横切 backend + frontend 两层但耦合紧密（API 字段形状决定前端组件 props），一个变更交付；不拆分、不走批量模式（无重复模式任务）。

## 5. 总体方案

### Phase 1：后端读侧扩展

`_project_current_stage`（service.py:1506）现有批量 IN 查询已把整份 `latest_progress` JSON 拉到内存，仅返回 `(stage, completed_stages)` 二元组。扩展：

1. 返回值改为 `(stage, completed_stages, latest_progress: dict | None)` 三元组——数据已在手，零新增查询。**调用方适配（Grill P0-1）**：`_resolve_pending_change_keys`（:1495-1502）硬编码二元组解包 `stage, completed = info` → 同步改为三元组解包 `stage, completed, _ = info`；该函数行为不变（不消费 steps），补一条守护测试防回归。
2. 新增静态提取器 `_extract_step_progress(latest_progress) -> tuple[StepProgressSummary | None, list[StepTimelineEntry] | None]`：
   - 摘要：`step_total` / `steps_completed` / `current_step_name` / `current_step_status`(active|waiting|done) / `current_step_desc`（当前步 output 截断，无则 None）。取**全部 stage 的 steps**——排序规则（Grill #14）：按 `STAGE_ORDER`（dispatch.py:38-44 现有常量）给 stage 分组定序，`quick` 及未知 stage 名追加在已知序之后、按 `ordering` 排序；组内按 `ordering`。当前步 = 第一个非 completed 步；`wait_reason` 非空 → status=waiting。
   - 明细：全量 steps 映射为 `StepTimelineEntry {name, stage, status, output(截断200字), completed_at(归一化 ISO 8601，见下), ordering, wait_reason}`。
   - `completed_at` 归一化（Grill #18）：CLI 原值是 `"2026/8/15 23:44:08"` 本地格式字符串——后端提取器解析为 ISO 8601 UTC（`datetime.strptime(s, "%Y/%m/%d %H:%M:%S")` 按本地时区→UTC，解析失败保留原字符串），杜绝前端 Safari `new Date()` 坑。
   - 防御式 isinstance 逐层判型（对齐 `_extract_current_stage` 范式）；`steps` 缺失 / 空数组 / 结构异常 → `(None, None)`，调用方不赋值 → 前端降级现有展示。
3. `enrich_summaries`（:1454）填 `summary.step_progress`；`enrich_with_workspace_ids`（:1433）填 `read.steps` + `read.step_progress`。注意（Grill #11）：`enrich_with_workspace_ids` 也被 transition/advance-stage/review 响应复用（router `_build_transition_response`）——这些端点响应同样会带 steps 明细（additive 无害）；「明细仅详情接口」的准确表述是「列表接口只带摘要，明细随 ChangeRead 形状出现在所有返回 ChangeRead 的端点」。

### Phase 2：前端展示 + 智能轮询（react-query）

**选型定夺（Grill P0-2，D-004@v1）**：轮询用仓库已有的 **react-query `useQuery` + `refetchInterval`**，不自研 useSmartPoll——理由：仓库已装 react-query@5.51 且有全局 Provider（providers.tsx）与 useQuery 范式；`structuralSharing`（默认开启）引用相等跳过 re-render 天然实现"内容不变不重渲染"；`refetchIntervalInBackground` 默认 false 恰好满足"页面不可见暂停"；`refetchInterval` 支持函数形式可动态返回 `false` 实现终态停轮。现有页面裸 `useEffect + apiFetch + useState` 的 load 改造为 useQuery（queryKey 带筛选参数，保持现有请求参数与错误处理语义）。

1. `ChangeStepBadge`（列表）：stage 徽章 + `step x/y` 迷你进度条 + 当前步名；状态色映射——**全枚举白名单**（Grill #4，对齐 model.py StepStatus 7 值）：completed→绿、in-progress→蓝脉动、pending→灰、waiting/wait_answer 等待类→黄+「等待用户决策」chip、failed→红、blocked/stale→橙；未知值→灰。摘要层 `current_step_status` 由后端判定（active/waiting/done 三值），前端只消费摘要做徽章色，明细 7 值只在时间线渲染。
2. `ChangeStepTimeline`（详情）：垂直时间线按 stage 分组（替换现有 `SillySpecStepProgress`，Grill #17，D-005@v1——旧组件数据源是 `change.stages`（dispatch 快照），与新 latest_progress 数据源并存会同屏不一致；新组件数据更全（含 output/wait），旧组件由新组件完全替代并删除引用）；已完成步（绿点 + 完成时间 + output 摘要）、进行中（蓝点脉动）、等待（黄点 + wait_reason）、失败（红点）、未来步（灰色）。组件按 entry 列表做 key 级 diff，仅变化节点重渲染。
3. 列表页（page.tsx）：数据获取改 useQuery（queryKey=['changes', filters]）+ `refetchInterval: (query) => 存在非终态变更 ? 30000 : false`；Table `rowKey="id"` 不变（:551），数据替换靠 react-query structuralSharing 按行引用相等跳过重渲染。详情页（[cid]/page.tsx）同理 `refetchInterval: (q) => 变更终态 ? false : 10000`。
4. 终态定义（Grill #2，可测试）：变更 `status == "archived"` 或 `location == "archive"`（changes 表仅 active/archived 两值，无 failed——失败语义在 steps 层由 7 值枚举承载）。列表停轮条件 = 当前页全部行终态；详情停轮 = 该变更终态。
5. 内容比对字段闭包（Grill #3）：react-query structuralSharing 已按响应全对象引用比对，无需自算 hash——「跳过重渲染」的正确实现即 structuralSharing 默认行为，设计不引入额外 hash 函数（YAGNI）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/change/service.py | `_project_current_stage` 返回值扩展 + `_resolve_pending_change_keys`(:1495) 解包适配 + 新增 `_extract_step_progress`；`enrich_summaries` / `enrich_with_workspace_ids` 填充新字段。producer=platform_change_progress.latest_progress(JSON) → `_extract_step_progress`(归一化/截断/防御判型) → consumer=ChangeSummary.step_progress / ChangeRead.steps |
| 修改 | backend/app/modules/change/schema.py | 新增 `StepProgressSummary` / `StepTimelineEntry` 模型；`ChangeSummary.step_progress: StepProgressSummary \| None = None`；`ChangeRead.steps: list[StepTimelineEntry] \| None = None` + `step_progress`。producer=service 提取器 → consumer=前端 api-types |
| 修改 | frontend/src/lib/api-types.ts | `pnpm gen:types` 重生成（含新 optional 字段），禁止手写 |
| 新增 | frontend/src/components/changes/change-step-badge.tsx | 列表 step 徽章组件（7 值状态色映射 + 降级渲染） |
| 新增 | frontend/src/components/changes/detail/change-step-timeline.tsx | 详情步骤时间线组件（替代 SillySpecStepProgress） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx | 数据获取改 useQuery+refetchInterval(30s) + 列表列渲染换 `ChangeStepBadge` |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | 详情页换 `ChangeStepTimeline`（删 SillySpecStepProgress 引用）+ useQuery+refetchInterval(10s) |
| 删除 | frontend/src/components/sillyspec-step-progress.tsx | 被 ChangeStepTimeline 替代（数据源 change.stages → latest_progress 统一）；引用点：[cid]/page.tsx、change-agent-run-log.tsx(:7-9,:91)、change-agent-run-log.test.tsx(:9 mock) 一并清理/适配 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | 列表页测试适配（列渲染 + useQuery 改造） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx | 详情页测试适配（组件替换） |
| 新增 | backend/app/modules/change/tests/test_step_progress.py | 提取器单测（含 7 值枚举/completed_at 归一化/降级）+ enrich 集成测试 + `_resolve_pending_change_keys` 回归守护 |
| 新增 | frontend/src/components/changes/__tests__/change-step-badge.test.tsx | 徽章组件测试（含降级/7 值色映射） |
| 新增 | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | 时间线组件测试 |

注：quick --files 审计硬拦删除——`sillyspec-step-progress.tsx` 的删除在 execute 内以「修改为 re-export 桩或由调度者 git rm」方式落地，设计按删除登记。

## 7. 接口定义

```python
# schema.py 新增
class StepProgressSummary(BaseModel):
    step_total: int                      # 全 stage 步骤总数
    steps_completed: int                 # 已完成数
    current_step_name: str | None        # 第一个非 completed 步名（全完成→None）
    current_step_status: str | None      # "active" | "waiting" | None(全完成)
    current_step_desc: str | None        # 当前步 output 截断（无→None）

class StepTimelineEntry(BaseModel):
    name: str
    stage: str
    status: str                          # CLI 原值透传（7 值枚举，见下）
    output: str | None                   # 截断 200 字
    completed_at: str | None             # 归一化 ISO 8601 UTC（解析失败保留原串）
    ordering: int
    wait_reason: str | None

# 变更字段（全 optional，零 breaking）
ChangeSummary.step_progress: StepProgressSummary | None = None
ChangeRead.step_progress: StepProgressSummary | None = None
ChangeRead.steps: list[StepTimelineEntry] | None = None
```

CLI steps `status` 全枚举（backend model.py StepStatus 7 值 + progress.js 实证 3 值并存）：`completed` / `pending` / `in-progress`（实证常见）+ `failed` / `blocked` / `waiting` / `stale`（模型层存在）。透传原值，前端白名单色映射，未知值按 pending 灰渲染。摘要层 current_step_status 由后端归一为 active/waiting/done 三值。

```typescript
// 轮询（react-query 既有能力，无自研 hook）
const listQuery = useQuery({
  queryKey: ["changes", workspaceId, filters],
  queryFn: fetchChanges,
  refetchInterval: (query) =>
    hasActiveChanges(query.state.data) ? 30_000 : false,   // 全终态停轮
  // refetchIntervalInBackground 默认 false = 页面不可见暂停
});
const detailQuery = useQuery({
  queryKey: ["change", workspaceId, changeId],
  queryFn: fetchChange,
  refetchInterval: (query) =>
    isTerminalChange(query.state.data) ? false : 10_000,
});
// structuralSharing（react-query 默认）：响应深层引用相等 → 跳过 re-render（不乱跳核心）
// isTerminalChange = status === "archived" || location === "archive"（可测试定义）
```

## 8. 数据模型

无表结构变更。`platform_change_progress.latest_progress`（JSON 列）为唯一数据源，读时投影。

## 9. 兼容策略（brownfield）

- 未上行过 steps 的旧变更 / 平台占位行：`steps` 缺失 → 提取器返回 None → 字段不赋值 → 前端降级为现有 current_stage 展示（视觉与今天完全一致）。
- 旧前端 / 旧 api-types：新字段全 optional，不读不受影响。
- 回退路径：字段全部 additive，回退 = 前端不渲染新组件即可，后端字段闲置无害。
- 不改任何现有 API 语义 / 表结构 / CLI 契约。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | latest_progress JSON 结构异常（旧版本 CLI / 手写占位）导致提取器抛错 | P1 | 防御式 isinstance 逐层判型（对齐 _extract_current_stage 范式），异常结构返回 (None, None) 不抛 |
| R-02 | 列表响应膨胀（每行带 steps 明细） | P1 | 列表只带摘要（~200B，不含 output 全文）；明细随 ChangeRead 形状出现（详情 + transition 复用端点，additive 无害） |
| R-03 | 轮询风暴（多 tab × 多 agent 并发刷新） | P2 | 列表 30s 间隔 + react-query structuralSharing 跳过重渲染 + 终态停轮 + 后台暂停；单次查询微秒级（29 行 × 20KB JSON，表总 448KB） |
| R-04 | 刷新导致页面乱跳（用户硬约束） | P0 | react-query structuralSharing 引用比对跳过 re-render；Table rowKey 稳定（id）；时间线 entry 级 diff；**已实证排除排序重排**：steps 上行只写 platform_change_progress.updated_at（platform_sync/service.py:264-272），不触碰 changes.updated_at，纯 step 推进不会改变列表排序（默认 updated_at desc）；例外=旧 POST /changes/{key}/progress 端点会写 updated_at，但 daemon 源码无调用方，design 注明不处理 |
| R-05 | output 字段含超长文本 / 换行破坏布局 | P2 | 后端截断 200 字；前端 line-clamp + word-break |
| R-06 | steps 数据跨 stage 累积（多阶段变更 steps 数组持续增长，列表摘要跨全部 stage 统计）语义歧义 | P2 | 摘要取全部 steps（体现总进度）；当前步名取全局第一个未完成步——与 progress show 的观感一致 |
| R-07 | 列表页数据获取从裸 useEffect+useState 改 useQuery 引入回归（加载态/错误态/筛选语义漂移） | P1 | 保持现有请求参数与错误处理语义逐项对齐；page.test.tsx 全量适配跑绿；分页/筛选行为对照测试 |
| R-08 | 删除 SillySpecStepProgress 影响其既有测试/引用残留 | P2 | execute 内 grep 全部引用点清理；page-team-toggle.test.tsx 适配 |

## 11. 决策追踪

| 决策 | 版本 | 覆盖 |
|---|---|---|
| D-001@v1 刷新机制=智能轮询+稳定渲染（不乱跳） | accepted | §5 Phase 2 / R-04 |
| D-002@v1 数据源=现有六表 steps[]，零上报改动 | accepted | §1 / §5 Phase 1 / §8 |
| D-003@v1 steps 缺失优雅降级 | accepted | §9 / R-01 |
| D-004@v1 轮询实现=react-query useQuery+refetchInterval（不自研 hook） | accepted（Design Grill P0-2 定夺） | §5 Phase 2 / §7 / R-03 / R-04 |
| D-005@v1 详情页 ChangeStepTimeline 替换 SillySpecStepProgress（统一数据源） | accepted（Design Grill #17 定夺） | §5 Phase 2 / R-08 |

无未解决决策。

## 12. 自审（Self-Review）

- ✅ 章节齐全：背景/目标/非目标/拆分/方案/清单/接口/数据模型/兼容/风险/决策/自审。
- ✅ 文件清单含数据流标注（producer→consumer 两跳全交代：latest_progress → 提取器 → API 字段 → api-types → 组件）。
- ✅ 生命周期契约表：不涉及 session/lease/agent_run/daemon/lifecycle 状态转换（纯读侧展示），判定无需该表。
- ✅ 性能预算核对：查询零新增 ✓（`_resolve_pending_change_keys` 解包适配已列）、纯 DB 零 FS ✓、响应增量 ~200B/行 ✓、轮询有界（30s/10s/停轮/后台暂停）✓。
- ✅ 兼容核对：新字段全 optional、降级路径明确、无 migration。
- ✅ Grill P0/P1 全部落设计：P0-1 解包适配（§5 Phase 1.1 + 清单）、P0-2 react-query 选型（D-004@v1）、#2 终态可测试定义、#3 structuralSharing 替代自算 hash、#4 七值枚举白名单、#7 两个既有测试文件入清单、#11 R-02 措辞修正、#14 STAGE_ORDER+quick 兜底排序、#17 组件替换（D-005@v1）、#18 completed_at 后端归一化 ISO。
- ✅ 原型已确认：prototype-change-step-visibility.html（用户 2026-08-15 确认）。
