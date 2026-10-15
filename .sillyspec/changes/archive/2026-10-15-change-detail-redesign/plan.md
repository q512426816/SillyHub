---
author: qinyi
created_at: 2026-10-16 00:18:00
plan_level: full
execution_mode: main
change: 2026-10-15-change-detail-redesign
---

# 实现计划（Plan）— 2026-10-15-change-detail-redesign

## 复杂度分类（Step 1 落盘）

```
plan_level: full
reason: 单模块（frontend）但工作面大——页面编排重写 + 7 个新组件 + 合并纯函数 + 861 行资产卡重构 + 新测试文件成套 + 页面级断言面改造 + 移动端契约核验；且 W1 四任务（tab 容器 / 合并纯函数+统一时间线 / 产出面板 / 文件与对账面板）文件正交、互不依赖，构成可真并行任务簇
estimated_files: 23
cross_module: false
has_schema_change: false
has_state_machine_change: false
needs_parallel_execution: true
needs_human_review: false
```

> `needs_human_review: false` 依据：设计方向已由用户在第 4 轮（原型确认轮）亲手确认为「定稿」，且独立设计审查（Design Grill，specVerdict=pass）已通过；本阶段只需 plan 层审查（下一步「审查计划」独立进行）。
> `execution_mode: main`（缺省直写）：W1 虽文件正交，但单任务规模均未达 >30min 量级、单会话上下文可吞吐本变更全部实现——按 M4 判据（真可并行 × 单任务大 × 需分片，三者齐备才 dispatch）不满足，且 R7/R8 对撞实证派发税 2-3.6×。

## Spike 前置验证

无。技术不确定性为零——前端目录结构、primer 组件契约、后端数据形状（`StepTimelineEntry`/`TimelineEvent`/`TimelineTask`）、原型管线均已核实；`GraphCanvas` 因 SSR 不参与本变更（原型用声明式示意，生产直接复用既有组件）。

## Wave 1（并行，无依赖）
- task-01
- task-02
- task-03
- task-04

## Wave 2（依赖前序 Wave）
- task-05
- task-06

## Wave 3（依赖前序 Wave）
- task-07

## Wave 4（依赖前序 Wave）
- task-08

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | tab 容器与契约（`change-tabs.tsx`：`DetailTab` 类型 + `visibleTabs` + UnderlineNav 渲染 + 单测） | W1 | P0 | — | FR-02, FR-04, D-002@v1, D-007@v1, D-013@v1, D-015@v1, D-016@v1 | 只出容器与判定函数，不碰 page.tsx；类型供各面板 `import type` 消费 |
| task-02 | 合并纯函数与统一时间线组件（`merge-change-timeline.ts` + `change-unified-timeline.tsx` + 两组单测） | W1 | P0 | — | FR-09, D-005@v1, D-014@v1, D-016@v1 | 含三层口径（源内键去重 / task-done 折叠 / 不跨源合并）与三输入类取舍；导出任务时刻断裂判定 helper 供 task-05 消费 |
| task-03 | 产出面板（图谱独立分区 + 六组资产 + 在途不渲染归档留档组 + 错误分支分区级说明 + **归档态归档留档保底渲染**） | W1 | P0 | — | FR-05, FR-06, D-001@v1, D-003@v1, D-016@v1 | 改造既有 `change-assets-card.tsx`（861 行）与 `change-assets-graph.tsx`；**保底渲染的实现与其断言同在卡**（避免 W1 卡断言 W4 行为） |
| task-04 | 文件与对账面板（文件树 tab 内内嵌 + 范围对账挂载 + 关联快速任务） | W1 | P1 | — | FR-11, FR-07, D-004@v1, D-012@v1 | 三个子块均为既有组件复用，新面板只做编排与懒挂载 |
| task-05 | 任务进度清单（勾选态 + 推断时刻 + 断裂标注 + 提交锚 + 勾选比） | W2 | P1 | task-02 | FR-10, D-014@v1, D-016@v1 | 依赖 task-02 的断裂判定 helper（`TimelineTask.time=null` 需区分「未勾选」与「观测断链」） |
| task-06 | 概览面板与右侧信息栏（待办卡 + 摘要 + 最近动态 + MetaPanel 五组 + 用量取数共享） | W2 | P0 | task-01, task-02 | FR-01, FR-08, D-001@v1, D-006@v1, D-016@v1 | 依赖 task-01 的 `DetailTab` 类型与 task-02 的合并输出；`change-usage-card.tsx` 抽共享取数（禁双实现） |
| task-07 | 页面编排与四面板接线（page.tsx 重写 + `?tab=` 驱动与钳制 + 卸载两时间线挂载 + 页模块导出保留 + 移动端契约核验 + 原型接线对照） | W3 | P0 | task-01~06 | FR-02, FR-03, FR-12, FR-14, FR-15, D-002@v1, D-008@v1, D-010@v1, D-011@v1, D-013@v1, D-016@v1 | 本变更的集成点：四面板在此装机；旧组件「仅卸载不删除」在此裁量 |
| task-08 | 归档态收窄与两态空态互斥清理（成果语义首屏 + 悬空入口改指 + 无在途空态残留 + 承接表核对） | W4 | P0 | task-07 | FR-01, FR-04, FR-07, FR-13, D-001@v1, D-007@v1, D-009@v1, D-015@v1, D-016@v1 | 跨面板的归档语义收口（**归档留档保底渲染的实现与断言在 task-03**，本卡只做收窄与互斥验证）；承接表（6 条被取代活需求）在此复核落笔 |

## 关键路径

task-02 → task-06 → task-07 → task-08（最长路径。W1 虽四任务并行，但 task-06 同时依赖 task-01 与 task-02，故交付节奏由「合并纯函数 → 概览面板 → 页面接线 → 归档收口」这条链决定）

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）

1. **后端接口面：0 端点（无接口变更）**——不新增/修改端点、DTO、响应体；不涉 `pnpm gen:types`（前端与 daemon 双端均无义务）。
2. **移动端 import 面逐符号守恒**（`frontend/src/components/mobile/mobile-change-detail.tsx:66-82`）：`ChangeLastSignal`/`lastSignalFromSteps`、`STAGE_LABELS`、`ChangeAgentRunLog`、`WORKFLOW_STAGES`、`ChangeStepTimeline`、`ChangeUsageCard`、`ScopeAuditCommandCard`、**`isTerminalChange`（源自 `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx:64`）**、`PENDING_REVIEW_LABEL`。其中 `isTerminalChange` MUST 原地保留在同一文件、语义不变（`status === "archived" || location === "archive"`），MUST NOT 只在新模块导出；`change-step-timeline.tsx` 与 `change-usage-card.tsx` 的文件与导出 MUST 保留，**MUST NOT 以「清理死代码」名义删除**。
3. **样式铁律**：走 `FRONTEND_PAGE_STYLE.md` §0.5 双主题 token（禁硬编码 hex；品牌用途用 `brand-*` 语义阶，`blue-*` 仅限真信息蓝）+ §13 primer 结构组件优先（`UnderlineNav`/`MetaPanel`/`StateLabel`/`StateIcon`/`StatGrid`/`Timeline`/`Counter`/`EmptyState`/`IssueRow`/`PageHead`），控件类继续既有 `@/components/ui` 原子件，不引入 antd 新组件。
4. **MUST NOT 出现 tab 内嵌套 tab / 二级折叠迷宫**：面板内最多一级分组。
5. **原型纪律**：批准稿（`prototype-change-detail-v2.html` + 其源码）为结构基准；**已预裁决的 3 处差异不再重复裁决**——①归档态隐藏「继续执行」、②归档态用量形态（标题「执行用量（合计）」且无按模型明细展开）以**批准稿**为准；③过程 tab 时间线限高 + 超量折叠以**本文档**为准（唯一「实现严于原型」项）；其余结构对不齐处 MUST 停机带截图裁决并留痕；改动原型源码后 MUST 重跑 `pnpm prototype:build` 并复核产物（**MUST NOT 手改 `prototype-dist/` 下 HTML**）。
6. **降级必须显式**：MUST NOT 把失败伪装成「无数据」；图谱失败/不可用/空三态各有文案，资产卡失败改卡头 + 分区级说明，归档态归档留档 MUST 保底渲染。
7. **流程规则**：规则 0（禁止跑全量测试，只跑本变更相关）；规则 9（禁止为过测试弱化语义断言）；规则 18（注释与实现 MUST 一致——被改动的既有注释同步修正，不留漂移）。
8. **文案语言**：一律中文（专业术语除外）；空值统一 `—`；时间格式沿用各组件既有口径。

## 全局验收标准

1. 本变更相关测试全绿（枚举以 tasks.md 的 target_files 为准）：**新增 8 个测试文件**（`change-tabs.test.tsx` / `merge-change-timeline.test.ts` / `change-unified-timeline.test.tsx` / `change-task-checklist.test.tsx` / `change-overview-panel.test.tsx` / `change-overview-side.test.tsx` / `change-files-panel.test.tsx` / `change-assets-fallback.test.tsx`）+ **页面级 4 文件**（新增 `page-tabs.test.tsx`；改造 `page-restore-assets.test.tsx` / `page-last-signal.test.tsx` / `page-team-toggle.test.tsx`）+ **改造既有套件**（`change-assets-card.test.tsx` 33 例、`change-assets-graph.test.tsx` 8 例、`change-usage-card.test.tsx`）。
2. `pnpm exec tsc --noEmit` 0 错；`pnpm lint`（改动文件）0 错。
3. 移动端测试（`frontend/src/components/mobile/__tests__/mobile-change-detail.test.tsx`）全绿 —— 桌面页重构未破坏其 9 个 import 符号。
4. 原型重编译对账门：`pnpm prototype:build` 后 `git diff` 对 `frontend/prototype-dist/` 为空。
5. 集成冒烟（页面级）：`?tab=assets` 深链停在产出 tab、归档态无「文件与对账」tab 且 `?tab=files` 被钳回概览、在途态无「归档留档」组、过程 tab 只存在一条时间线。
6. 既有行为不变（brownfield）：10s 轮询与终态停轮、删除入口与权限启发式、审批四分支（含 `null`）与通知降级文案、范围对账三态与降级指路、四个弹窗机制 —— 逐项在 verify 阶段核对。

> 验收结论不落在 plan.md —— 逐项核验结果由 verify 阶段写入 verify-result.md；task 级验收见各 TaskCard frontmatter 的 `acceptance` 字段。

## Review Focus 盲区清单（隐含面）

| # | 输入/条件 | 合理人预期行为 | 承接落点 |
|---|---|---|---|
| 1 | 变更处于归档态且资产主查询失败（后端 5xx / daemon 不可用） | 产出 tab 仍能看到「归档留档」（patch 摘要 + 单文件 diff 入口），不是空白 | **task-03（实现 + `change-assets-fallback.test.tsx` 断言，acceptance 第 5 条）**、task-08（收窄后复验） |
| 2 | 事件流中同一秒同 kind 同 label 的两条真实不同事件 | 不产生「丢行」错觉——去重取舍须在口径说明可见 | task-02：merge 单测（`merge-change-timeline.test.ts`）+ 组件口径文案断言（`change-unified-timeline.test.tsx`，见该卡 acceptance 第 6 条） |
| 3 | `change.steps` 中某步 `completed_at` 为解析失败的原串（非 ISO） | 该行落到时间线末尾而非插进时间序中间（不污染全局排序） | task-02（merge 单测） |
| 4 | thin 出身变更（无五阶段、steps 恒空）打开详情页 | 阶段条位置换成轻量流程条；四个 tab 齐全且在途态「过程」tab 有事件叙事可看 | **task-07（page 级 thin 断言，见其 acceptance 第 6 条）**、task-01（`visibleTabs` 单测，与 thin 无关的证明） |
| 5 | 用户在「过程」tab 点上方阶段条的某阶段节点 | 切到过程 tab 并筛选该阶段（不是留在原 tab 无反应） | task-07（阶段条联动接线 + 断言） |

## 覆盖矩阵（如存在 decisions.md）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-03, task-06, task-08 | 在途无归档留档组 / 归档首屏成果语义 / 两态空态互斥断言 |
| D-002@v1 | task-01, task-07 | `visibleTabs` 单测 + 页面级 tab 集断言 |
| D-003@v1 | task-03 | 图谱独立分区渲染 + 三态空态文案断言 |
| D-004@v1 | task-04 | 对账卡挂载于文件与对账面板（不在侧栏）断言 |
| D-005@v1 | task-02 | 统一时间线渲染 + 两旧卡不再挂载断言 |
| D-006@v1 | task-06 | 右信息栏五组渲染断言 |
| D-007@v1 | task-01, task-08 | 归档收窄单测 + 归档态无在途空态断言 |
| D-008@v1 | task-07 | 原型接线对照留痕 + 重编译对账门 |
| D-009@v1 | task-08（FR-13） | 六条被取代活需求的承接表落笔（承接行 + superseded 指向） |
| D-010@v1 | task-07 | 四面板 + 两态在同一交付内可用（无中间态） |
| D-011@v1 | task-07 | 移动端 9 符号可解析 + 页模块导出断言 + 移动端测试绿 |
| D-012@v1 | task-04 | 文件树在 tab 内内嵌渲染断言 |
| D-013@v1 | task-01, task-07 | `?tab=` 缺省/非法/收窄钳制单测与页面级断言；**含前进/后退（URL 为唯一源，回退按钮不改面板）与并发写取舍**（多标签同时 `router.replace`：后到者胜，不引入跨标签同步——显式取舍，非缺陷） |
| D-014@v1 | task-02, task-05 | 合并三层口径单测 + 任务清单渲染断言 |
| D-015@v1 | task-01, task-07 | thin 不特判（`visibleTabs` 与 thin 无关）+ **thin 页面级断言归 task-07 的 `page-tabs.test.tsx`** |
| D-016@v1 | task-01~task-08 | 逐条：逐符号 import 表 / 三输入类取舍 / 错误分支与归档保底 / AgentRunLog 去留 / 深链钳制 / 原型差异裁决 |
| D-008-rejected-B@v1 | —（落选存档，不实现） | 无 |
| D-008-rejected-C@v1 | —（落选存档，不实现） | 无 |
