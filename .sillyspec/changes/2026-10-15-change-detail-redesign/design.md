---
author: qinyi
created_at: 2026-10-15 23:49:03
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-10-15-change-detail-redesign

> 变更：变更详情页（桌面）信息架构重设计
> 原型（批准稿，prototype-as-code 真码产物）：`.sillyspec/changes/2026-10-15-change-detail-redesign/prototype-change-detail-v2.html`
> 原型源码：`frontend/src/components/prototype/change-detail-v2-view.tsx`（编译管线 `frontend/scripts/prototype-build.mjs` → `pnpm prototype:build`）
> 决策记录：`.sillyspec/changes/2026-10-15-change-detail-redesign/decisions.md`（D-001~D-016，含 2 条 rejected）

## 背景

用户原话：「我想重新设计下变更详情页面，现在显示太乱，而且感觉不够直观清晰」。

页面实体 = `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`（591 行编排层）+ `frontend/src/components/changes/detail/` 下 11 个组件 + 侧栏 4 卡。近月已被增量补丁多次（2026-08-11-change-detail-layout-rework 定「左主右辅」、2026-09-26-core-pages-visual-redesign primer 化、2026-09-28-change-ux-detail-batch、2026-10-15-change-assets-graph 主栏重排 + 步骤时间线默认收起），每次都在既有骨架上加卡，结构本身未变。

确诊乱源四类（均为代码取证，非主观判断）：

1. **两条时间线讲同一件事**：`ChangeStepTimeline`（数据源 `ChangeRead.steps`）与 `ChangeTimelineCard`（数据源 `GET /changes/{cid}/timeline`）都展示时间戳 + 任务名 + 完成状态——`frontend/src/components/changes/detail/change-step-timeline.tsx:189-220`（步骤行：名称/状态点/时间/output）与 `frontend/src/components/changes/detail/change-timeline-card.tsx:107-115,257-287`（事件行：时间 + kind 图标 + label；任务行：☑ + 时间 + task id + desc + commit_sha），两卡在 `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx:435-475` 与 `:484` 并挂。
2. **页面按阶段不变形**：`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx:405` 起的网格与全部卡片挂载点无状态分叉，归档页与在途页渲染同一套卡；`frontend/src/components/changes/detail/change-assets-card.tsx:248-261` 同时在途空态与归档空态两套文案并存互相打架。
3. **单卡过载**：`frontend/src/components/changes/detail/change-assets-card.tsx` 861 行 = 8 个分组（每组固定高度组内滚动）+ 内嵌知识图谱分区（`:242-246`）+ 4 个弹窗；字号 6 档、徽标色系 ≥5；侧栏 `frontend/src/components/changes/scope-audit-command-card.tsx` 778 行常驻。
4. **首屏弱信息前置**：进页面先经「阶段条 → 最后信号（`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx:383`）→ 执行用量卡（`:391`）」三行全宽内容，真正要用户操作的审批卡被推到 `:408`。

## 设计目标

1. **首屏回答「现在要做什么」**（D-001）：在途态首屏 = 待办（有待办时）+ 进度摘要 + 最近动态；归档态首屏 = 成果总结（资产计数 / 改动规模 / 墙钟）。
2. **信息按性质分区，不再一路堆叠**（D-002）：页面主体为顶部四 tab（概览 / 产出 / 过程 / 文件与对账），首屏只留概览；tab 状态写入 URL（D-013）。
3. **消除重复**（D-005 / D-014）：两条时间线合并为一条统一时间线；task-done 事件折叠进任务清单（同源确定重合）；合并时限不引入名称/时间近似匹配。
4. **重的分区独立、轻的下沉**（D-003 / D-004 / D-006）：知识图谱脱离资产卡成为「产出」tab 内独立分区；范围对账下沉至「文件与对账」；执行用量与会话入口压缩进概览右侧信息栏。
5. **状态自适应、两态互不污染**（D-007 / D-015）：归档态隐藏「文件与对账」；tab 集判定输入只有 `isTerminalChange` 一个布尔；归档态不得渲染在途空态，在途态不得渲染归档空位。
6. **先看见再实现**（D-008）：原型已产出并通过用户批准（prototype-as-code 真码产物），实现按「接线」而非「翻译」。

## 非目标

- **不改移动端**：`frontend/src/app/m/workspaces/[id]/changes/[cid]/page.tsx` 与本变更无关（D-011）；移动端复用的全部 import 符号（逐符号表见「兼容策略」）必须保持可用，但不改其调用方。
- **不改后端**：两条时间线在前端无损合并，无需新增端点或字段（无需 `gen:types` 三端义务）。
- **不改业务语义**：审批（`submitStageReview`）、派发、verify 门禁、scope-audit 计算、知识图谱查询端点全部原样复用，只改展示位置与编排。
- **不换组件库**：继续 primer（结构组件）+ `@/components/ui` 的 Badge/Button；控件事项照旧，不引 antd 新组件（`FRONTEND_PAGE_STYLE.md` §13 消费纪律）。
- **不做 tab 内嵌套 tab / 二级折叠迷宫**：面板内最多一级分组，禁止再套 tab。
- **不改变更列表页**：`frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx` 不动（仅其 tab 深链形态作为 D-013 先例被引用）。

## 拆分判断

单一页面的展示层重构，涉及文件多但同属一个前端模块、一个主题（信息架构），且 task 之间存在硬顺序（骨架冻结才可并行做面板；面板定稿才可算合并时间线）。因此**不拆批量**，作为一个 change 整体走完整流程（对齐 2026-08-11-change-detail-layout-rework 先例）。规模判 large 的证据：新组件族 + 页面重写 + 旧组件退役 + 合并算法纯函数 + 原型接线 + 测试面（页面级 3 文件 + detail 11 文件约 126 用例须同步），单上下文吃不下；且 Phase 2 的四面板（概览/产出/过程/文件与对账）构成**可真并行任务簇**（互不依赖，只依赖 Phase 1 冻结的容器契约与 props 类型）。

## 总体方案

### Phase 1 · 骨架（tab 容器 + 状态分叉 + URL 驱动）

`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` 瘦身为编排层：保留既有取数（`getChange` 10s 轮询 + `isTerminalChange` 终态停轮 + `listWorkspaceAgentSessions` 近似绑定会话）与删除动作（`DetailDeleteAction` 原样保留），新增：

- **页头改用 primer `PageHead`**（面包屑 + 标题 + 状态胶囊 + 元信息 + 操作），替换现 `PageHeader` + 手写徽标三态分支（`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx:258-296` 的 IIFE 徽标逻辑收敛为状态胶囊映射）。
- **阶段条常驻**于 tab 栏之上（`ChangeStageHeader` 组件本体复用，其阶段-步骤联动语义改为「点阶段 → 切到过程 tab 并置筛选」）。
- **`ChangeTabs`**：`UnderlineNav` 驱动，`?tab=` 为唯一源（`useSearchParams` + `router.replace`，缺省/非法值回落 `overview`）。
- **状态分叉**：`StateBody` 按 `isTerminalChange(change)` 决定 tab 集（在途 4 / 归档 3）。

### Phase 2 · 四面板（可真并行任务簇）

并行前提：Phase 1 冻结 tab 容器契约与各面板 props 类型后，四面板互不依赖。

| 面板 | 内容与关键行为 |
|---|---|
| **概览** | 待办卡（`ChangeStageActions` 复用，仅 `pending_review` 命中面板表时渲染；thin/quick/不可审批分支维持既有 `null` 行为）→ 摘要 `StatGrid`（在途：阶段/任务/已用/最后信号；归档：需求/决策/改动文件/净增行）→ 最近动态（统一时间线尾部 5 条，**倒序、轻量行、不带筛选器与合并口径说明**——筛选器与口径只在过程 tab 出现）→ 归档态额外插「归档留档」卡。右侧信息栏 = primer `MetaPanel`：基本信息 / 执行用量 / 会话 / 范围对账计数（归档态链接改指产出 tab 的归档留档，不留悬空）/ 产出速览（计数 + 入口）。**用量区取数形态（Grill Q-4 定）**：MUST 复用现有 `ChangeUsageCard` 的取数（`GET /changes/{cid}/usage` + 按模型明细），实现上抽为共享 hook/子渲染单元，**MUST NOT 在概览侧栏另写一份取数与格式化（禁止双实现漂移）**；侧栏只做压缩排版（值行 + 截断 + 悬浮全文），明细展开入口在侧栏内保留（归档态按 Phase 4 契约隐藏）；「会话」显示条数为 SHOULD 2-3 条（软约束，实施按栏高定） |
| **产出** | `ChangeAssetsGraph` 提升为独立分区（全宽，画布高度默认 **420px**（`DEFAULT_CANVAS_HEIGHT` 具名常量，替代原内嵌 280px；批准稿 300px 为示意值，生产取 420px 以容纳节点标签与详情栏），右侧节点详情栏保留）→ 六组资产 2 列网格（需求规则 / 决策蒸馏 / 知识触达 / 测试绑定 / 模块触达 / 归档留档）：**自然高度 + 每组最多 5 行 + 「展开全部 N 条」**（取代固定 `h-64` + 组内滚动）；在途态**不渲染归档留档组**（D-001）；四个弹窗（测试文件 / 模块文档 / patch 单文件 diff / 知识条目）机制原样保留 |

| **过程** | `ChangeUnifiedTimeline`（Phase 3）+ `ChangeTaskChecklist`（tasks[] 勾选清单：☑/☐ + task id + 描述 + ≈推断时刻 + 提交锚 + 勾选比）+ 阶段耗时 `StatGrid`。**不再挂载** `ChangeStepTimeline` 与 `ChangeTimelineCard` |
| **文件与对账** | 变更文件：文件树**在 tab 内直接内嵌**（左树 + 右预览/diff，D-012），不再以 Dialog 为唯一入口 → 范围对账（`ScopeAuditCommandCard` 复用，含三态 chips / 分仓明细 / 明细弹窗 / 折叠本地命令）→ 关联的快速任务（`QuicklogLinkedCard` 复用，空/失败仍静默隐藏） |

**产出的空态与错误分支契约（Grill B-3 + 定义层①② 修订）**：

- **分区级空态（图谱）**：触发条件 = 查询 `isError` / `available=false` / `nodes` 为空三态之一；呈现 = 分区容器保留（标题 + 「层级」chips 禁用态 + 一行说明文案，文案区分三态：「图谱数据不可用」「图谱数据暂不可用，稍后自动重试」「本变更暂无图谱邻域」），MUST NOT 整区消失。`retry:false` 口径不变（不轰炸）。
- **资产卡整卡错误分支改造（B-3）**：`change-assets-card.tsx:181` 现为「主查询 isError → 整卡 `return null`」。改造后 MUST 改为**分区级错误说明**（卡头保留 + 一行「沉淀资产暂不可用」），理由：归档态的降级路径正是「产出 → 归档留档」（D-007），整卡静默消失会让该路径无解释地断掉。
- **归档留档保底渲染（Q-3 定）**：归档态下，若资产主查询失败，MUST 仍渲染「归档留档」分区并以其自身取数（`assets/patch-file` 与 patch 摘要）呈现可用部分；MUST NOT 因主查询失败而整体缺失归档改动面。
- **MUST NOT 出现**：整 tab 白屏、无解释的大面积空白、把失败伪装成「无数据」。

### Phase 3 · 合并时间线（纯函数 + 组件）

**纯函数 `mergeChangeTimeline(input)`**（可单测，零取数）：

```ts
interface MergeInput {
  steps: StepTimelineEntry[] | null;     // change.steps
  events: TimelineEvent[];               // GET /changes/{cid}/timeline → events
  bornAt: string | null;                 // 同端点 → born_at
}
interface UnifiedRow {
  key: string;                           // 源内稳定键
  at: string | null;                     // ISO（无时间戳者 null）
  source: "born" | "step" | "event";
  stage: string | null;                  // 步骤侧直取；事件侧按 kind 映射（verify/gate-run→验证，archived→归档，其余→null）
  tone: "success" | "current" | "default" | "warning";
  title: string;                         // 步骤 name / 事件 label
  detail: string | null;                 // 步骤 output（事件侧 null）
  waitReason: string | null;
  commitSha: string | null;              // 事件 kind=commit 的 detail
  commitTitle: string | null;
  meta: string | null;                   // 状态文案 / 事件 kind 中文
}
function mergeChangeTimeline(input: MergeInput): UnifiedRow[];
```

**口径（D-014，三层，无近似匹配）**：

1. **源内严格去重**：步骤键 = `step:${stage}:${ordering}`（`StepTimelineEntry` 有 `stage`/`ordering` 稳定字段、无 id）；事件键 = `event:${ts}:${kind}:${label}`；诞生锚键 = `born`。
2. **task-done 折叠**：`kind === "task-done"` 且 detail 命中 tasks 域（`checked N→M` 的 stage 前缀为 `tasks` 或缺省）→ 不产出时间线行（该信息由 `ChangeTaskChecklist` 承载，其勾选时刻本就由这些事件推断而来，`backend/app/modules/change/timeline.py:96-122`）；非 tasks 域（如 `design · checked 0→6`）保留为普通事件行。
3. **排序**：有 `at` 者按 ISO 字符串正序（与后端 `ts` 字典序=时间序一致），无 `at` 者（pending 步骤）置于末尾并按阶段序（`brainstorm→plan→execute→verify→archive→thin→quick`）稳定排序。

**三个未闭合输入类的显式取舍（Grill B-2 修订，均入单测）**：

| 输入类 | 来源事实 | 本设计处置 |
|---|---|---|
| `completed_at` 非 ISO 残留原串 | `backend/app/modules/change/schema.py:58`「解析失败保留原串」 | 排序前先对 `at` 做可解析判定：可解析者按时间序、不可解析者与无时间戳者同置末尾（保持稳定序），MUST NOT 混入字典序比较（否则残留原串会污染全序）；单测覆盖 |
| 事件键同键碰撞（同 `ts` + 同 `kind` + 同 `label`） | `TimelineEvent` 无 id（`schema.py:951-957`），label 为 kind 或 detail 原文 | 保留去重（同秒同类型同文本视为同一观测的重复上报）并在口径说明中声明该取舍；MUST NOT 用序号后缀绕过（会造成不确定顺序）。若实测出现真实不同事件被误并，复潮路径见 D-016@v1 的「故障面/退役判据」（本表取舍由 D-016 承载） |
| task-done 推断断裂后时点无处承载 | `_infer_task_times` 遇 `start != cursor` 即 break（`backend/app/modules/change/timeline.py:113-117`），清单 `time=None` 显示 `?` | 折叠照旧（断裂后该事件不再是任务时刻的证据），但**断裂期间的任务行 MUST 显示「时刻不可推断（观测断链）」而非裸 `?`**，避免信息无声消失；单测覆盖断裂序列 |

**明确不做**：步骤行与任务行不跨源合并（粒度不同、映射非确定，见 D-014 证据）；两源独有字段全保留（步骤侧：阶段分组、等待原因、输出全文；事件侧：提交哈希与标题、文件/配置变更事件、墙钟统计）。

### Phase 4 · 收口

- **归档态收窄与空态清理**：隐藏「文件与对账」；概览转成果语义；两态互不出现对方空位文案（D-001/D-007）。
- **归档态两处自适应（原型已体现，此处补录为契约）**：①页头「继续执行」主按钮在归档态 MUST NOT 渲染；②概览右信息栏用量区标题在归档态为「执行用量（合计）」且 MUST NOT 提供「按模型明细」展开入口。
- **thin 规则**：不特判，与在途完整流程同四 tab（D-015）；thin 轻量流程条（`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx:337-364`）原样保留替换阶段条。
- **移动端契约兼容核查**：`frontend/src/components/mobile/mobile-change-detail.tsx:66-82` 的**全部** import 逐一核验可用——既含 7 个组件符号（`:71-77`），也含从本变更改写的页模块导出的 `isTerminalChange`（`:66-67`，源自 `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx:64`），以及列表页 `PENDING_REVIEW_LABEL`（列表页不动，天然满足）。核验口径见「兼容策略」。
- **`ChangeAgentRunLog` 桌面去留声明（Grill B-4）**：该组件当前桌面页即无挂载点（全仓非测试引用仅有组件自身与 `frontend/src/components/mobile/mobile-change-detail.tsx`），本变更**维持「桌面不挂载、仅移动端承载」**并在承接记录中对该分句（FR-styles-011「左主列 Timeline（事件流 + Agent 执行日志内嵌可折叠）」）写明处置，避免 D-009 承接表无处落笔。
- **旧组件退役**：`change-step-timeline.tsx` / `change-timeline-card.tsx` 从桌面页卸载；**文件保留**（移动端与测试面仍引用前者），仅移除页面挂载与相关页面级断言。
- **原型接线对照（含三处双向差异裁决）**：逐面板以批准稿为基准核对结构；批准稿与本文档的差异按如下裁决：①归档隐藏「继续执行」、②归档用量形态——**以批准稿为准**；③原型时间线无限高，生产端 MUST 补限高与超量折叠——**以本文档为准**（唯一「实现严于原型」项，按 R-05 留痕）。其余结构对不齐处按 `PROTOTYPE.md` 停机带截图裁决，禁止静默降级。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | 瘦身为 tab 容器：PageHead 化 + 阶段条常驻 + `?tab=` 驱动 + 状态分叉 + 四面板挂载；移除两时间线挂载与旧徽标 IIFE |
| 新增 | NEW:frontend/src/components/changes/detail/change-tabs.tsx | `UnderlineNav` 驱动的 tab 容器（props: change 状态、当前 tab、onChange；tab 集随归档收窄） |
| 新增 | NEW:frontend/src/components/changes/detail/change-overview-panel.tsx | 概览面板（待办卡 + 摘要 + 最近动态 + 右信息栏组合） |
| 新增 | NEW:frontend/src/components/changes/detail/change-overview-side.tsx | 概览右侧信息栏（MetaPanel：基本信息/用量/会话/对账计数/产出速览） |
| 新增 | NEW:frontend/src/components/changes/detail/change-unified-timeline.tsx | 统一时间线组件（消费 `mergeChangeTimeline` 输出） |
| 新增 | NEW:frontend/src/components/changes/detail/merge-change-timeline.ts | `mergeChangeTimeline` 纯函数 + `UnifiedRow` 类型（零取数，可单测） |
| 新增 | NEW:frontend/src/components/changes/detail/change-task-checklist.tsx | 任务进度清单（tasks[] 勾选态 + 推断时刻 + 提交锚 + 勾选比） |
| 新增 | NEW:frontend/src/components/changes/detail/change-files-panel.tsx | 文件与对账面板（内嵌文件树 + 范围对账 + 关联快速任务） |
| 修改 | frontend/src/components/changes/detail/change-assets-card.tsx | 图谱分区移出（改独立挂载）+ 分组网格由固定 h-64 内滚改自然高度 + 最多 5 行 + 「展开全部」+ 在途不渲染归档留档组 |
| 修改 | frontend/src/components/changes/detail/change-assets-graph.tsx | 由「资产卡内嵌分区」改为可独立挂载（画布高度参数化，默认值上调）；空态由整区静默隐藏改为分区级空态说明 |
| 修改 | frontend/src/components/changes/detail/change-stage-actions.tsx | 仅接线层调整（概览面板内挂载；不涉语义）——如无需改动则不列此行，实施时以实际 diff 为准 |
| 修改 | frontend/src/components/prototype/change-detail-v2-view.tsx | 批准稿原型的后续维护（若接线期发现原型与最终结构不一致需同步重编译） |
| 修改 | frontend/scripts/prototype-build.mjs | 已扩：新增 v2 视图条目 + 通用 tab/状态切换注入脚本（本变更内已提交） |
| 新增 | NEW:frontend/src/components/changes/detail/__tests__/change-tabs.test.tsx | tab 集随归档收窄 / `?tab=` 缺省与非法值回落 / 切换回调 |
| 新增 | NEW:frontend/src/components/changes/detail/__tests__/merge-change-timeline.test.ts | 合并口径单测：源内去重 / task-done 折叠（tasks 域与非 tasks 域）/ 排序 / 无时间戳置底 / 字段不丢 |
| 新增 | NEW:frontend/src/components/changes/detail/__tests__/change-unified-timeline.test.tsx | 统一时间线渲染（来源标签 / 展开输出 / 提交锚 / 空态） |
| 新增 | NEW:frontend/src/components/changes/detail/__tests__/change-task-checklist.test.tsx | 任务清单渲染（勾选态 / 推断时刻 ≈ / 提交锚 / 勾选比） |
| 新增 | NEW:frontend/src/components/changes/detail/__tests__/change-overview-panel.test.tsx | 概览面板（在途 vs 归档首屏 / 待办卡显隐 / 最近动态倒序且不含筛选器） |
| 新增 | NEW:frontend/src/components/changes/detail/__tests__/change-files-panel.test.tsx | 文件与对账面板（文件树内嵌渲染 / 对账卡挂载 / 快速任务空态隐藏） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | 断言面改造：两时间线共存断言（原 FR-auto-frontend-056 钉子）改为「统一时间线挂载 + 步骤/留痕两卡不再挂载」 |
| 新增 | NEW:frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-tabs.test.tsx | 页面级：`?tab=` 驱动 / 归档收窄 / `?tab=files` 在归档态的钳制 / 面板切换不重取数 / **页模块导出 `isTerminalChange` 仍在场且语义不变（B-1 验收面）** |
| 新增 | NEW:frontend/src/components/changes/detail/__tests__/change-assets-fallback.test.tsx | Grill B-2/B-3 边界：非 ISO `completed_at` 排序置底 / 事件同键碰撞去重取舍 / task-done 推断断裂显示「时刻不可推断」/ 资产卡错误分支分区级说明 / 归档态归档留档保底渲染 |

## 接口定义

**后端接口面：0 端点（无接口变更）**——不新增/修改端点、DTO、响应体；不涉 `gen:types`。

前端新增契约：

```ts
// change-tabs.tsx
export type DetailTab = "overview" | "assets" | "process" | "files";
export interface ChangeTabsProps {
  archived: boolean;                    // isTerminalChange 结果；决定 tab 集
  value: DetailTab;                     // 由 ?tab= 派生
  onChange: (t: DetailTab) => void;
}
export function visibleTabs(archived: boolean): DetailTab[];  // 归档 → 三 tab（无 files）

// merge-change-timeline.ts
export interface UnifiedRow { /* 见 Phase 3 */ }
export function mergeChangeTimeline(input: MergeInput): UnifiedRow[];

// change-overview-panel.tsx / change-files-panel.tsx / change-task-checklist.tsx
export interface ChangeOverviewPanelProps { change: ChangeRead; workspaceId: string; changeId: string; /* 待办相关 props 透传 */ }
export interface ChangeFilesPanelProps { workspaceId: string; changeId: string; changeKey: string; archived: boolean; }
export interface ChangeTaskChecklistProps { tasks: TimelineTask[]; }
```

## 生命周期契约表

本变更不涉及生命周期契约（session/lease/agent_run/daemon 的创建、心跳、状态转移、释放均不在改动面内）；绑定会话仅作展示（沿用既有「工作区最近活跃会话」近似口径，`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx:155-170`），审批提交仍走既有 `submitStageReview` 端点，语义不变。

## 数据模型

无数据模型变更（无表结构、无字段、无迁移）。

## 兼容策略（brownfield 必填）

- **移动端复用契约（硬约束，Grill B-1 修订后含页模块导出）**：`frontend/src/components/mobile/mobile-change-detail.tsx:66-82` 的 import 面**逐符号**如下，重构后 MUST 全部仍可解析且行为不变——

  | 来源模块（仓根相对路径） | 被引用符号 | 本变更对来源的动作 |
  |---|---|---|
  | `frontend/src/components/changes/change-activity-badge.tsx` | `ChangeLastSignal`, `lastSignalFromSteps` | 不改 |
  | `frontend/src/components/changes/change-step-badge.tsx` | `STAGE_LABELS` | 不改 |
  | `frontend/src/components/changes/detail/change-agent-run-log.tsx` | `ChangeAgentRunLog` | 不改（桌面本就未挂载，见 Phase 4 声明） |
  | `frontend/src/components/changes/detail/change-stage-header.tsx` | `WORKFLOW_STAGES` | 改（阶段条接线），导出 MUST 保留 |
  | `frontend/src/components/changes/detail/change-step-timeline.tsx` | `ChangeStepTimeline` | 仅桌面卸载，文件与导出 MUST 保留 |
  | `frontend/src/components/changes/detail/change-usage-card.tsx` | `ChangeUsageCard` | 改（抽共享取数供侧栏复用），导出与行为 MUST 保留 |
  | `frontend/src/components/changes/scope-audit-command-card.tsx` | `ScopeAuditCommandCard` | 改（换挂载点），导出与行为 MUST 保留 |
  | **`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`** | **`isTerminalChange`**（导出见 `page.tsx:64`） | **本次重写目标文件**——该导出 MUST 原地保留且语义不变（`status === "archived" \|\| location === "archive"`）；MUST NOT 迁到新模块并只在新模块导出 |
  | `frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx` | `PENDING_REVIEW_LABEL` | 不改（非目标，天然满足） |

- **页模块导出契约（B-1 专项）**：`[cid]/page.tsx` 除默认导出页面组件外，其具名导出 `isTerminalChange` 属**对外契约**（移动端消费），重写时 MUST 保留在同一文件同一语义；R-01 验收面 MUST 包含一条「移动端 import 面逐符号可解析」的断言（以 `mobile-change-detail` 测试 + 页模块导出单测共同兜底）。
- **深链与 URL**：`?tab=` 缺省/非法值回落 `overview`；**归档态或多 tab 收窄场景下、`?tab=files` 不在 `visibleTabs` 时 MUST 以 `router.replace` 钳制回 `overview`（不留空白面板，也不写死 files 面板）**；切换变更（路由参数变化）时残留的非法 `?tab=` 同规则钳制；旧深链（无参数）行为等同现状首屏；列表页 `?tab=quicklog` 等参数不受影响（不同路由）。
- **回退路径**：tab 容器为纯展示编排，若需回退，恢复 `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` 的旧挂载顺序即可（旧组件未被删除）。
- **不改变的 API 与表结构**：全部后端端点、DTO、`platform_change_events` 表、`change_reviews` 死表清理均不在本变更范围。
- **行为等价项**：10s 轮询与终态停轮、删除入口与权限启发式、审批卡四种分支（含 `null`）+ 通知降级文案、范围对账三态与降级指路、四个弹窗机制 —— 全部保持。
- **行为变更项（明确列示，避免与上条混读）**：①图谱不可用时的表现由「整区静默隐藏（fail-open 到无）」改为「分区级空态说明」（Phase 2 契约）；②资产卡主查询失败由「整卡消失」改为「卡头 + 分区级错误说明」；③归档态资产查询失败时「归档留档」由「随整卡消失」改为「保底渲染」。三项均为**从静默失败改为显式降级**，不改变任何数据来源与业务语义。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 移动端因桌面组件被改而静默损坏（历史上有「组件契约被迁移破坏」先例） | P0 | 保留被复用组件的文件与导出签名；改造后跑移动端测试（`frontend/src/components/mobile/__tests__/mobile-change-detail.test.tsx`）与页面级测试；`ChangeStepTimeline` 仅卸载不重构 |
| R-02 | 合并时间线口径在真实数据上表现与 fixture 不符（字段缺失、极端条数如 500+ 文件事件） | P1 | 纯函数以真实端点字段为准（`StepTimelineEntry`/`TimelineEvent`/`TimelineTask` 类型已核实）；补边界单测（空 steps / 空 events / 全无时间戳 / 非 tasks 域 checked 事件）；过程 tab 内时间线容器限高 + 超量折叠 |
| R-03 | tab 隐藏内容导致发现性下降（用户找不到原来一屏能看到的东西） | P1 | 概览右信息栏提供产出/用量/会话/对账四组入口 + 计数；概览「最近动态」带「查看全部 →」；实施后请用户在真页面上做一次找东西验证 |
| R-04 | 页面级既有测试大面积失败（3 个页面级文件 + 约 126 个 detail 用例中与挂载位置强相关的部分） | P1 | 断言面改造属本变更计划内工作（文件清单已列 `page-restore-assets.test.tsx` 改造 + 新增 `page-tabs.test.tsx`）；禁止为过测试而弱化语义断言（规则 9） |
| R-05 | 原型与最终实现结构漂移（接线期静默降级） | P1 | 按 `PROTOTYPE.md`「批准后怎么接线」执行：结构对不齐处停机带截图裁决；原型改动后必须重编译并复核（`git diff` 对账门） |
| R-06 | 取代 6 条活需求的记录不全 → 旧约束复潮（下次改动被知识注入按 active 约束拉回旧版式） | P1 | 按 D-009 逐条落 supersede 记录并在 requirements.md 建立承接表；交付后核对知识库索引状态 |
| R-07 | 一次性交付面大（页面重写 + 新组件族 + 算法 + 测试 + 原型），中途风险集中 | P1 | Phase 分批执行、每 Phase 测试绿门控；Phase 2 四面板并行前先冻结 Phase 1 契约 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 首屏分阶段自适应 → Phase 2 概览面板（在途/归档两套首屏）+ 风险 R-03 | 已覆盖 |
| D-002@v1 | 顶部四 tab → Phase 1 `change-tabs.tsx` + 文件清单；取代 FR-unmapped-497 与 FR-styles-011 | 已覆盖 |
| D-003@v1 | 图谱独立分区 → Phase 2 产出面板 + `change-assets-graph.tsx` 改造；取代 FR-build-133 | 已覆盖 |
| D-004@v1 | 范围对账下沉 → Phase 2 文件与对账面板；承接 FR-auto-frontend-090/021、FR-lib-changes-030 | 已覆盖 |
| D-005@v1 | 两时间线合并 → Phase 3 `mergeChangeTimeline`；取代 FR-auto-frontend-056 | 已覆盖（口径见 D-014） |
| D-006@v1 | 用量与会话入概览右信息栏 → Phase 2 `change-overview-side.tsx`；部分承接 FR-auto-frontend-038 | 已覆盖 |
| D-007@v1 | 归档态 tab 收窄 → Phase 1 `visibleTabs` + Phase 4 空态清理 | 已覆盖 |
| D-008@v1 | 原型驱动全量重写 → 原型已批准（本节头链接）+ Phase 4 接线对照 + 风险 R-05 | 已覆盖 |
| D-009@v1 | 活需求显式取代并落盘 → 本文件「兼容策略」+ requirements.md 承接表 + 风险 R-06 | 已覆盖 |
| D-010@v1 | 一次性完整交付 → 四个 Phase 同变更内交付，不留中间态 | 已覆盖 |
| D-011@v1 | 边界=桌面页 + 移动端契约兼容 → 兼容策略硬约束 + 风险 R-01 | 已覆盖 |
| D-012@v1 | 文件树 tab 内内嵌 → Phase 2 文件与对账面板 | 已覆盖 |
| D-013@v1 | tab 写 URL → Phase 1 `?tab=` 唯一源 | 已覆盖 |
| D-014@v1 | 合并口径三层 → Phase 3 口径段（源内去重 / task-done 折叠 / 不跨源合并） | 已覆盖 |
| D-015@v1 | tab 集只由归档布尔决定、thin 不特判 → Phase 1 + Phase 4 | 已覆盖 |
| D-016@v1 | Design Grill 首轮修订补录（B-1~B-6 / Q-1~Q-5 逐条处置）→ 本文件「审查修订记录」表 + 兼容策略逐符号表与页模块导出契约 + Phase 2 空态/错误分支契约 + Phase 3 三输入类取舍表 + 深链钳制规则 | 已覆盖 |

**取代清单的逐条落点（Grill 交叉点 3 补齐——design 侧点名，避免只在 decisions.md 出现）**：

| 被取代的活需求 | 其约束分句 | 本设计的落点 |
|---|---|---|
| FR-unmapped-497 | 左主右辅两栏 / <1024px 退化单列 | 由四 tab 结构整体吸收（Phase 1；窄屏为 tab 内单列） |
| FR-auto-frontend-056 | 步骤时间线卡与留痕时间线卡共存 | Phase 3 统一时间线（页面级钉子测试改造见文件清单） |
| FR-build-133 | 图谱分区位于资产卡内、右侧节点详情栏、不可用整区静默隐藏 | Phase 2 产出面板：独立分区 + 详情栏保留 + 不可用改分区级空态 |
| FR-build-134 | 主栏顺序 = 审批卡 → 沉淀资产 → 步骤时间线 → 留痕时间线 | 由 tab 结构取代：待办入概览主区首位、资产入产出 tab、时间线合一入过程 tab（Phase 2） |
| FR-auto-frontend-087 | 资产卡默认展开、移入主栏、各分组固定高度（超出滚动）网格对齐 | Phase 2 产出面板：分组长由「固定高度 + 组内滚动」改为「自然高度 + 最多 5 行 + 展开全部」；「移入主栏」语义由「产出 tab 主区」承接 |
| FR-styles-011 | 六阶段 checks 横条（当前高亮、可点筛选、阶段-时间线联动）/ 左主列 Timeline（事件流 + Agent 执行日志内嵌可折叠）/ MetaPanel 右栏 | 阶段条常驻且联动改为「点阶段 → 切过程 tab 并筛选」（Phase 1）；事件流并入统一时间线（Phase 3）；`ChangeAgentRunLog` 桌面不挂载、仅移动端承载（Phase 4 声明）；MetaPanel 右栏由概览右信息栏承接（Phase 2） |

## 审查修订记录（Design Grill 首轮，specVerdict=fail → 本轮修订）

| 编号 | 级别 | 缺陷 | 修订 |
|---|---|---|---|
| B-1 | P1（阻断） | 移动端 import 契约枚举遗漏页模块导出 `isTerminalChange`（`mobile-change-detail.tsx:66-67` ← `[cid]/page.tsx:64`），未完全满足 D-011 | 「兼容策略」改为**逐符号表**（含页模块导出行）+ 新增「页模块导出契约」专项 + `page-tabs.test.tsx` 加导出在场断言 + Phase 4 核验窗口由 `:73-77` 扩到 `:66-82` |
| B-2 | P2 | 合并口径 3 个未闭合输入类（非 ISO `completed_at` 排序 / 事件同键碰撞 / task-done 推断断裂后时点消失） | Phase 3 增「三个未闭合输入类的显式取舍」表（逐类处置 + 单一测试文件兜底） |
| B-3 | P2 | 资产卡整卡 `isError→null` 与分区级空态/归档兜底承诺张力；「改为分区级空态——全部保持」措辞自相矛盾 | Phase 2 增「产出的空态与错误分支契约」；兼容策略拆「行为等价项 / 行为变更项」两段 |
| B-4 | P2 | FR-styles-011 的 Agent 执行日志分句无承接者 | Phase 4 增 `ChangeAgentRunLog` 桌面去留声明；取代清单落点表点名该分句处置 |
| B-5 | P2 | 归档态 `?tab=files` 深链未定义钳制 | 兼容策略「深链与 URL」补钳制规则（不在 `visibleTabs` → `router.replace` 回 `overview`）+ 测例 |
| B-6 | P2 | 原型↔design 三处双向差异 | Phase 4 接线对照改为「差异一律以批准稿为准」并逐项列示；R-02 的限高折叠标注为唯一「实现严于原型」项 |
| Q-1 | 追问 | 归档态「继续执行」是否隐藏 | 按批准稿：归档态 MUST NOT 渲染（Phase 4 补录为契约） |
| Q-2 | 追问 | `ChangeAgentRunLog` 桌面去留 | 维持桌面不挂载、仅移动端承载（Phase 4 声明） |
| Q-3 | 追问 | 归档态资产查询失败时归档留档是否保底渲染 | 是：MUST 保底渲染（Phase 2 契约） |
| Q-4 | 追问 | 概览右栏用量复用还是重写 | 复用（抽共享取数，禁止双实现；Phase 2 契约） |
| Q-5 | 追问 | 归档深链 `?tab=files` 缺省 | 钳制回 `overview`（兼容策略） |

**与展示轮的差异（2 处，均已在上表决策中记录，用户可否决）**：D-014 把展示轮第 4 段的「跨源按源+稳定键合并为一行」精确化为「源内去重 + task-done 折叠 + 步骤/任务不跨源合并」（原表述在真实数据形状下不可实现）；D-015 把展示轮第 5 段第 4 条的「thin 收窄为三 tab」改为「thin 不特判、与在途同四 tab」（依据：thin 的叙事面就是事件流）。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@vN（D-001~D-016 全部入决策追踪表）
- [x] 生命周期契约表：已写明不涉及 + 紧邻否定短语
- [x] UI 原型分级核对：变更目录含 `prototype-change-detail-v2.html`（真码产物、带素材来源声明、已批准）；本仓 `local.yaml` 未登记 `ui_prototype` 段，按 `PROTOTYPE.md` 既有管线执行（管线即登记形态）
- [x] 文件清单路径存在性：新建路径均带 `NEW:` 前缀；修改路径均为仓根相对已存在文件
- [x] 不确定的问题：无「⚠️ 自审存疑」项；但 D-014/D-015 两处与展示轮的表述差异**须在用户验收时复核**（已在上方显式列出）
