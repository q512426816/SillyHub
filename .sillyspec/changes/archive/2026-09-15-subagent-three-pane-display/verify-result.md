# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。

## 结论 [层：人工判断]

结论枚举：PASS WITH NOTES —— 本变更四任务六测试套件 213/213 全绿（tsc 0 错、eslint 0/0），FR-01~05 逐条有代码与测试证据；NOTES 为两条与本变更无关的环境事实（page.test.tsx 1 例 HEAD 既有测试债、git 里他者会话的 docs 文件删除），详技术债务节。

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]

无——四任务 task review.json 均双 pass，无 cannot_verify。

## 集成验证回执 [层：自述声明——CLI 一致性校验]

无——变更显式声明 risk_level: unit-sufficient（纯前端组件级，jsdom 单测覆盖；无路由/部署面改动）。

## 任务完成度 [层：人工判断]

- task-01 ✅ 已完成（commit 7c51bbccc：subagent-panel-context.ts 新建 + SubagentBlockView 双模式，68 passed 含新增 6）
- task-02 ✅ 已完成（commit dbe82f5cb：isConversationSegment 过滤放宽 + dispatch_worker 排除，8 passed 含新增 5）
- task-03 ✅ 已完成（commit 35a175f27：SubagentDetailPanel + SessionPanel 3 可选 props + catalog activeId，指定三套件 77 passed）
- task-04 ✅ 已完成（commit 242ad1e63：portal subagentView 槽位互斥 + 会话切换清零 + props 装配，60 passed 含新增 7）
- 完成率 4/4 = 100%

## 设计一致性 [层：人工判断]

与 design.md 一致，两处已审查记录的最小实现偏差（均不违 FR/决策）：
1. Provider 挂载条件 = `!mobile && onOpenSubagent != null`（frontend/src/components/daemon/session-panel/session-panel-page.tsx:1593）——design §5.B 只说「page 模式挂」；实现补充了「悬浮宿主等 page 消费方不传 props 也不能挂空值 Provider（否则紧凑卡片点击 noop）」，比设计更严格，QA acceptance 已核。
2. 根布局采用「原 section 作左单元格外包 flex 行」（task-03）而非把 section 自身改 flex-row——保住 flex-col 高度链与 session-panel-variant 回归锚，效果与 §5.B 等价。
QA 另提示一处措辞张力：FR-04 过滤放宽对 dialog 对话视图同样生效（回退为内联展开卡，非紧凑卡），design §3 非目标「dialog 零变化」指 props/行为契约层面（session-panel-dialog 58 用例零回归证实），建议 archive 时 §3 补一句说明。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ⚠️ `frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx:555` args: { pattern: "TODO", path: "src/lib", glob: "*.ts" },
- ⚠️ `frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx:560` primary: "TODO",
- ℹ️ glob 项未展开（agent 手动展开扫描）：frontend/src/components/daemon/__tests__/turn-timeline*.test.tsx
- ℹ️ 3 个清单文件主仓不存在、已从 worktree 读取（apply 前新文件形态）

#### 探针 2：设计关键词覆盖 [agent 已执行]
- 逐关键词 grep（worktree 源码）：openSubagent/closeSubagent/activeId（subagent-panel-context.ts + turn-segment-views.tsx + session-panel-page.tsx + sessions-portal.tsx 全命中）、subagent-panel-column（session-panel-page.tsx 右列 testid + 测试断言）、data-segment-id（turn-segment-views.tsx 紧凑卡片根）、ring-brand-300（卡片/目录高亮）、subagentHeaderOf（turn-segment-views.tsx 导出 + detail-panel 消费）、sessions-file-preview-column（既有预览列，互斥断言用）、PanelResizer/usePanelWidth（面板右把手）、SESSIONS_FILE_PREVIEW_WIDTH_LS_KEY（同键宽度记忆）、isConversationSegment（turn-timeline.tsx 过滤谓词）、dispatch_worker（排除判定）、subagent_stub（过滤+紧凑分支两处）——**全部命中，无未实现关键词**。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（frontend/src/components/daemon、frontend/src/components/daemon/__tests__）找到 10 个测试文件（frontend/src/components/daemon/__tests__/activity-catalog.test.tsx、frontend/src/components/daemon/__tests__/agent-log-card.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card.test.tsx、frontend/src/components/daemon/__tests__/attachment-chips.test.tsx …）
- ✅ task-02: 模块目录（frontend/src/components/daemon、frontend/src/components/daemon/__tests__）找到 10 个测试文件（frontend/src/components/daemon/__tests__/activity-catalog.test.tsx、frontend/src/components/daemon/__tests__/agent-log-card.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card.test.tsx、frontend/src/components/daemon/__tests__/attachment-chips.test.tsx …）
- ✅ task-03: 模块目录（frontend/src/components/daemon、frontend/src/components/daemon/__tests__、frontend/src/components/daemon/session-panel、frontend/src/components/sessions）找到 18 个测试文件（frontend/src/components/daemon/__tests__/activity-catalog.test.tsx、frontend/src/components/daemon/__tests__/agent-log-card.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card.test.tsx、frontend/src/components/daemon/__tests__/attachment-chips.test.tsx …）
- ✅ task-04: 模块目录（frontend/src/components/sessions、frontend/src/components/sessions/__tests__）找到 8 个测试文件（frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx、frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx、frontend/src/components/sessions/__tests__/portal-file-panels.test.tsx、frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx、frontend/src/components/sessions/__tests__/session-config-bar.test.tsx …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles 结构归属承接面（每条 acceptance 由哪些测试承接）；两者并排冲突以 7 为准。判定枚举（四选一）：covered / partial / uncovered / non-testable（文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->
<!-- 预填说明（ql-20260915-004）：判定列为 CLI 机械预填，agent 逐格复核改写——规则：无归属→uncovered（文档/部署/doc/deploy/manual/config 类词→non-testable）；有归属且命中≥1→covered；有归属零命中→partial。证据列给首命中 file:line 锚点或人工核验提示。预填≠结论：与事实不符的格子必须改写（枚举须保持 covered/partial/uncovered/non-testable 纯值，备注写在证据列）。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 有 context：SubagentBlockView 仅渲染头部行（状态点/🤖/名称/类型标签/徽标/时长），无 children 内联、无折叠 body；点击上抛 openSubagent(segment.id)，activeId 命中再点 closeSubagent()（toggle） | `frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx` | SubagentBlockView、名称（`frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx:33`（SubagentBlockView）、`frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx:11`（名称） |
| 无 context（默认 null）：SubagentBlockView 与现状完全一致——运行中默认展开、完成折叠、running→终态自动收敛、children 递归渲染、[TASK_*] progressLine（既有用例零回归） | `frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx` | 默认、null、SubagentBlockView（`frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx:9`（默认）、`frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx:15`（null）、`frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx:33`（SubagentBlockView） |
| 根容器带 data-segment-id={segment.id} 锚点 | `frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx` | data、segment、锚点（`frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx:55`（data）、`frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx:17`（segment）、`frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx:15`（锚点） |
| 新增 describe ≥5 用例 + 既有 turn-segment-views 用例全绿 | `frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx` | describe、用例、既有、turn（`frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx:25`（describe）、`frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx:20`（用例）、`frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx:21`（既有） |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 对话视图出现子代理卡片（tool 带 children / subagent_stub 两形态），thinking 与普通 tool 段仍被过滤 | `frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx` | 两形态（`frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx:14`（两形态） |
| 进度视图（all）行为零变化 | `frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx` | all（`frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx:152`（all） |
| 新增 describe ≥4 用例 + 本文件既有用例全绿 | `frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx` | describe（`frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx:16`（describe） |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| SubagentDetailPanel 渲染子代理完整 children 时间线（与主会话 SegmentView 同构），头部含 ✕/名称/类型/徽标/时长，无任何输入框 | `frontend/src/components/daemon/__tests__/subagent-detail-panel.test.tsx`<br>`frontend/src/components/daemon/__tests__/subagent-async-derive.test.tsx` | SubagentDetailPanel、children、与主会话（`frontend/src/components/daemon/__tests__/subagent-detail-panel.test.tsx`、`frontend/src/components/daemon/__tests__/subagent-async-derive.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/subagent-detail-panel.test.tsx:3`（SubagentDetailPanel）、`frontend/src/components/daemon/__tests__/subagent-detail-panel.test.tsx:8`（children）、`frontend/src/components/daemon/__tests__/subagent-detail-panel.test.tsx:8`（与主会话） |
| session-panel-page：openSubagentId 命中段时根为 flex 行 + 右把手 + 右列（data-testid=subagent-panel-column，宽度可拖、LS 记忆与文件预览同键）；段失效自动 onSubagentPanelClose | `frontend/src/components/daemon/__tests__/subagent-detail-panel.test.tsx`<br>`frontend/src/components/daemon/__tests__/subagent-async-derive.test.tsx` | session、panel、page（`frontend/src/components/daemon/__tests__/subagent-detail-panel.test.tsx`、`frontend/src/components/daemon/__tests__/subagent-async-derive.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/subagent-detail-panel.test.tsx:21`（session）、`frontend/src/components/daemon/__tests__/subagent-detail-panel.test.tsx:6`（panel）、`frontend/src/components/daemon/__tests__/subagent-detail-panel.test.tsx:14`（page） |
| handleJumpToSubagent：page 模式（onOpenSubagent 存在）直接开右栏；dialog 模式保留旧定位逻辑 | `frontend/src/components/daemon/__tests__/subagent-detail-panel.test.tsx`<br>`frontend/src/components/daemon/__tests__/subagent-async-derive.test.tsx` | page、存在（`frontend/src/components/daemon/__tests__/subagent-detail-panel.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/subagent-detail-panel.test.tsx:14`（page）、`frontend/src/components/daemon/__tests__/subagent-detail-panel.test.tsx:9`（存在） |
| SessionPanel 不传新 props（dialog/悬浮宿主）行为与现状完全一致（session-panel-dialog.test.tsx 零回归） | `frontend/src/components/daemon/__tests__/subagent-detail-panel.test.tsx`<br>`frontend/src/components/daemon/__tests__/subagent-async-derive.test.tsx` | props（`frontend/src/components/daemon/__tests__/subagent-detail-panel.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/subagent-detail-panel.test.tsx:47`（props） |
| 新增两测试文件用例全绿 + subagent-async-derive/session-panel-dialog 既有用例全绿 | `frontend/src/components/daemon/__tests__/subagent-detail-panel.test.tsx`<br>`frontend/src/components/daemon/__tests__/subagent-async-derive.test.tsx` | subagent、async、derive、session（`frontend/src/components/daemon/__tests__/subagent-detail-panel.test.tsx`、`frontend/src/components/daemon/__tests__/subagent-async-derive.test.tsx`） | covered | `frontend/src/components/daemon/__tests__/subagent-detail-panel.test.tsx:2`（subagent）、`frontend/src/components/daemon/__tests__/subagent-async-derive.test.tsx:3`（async）、`frontend/src/components/daemon/__tests__/subagent-async-derive.test.tsx:6`（derive） |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 点子代理 → 文件预览关闭、SessionPanel openSubagentId 收到 segmentId；点文件 → 子代理面板关闭、预览列挂载；严格最后触发覆盖（FR-01） | `frontend/src/components/sessions/__tests__/sessions-portal.test.tsx` | SessionPanel、收到（`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx`） | covered | `frontend/src/components/sessions/__tests__/sessions-portal.test.tsx:25`（SessionPanel）、`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx:1774`（收到） |
| 会话切换后 openSubagentId 清零，不残留旧会话子代理面板（FR-01） | `frontend/src/components/sessions/__tests__/sessions-portal.test.tsx` | — | covered | 人工核验：`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx:2675`「会话切换（重选另一会话）→ 子代理面板卸载」+ `:2692`「切群再切回不复活」（机械零命中系关键词口径，用例实际存在且过） |
| 右栏视觉一次只出现一种（文件预览列在 portal 渲染 / 子代理列在 SessionPanel 内渲染，互斥由状态清零保证——两列不同时存在） | `frontend/src/components/sessions/__tests__/sessions-portal.test.tsx` | portal、渲染（`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx`） | covered | `frontend/src/components/sessions/__tests__/sessions-portal.test.tsx:2`（portal）、`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx:10`（渲染） |
| 新增 describe ≥5 用例 + sessions-portal 既有用例全绿 | `frontend/src/components/sessions/__tests__/sessions-portal.test.tsx` | describe、用例、sessions、portal（`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx`） | covered | `frontend/src/components/sessions/__tests__/sessions-portal.test.tsx:58`（describe）、`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx:10`（用例）、`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx:2`（sessions） |

#### 探针 4：决策追踪覆盖 [agent 已执行]
- D-001@v1（三分栏交互模型）→ requirements FR-01/02/03/05 引用 → plan 决策追踪段 + task-01/03/04 frontmatter decision_ids → 证据回指：frontend/src/components/sessions/sessions-portal.tsx:226-229/699-701（互斥）、turn-segment-views.tsx 紧凑分支、subagent-detail-panel.tsx 全文件——**闭环**。
- D-002@v1（默认视图行为补全）→ FR-02/03/04/05 → task-01/02/03 → 证据回指：turn-timeline.tsx isConversationSegment、SubagentBlockView toggle、handleJumpToSubagent 双路径（frontend/src/components/daemon/session-panel/session-panel-page.tsx:2566）——**闭环**。
- D-003@v1（方案 A 右栏单槽位）→ FR-01/03/05 → task-03/04 → 证据回指：面板归属 session-panel-page 根 flex 行 + portal 双向清零（非同列二选一渲染，与 Grill X-001 修正后口径一致）——**闭环**。
- requirements.md 决策追踪行显式声明「无剩余风险」——与实际相符，无未引用决策版本。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 599 backend endpoints (live [scan-root 603 + worktree 603] + artifact 0), 0 frontend calls [scope: change-diff (13 files @ worktree)] | 204 backend endpoints unused by frontend
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ⚠️ 204 个后端端点前端未调用（warning 不阻断）：GET /admin/roles、POST /admin/roles、GET /admin/organizations、POST /admin/organizations、GET /admin/users …

#### 探针 6：代码删除对账
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/verify-evidence-account-diff-misses-committed-changes.md`（git 状态 D）
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

## 测试结果 [层：确定性检查——CLI 实测对账]

- worktree 内（QA acceptance 复核同口径）：`pnpm -C frontend exec vitest run` 六套件（turn-segment-views / turn-timeline-conversation-file-card / subagent-detail-panel / subagent-async-derive / session-panel-dialog / sessions-portal）**213/213 passed**；`tsc --noEmit` 0 错；改动文件 eslint 0 error 0 warning。
- 分 task：task-01 68p（新增 6）/ task-02 8p（新增 5）/ task-03 指定三套件 77p（detail-panel 新增 9 + async-derive 新增 2 + dialog 58 零回归）/ task-04 60p（新增 7）。
- known_failures：`src/components/daemon/__tests__/page.test.tsx` 1 例「历史轮 whoLine 按 run 快照渲染」失败——**HEAD 基线（daf0e2a0c detached）复跑同错**，根因为 llm-providers mock 缺 `detectUsageProvider` 导出的既有测试债；本变更未触碰相关两文件（QA 在基线独立复现确认），非本变更引入、不在修复范围。

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
<!-- 机械半边预填（CLI，P0-1）：D→FR→task 链自 decisions.md × tasks/*.md frontmatter 结构化字段构建；
     Evidence / 状态两列是人工判断——逐格复核，未闭环行必须在报告标注风险 -->
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01、FR-02、FR-03、FR-05 | task-01、task-03、task-04 | 互斥双写入点 frontend/src/components/sessions/sessions-portal.tsx:226-229/699-701 + 会话切换清零 :235-238（QA 复核锚点）；紧凑卡片 turn-segment-views.tsx 紧凑分支；面板无输入框 subagent-detail-panel.tsx | 已闭环（confirmed） |
| D-002@v1 | FR-02、FR-03、FR-04、FR-05 | task-01、task-02、task-03 | turn-timeline.tsx isConversationSegment（对话视图卡片化）；toggle 语义（turn-segment-views 测试用例④）；目录跳转双路径 frontend/src/components/daemon/session-panel/session-panel-page.tsx:2566 | 已闭环（confirmed） |
| D-003@v1 | FR-01、FR-03、FR-05 | task-03、task-04 | 面板渲染归属 session-panel-page（根外包 flex 行 + PanelResizer + 同 LS 键 usePanelWidth）；portal 只管槽位清零不渲染面板本体——与 Grill X-001/X-002 修正口径一致 | 已闭环（confirmed） |

## 技术债务 [层：人工判断]

- 探针 1 的 2 处「TODO」命中（frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx:555/560）经人工核验为 **Grep 工具测试固件字符串**（`args: { pattern: "TODO" }`），非未实现标记——零真实 TODO/FIXME 新增。
- 既有测试债 1 项（非本变更）：page.test.tsx「历史轮 whoLine」llm-providers mock 缺 detectUsageProvider 导出（见测试结果节 known_failures）。
- 顺手修复项：task-02 清理 turn-timeline.tsx 4 处、task-03 清理 6 处 HEAD 既有 eslint warning（均为存量，行为零变化）。
- 探针 6 未声明删除 `docs/sillyspec/verify-evidence-account-diff-misses-committed-changes.md`：git 事实为 D，但该文件属**他者并行会话**（2026-09-14-session-export 域，其 finished/ 归档副本已在；本会话初始 git status 即为 D）——非本变更产出，不判 FAIL，留其所属变更处理。

## 变更风险等级 [层：人工判断]

显式声明 = unit-sufficient（design.md frontmatter）。理由成立：纯前端组件级改动（13 文件全在 frontend/src/components），无 API/schema/状态机/部署面变更；jsdom 组件单测六套件覆盖全部 FR；唯一集成面（portal↔SessionPanel↔context 三层联动）已由 sessions-portal 集成用例（真实装配链固件）覆盖。无被否定语境抑制的关键词。

## Runtime Evidence [层：人工判断]

不涉及——unit-sufficient 级，无运行时组件启动/端点/部署验证义务；组件树行为证据见六套件断言（含 data-testid=subagent-panel-column 挂载/卸载、sessions-file-preview-column 互斥切换）。

## 代码审查 [层：人工判断]

- 逐 task review×4（execute Task Review Gate）+ QA acceptance stage review 均 specVerdict/qualityVerdict 双 pass；QA 抽查 task-01/04 核心 diff 与 reviewerNotes 相符。
- 问题列表：无 P0/P1。P3 级备忘 3 条——①嵌套子代理无返回栈（design §8 已声明取舍）；②两棵树同 LS 键宽度记忆在互不重叠生命周期下无实际分歧（design §5.B）；③archive 时 design §3 宜补「FR-04 放宽对 dialog 对话视图同样生效（回退内联）」一句（QA 建议）。
- 总体评价：实现与设计偏差极小且均有记录；测试断言真实（DOM 锚/回调 spy/真实装配链固件，非空断言），覆盖正例+边界（段失效自动关/切群回切/预会话不装配）。
