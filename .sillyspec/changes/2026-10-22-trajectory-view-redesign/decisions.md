---
author: qinyi
created_at: 2026-10-22 11:36:51
generated_by: sillyspec-fourpiece-init
change: 2026-10-22-trajectory-view-redesign
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: 轨迹面板以 dsh（deepseek-harness）ui-trajectory 为视觉与交互基准
- type: architecture
- priority: P0
- status: confirmed
- source: user
- question: 轨迹面板整体样式重做的参考实现是什么？
- answer: 用户提供的截图来自 dsh 的轨迹视图，并明确要求「看 dsh 源码」；参考实现为 deepseek-harness/packages/client/ui-trajectory（CSS Modules + DSH token），本项目需用 Tailwind + themes.ts token 等价实现。
- normalized_requirement: 布局、工具栏、账本、详情面板的结构与交互对齐 dsh 轨迹视图；样式映射到本项目主题 token，不硬编码颜色。
- impacts: [FR-01, FR-02, FR-03, task-01]
- evidence: C:/Users/qinyi/IdeaProjects/deepseek-harness/packages/client/ui-trajectory/src/client/TrajectoryView.tsx:132-583（外部参考）
- 故障面: 直接照搬 CSS Modules 类名/API 会引错依赖；必须翻译为 Tailwind + 本地数据模型。
- 退役判据: 本项目轨迹视图形成独立设计体系且不再需要对标 dsh 时。

## D-002@v1: 顶部固定布局——工具栏与时间线不随账本滚动
- type: architecture
- priority: P0
- status: confirmed
- source: user
- question: 顶部区域应如何布局？
- answer: 用户明确「顶部是固定位置的」。dsh 根容器为纵向 flex + overflow:hidden，工具栏 sticky 32px、时间线固定 50px，唯一滚动容器是账本 pane。
- normalized_requirement: 轨迹视图独占面板高度（脱离会话外层滚动流），内部为纵向 flex：工具栏与时间线固定，仅账本列表滚动。
- impacts: [FR-01, task-01]
- evidence: C:/Users/qinyi/IdeaProjects/deepseek-harness/packages/client/ui-trajectory/src/client/views.module.css:2-28；TrajectoryToolbar.module.css:1-10（外部参考）
- 故障面: 若仍挂在 turn-timeline-scroll 内，整页滚动会把顶部带走（当前缺陷根因）。

## D-003@v1: 工具栏四项语义与行为
- type: definition
- priority: P0
- status: confirmed
- source: docs
- question: 「时长 / 轮次 / 调用 + 搜索」分别做什么？
- answer: 时长＝时间线比例开关（实际时长 vs 等宽操作，偏好持久化）；轮次＝展开/收起所有轮次（折叠为“… + 摘要”行）；调用＝展开/收起所有工具调用（合并为“N 个工具调用”摘要行）；搜索＝按文本 AND 过滤账本行并绕过折叠，时间线非命中条降透明。
- normalized_requirement: 四项控件按上述语义实现；时长开关只影响时间线投影，不改变账本布局；轮次/调用折叠只影响账本，不影响时间线。
- impacts: [FR-02, FR-04, task-02]
- evidence: C:/Users/qinyi/IdeaProjects/deepseek-harness/packages/client/ui-trajectory/src/client/TrajectoryToolbar.tsx:38-128；TrajectoryView.tsx:139-145,352-380；Timeline.tsx:713-715（外部参考）

## D-004@v1: 账本形态——无表头两列紧凑表格
- type: definition
- priority: P0
- status: confirmed
- source: docs
- question: 账本列表的形态与字段是什么？
- answer: dsh 为无表头两列（事件列 122px + 内容列自适应），行高 30px、下边框；内容列＝类型标签（19px，图标+文字）+ 摘要，有结果时右侧“→ 结果摘要”；耗时/token/状态文字不进行内而进详情；按 turn 分组用竖线与 Turn 标签表达，子工具通过缩进 +26px，无嵌套 DOM。
- normalized_requirement: 账本行按上述结构渲染；行内不展示耗时/token/状态文字；折叠摘要行高 20px。
- impacts: [FR-03, task-03]
- evidence: C:/Users/qinyi/IdeaProjects/deepseek-harness/packages/client/ui-trajectory/src/client/TrajectoryTable.module.css:99-159,216-464,721-762（外部参考）
- 退役判据: 账本信息密度与可读性在其他形态下经实测更优时。

## D-005@v1: 详情面板——多标签 + 可调宽
- type: definition
- priority: P1
- status: confirmed
- source: docs
- question: 右侧详情面板的结构？
- answer: 工具行五标签（概述/参数/结果/Schema/计时），消息类/系统类各有自己的标签集；面板宽默认 clamp(320px,38%,440px)、可拖拽 320–720、双击复位；≤760px 改为抽屉；无选中时不渲染。
- normalized_requirement: 详情面板按行类型渲染对应标签集；宽度可拖拽并持久化；窄屏抽屉化；关闭按钮清空选中。
- impacts: [FR-05, task-04]
- evidence: C:/Users/qinyi/IdeaProjects/deepseek-harness/packages/client/ui-trajectory/src/client/TrajectoryTable.module.css:853-864,1972-1984；TrajectoryTable.tsx:213-221,2942-3016（外部参考）

## D-006@v1: 仅呈现本项目数据可派生的行类型，不伪造
- type: scope
- priority: P0
- status: confirmed
- source: code
- question: dsh 中的 request/系统提示词变更/用量/上下文等行是否有数据支撑？
- answer: 本项目数据源为 SessionTurnView[]（含 segments 与 run timing），可派生 user/assistant/thinking/tool/tool_result/system/compaction/error 行；dsh 的 request 边界、工具定义 schema、系统提示词快照、逐请求用量在本平台未随会话轮视图下发。我的判断：只呈现可派生类型，缺失数据不伪造、不显示假行。
- normalized_requirement: 账本行类型限定为现有数据可派生集合；缺失数据的标签/行以显式空态处理，禁止占位假数据。
- impacts: [FR-06, task-05]
- evidence: frontend/src/components/daemon/trajectory/from-turn-views.ts:63-85,106-222；frontend/src/components/daemon/turn-timeline.tsx（SessionTurnView 字段）

## D-007@v1: 隐藏 Schema 标签
- type: scope
- priority: P1
- status: confirmed
- source: user
- question: 工具定义数据在本平台不可得，Schema 标签如何处置？
- answer: 用户裁决隐藏 Schema 标签，不显示空态入口。
- normalized_requirement: 工具行详情标签集为「概述 / 参数 / 结果 / 计时」四项，不出现 Schema 标签及其占位。
- impacts: [FR-05, task-04]
- evidence: 用户 2026-10-22 回答（本会话）
- 复潮条件: 后续变更补齐工具定义下发后可再引入 Schema 标签。

## D-008@v1: 详情标签覆盖范围——工具行完整、其它行简化
- type: scope
- priority: P1
- status: confirmed
- source: user
- question: 消息/系统/压缩等行是否照搬 dsh 各自的多标签集？
- answer: 用户裁决工具行给完整标签（概述/参数/结果/计时），消息、系统、压缩等行只给简化详情（概述 + 原始内容），不复制 dsh 的多套标签。
- normalized_requirement: 详情面板按行类型分两档：工具行四标签；其它行概述+原始内容两档，无数据处显式空态。
- impacts: [FR-05, task-04]
- evidence: 用户 2026-10-22 回答（本会话）

## D-009@v1: 采用组件族拆分方案（B）
- type: architecture
- priority: P0
- status: confirmed
- source: user
- question: 轨迹视图重做采用哪种实现方案？
- answer: 用户选择方案 B——TrajectoryView 只做装配，新增 trajectory-toolbar / trajectory-ledger / trajectory-detail-panel 三个组件，复用现有 trajectory-timeline 与数据层；数据层（build-trajectory / from-turn-views）不动。
- normalized_requirement: 展示层按组件族拆分；TrajectoryView 保持装配职责，不继续堆积渲染逻辑。
- impacts: [FR-01, FR-02, FR-03, FR-05, task-01, task-02, task-03, task-04]
- evidence: 用户 2026-10-22 方案选择（本会话）

## D-010@v1: 否决「原地重构 trajectory-view.tsx」（方案 A）
- type: architecture
- priority: P2
- status: rejected
- source: user
- question: 轨迹视图重做采用哪种实现方案？
- answer: 用户未选方案 A。
- normalized_requirement: 不采用单文件原地重构。
- impacts: [task-01]
- evidence: 用户 2026-10-22 方案选择（本会话）
- 否决理由: 单文件将膨胀到 1000+ 行，职责混杂、测试耦合，与项目大文件拆分既有方向相反。
- 复潮条件: 若组件族拆分导致回归面显著超出预期（改动文件数或测试返工翻倍），可退回局部原地重构。

## D-011@v1: 否决「直接移植 dsh 组件」（方案 C）
- type: architecture
- priority: P2
- status: rejected
- source: code
- question: 轨迹视图重做采用哪种实现方案？
- answer: 不可行——dsh 使用 CSS Modules + 自有设计 token 与数据模型，本项目为 Tailwind + themes.ts + SessionTurnView，无法直接复制。
- normalized_requirement: 只做视觉与交互等价映射，不引入 dsh 运行时依赖。
- impacts: [task-01]
- evidence: C:/Users/qinyi/IdeaProjects/deepseek-harness/packages/client/ui-trajectory/src/client（外部参考）
- 否决理由: 依赖与数据模型不兼容，移植成本高于重写且会把两套 token 体系混在一起。
- 复潮条件: 仅在 dsh 改为输出可复用、无框架绑定组件库时重新评估。

## D-012@v1: 设计方案与真码原型定稿
- type: architecture
- priority: P0
- status: confirmed
- source: user
- question: 分段设计（布局/工具栏/时间线/账本/详情）与原型是否按此定稿？
- answer: 用户确认按该设计实施；原型经 prototype-as-code 管线编译并登记为变更目录 prototype-trajectory-redesign.html。
- normalized_requirement: 实现以该原型为视觉与结构基准；execute 阶段直接对照原型搬组件。
- impacts: [FR-01~FR-06, task-01~task-05]
- evidence: frontend/src/components/prototype/trajectory-redesign-view.tsx；.sillyspec/changes/2026-10-22-trajectory-view-redesign/prototype-trajectory-redesign.html

## D-013@v1: 搜索时折叠整体失效，时间线不做降透明
- type: boundary
- priority: P1
- status: confirmed
- source: design-grill
- question: 搜索与折叠、时间线的组合语义？
- answer: 有搜索词时所有折叠失效、直接显示全部命中行（含其父轮次与调用组）；零命中显示「没有匹配的记录」空态；时间线条块不随搜索变化（不实现 dsh 的非命中降透明，减少无数据支撑的视觉分支）。我的判断：降透明属纯装饰，本平台先不做。
- normalized_requirement: buildLedgerView 在 query 非空时忽略折叠集合；账本空态文案固定；时间线不消费搜索词。
- impacts: [FR-02, task-01]
- evidence: .sillyspec/.runtime/stage-reviews/brainstorm-review-2026-10-22-120200/review.json（P1-5b）

## D-014@v1: 折叠/搜索隐藏选中行时清空选中，键盘只遍历可见行
- type: boundary
- priority: P1
- status: confirmed
- source: design-grill
- question: selectedRowId 指向被折叠或搜索隐藏的行时怎么办？
- answer: 折叠状态或搜索词变化后，若当前选中行不再可见，立即清空选中并关闭详情；↑/↓ 只在可见行之间移动；scrollIntoView 只对可见行调用。我的判断：保留不可见行的选中会让用户「看不到却占着详情」。
- normalized_requirement: TrajectoryView 在 visible row 集合变化时校验 selectedRowId；键盘导航基于可见行数组。
- impacts: [FR-03, FR-05, task-01, task-06]
- evidence: frontend/src/components/daemon/trajectory/trajectory-view.tsx:180-197,212-234

## D-015@v1: 工具行参数/结果字段来源（允许 from-turn-views 小改）
- type: architecture
- priority: P1
- status: confirmed
- source: design-grill
- question: 工具行「参数 / 结果」的数据从哪来？
- answer: 产品路径工具段已有 `raw`（tool_use JSON 原文）与 `result`（配对的 tool_result 文本）、`primary`（主参数摘要）。映射为 inputText=raw、outputText=result ?? primary；from-turn-views.ts 允许本次小改（仅工具行字段映射与行 id 稳定性），build-trajectory.ts 仍零改动。
- normalized_requirement: 工具行详情「参数」显示 raw 美化 JSON、「结果」显示配对 result；无 result 时显示 primary 摘要并注明「未捕获结果」。
- impacts: [FR-05, task-01, task-04]
- evidence: frontend/src/components/daemon/session-log-assembler.ts:497-520；frontend/src/components/daemon/trajectory/from-turn-views.ts:156-189

## D-016@v1: 等宽模式为只读概览
- type: boundary
- priority: P1
- status: confirmed
- source: design-grill
- question: scaleMode=equal 时缩放/平移/刷子/轴刻度如何表现？
- answer: 等宽模式只做条块等宽排列的概览——禁用滚轮缩放、拖拽平移、总览刷子与双击重置，不拦截滚轮默认行为（页面正常滚动）；隐藏时间刻度与轮边界竖线；点击条块仍按等宽几何命中并选中对应行。实际时长模式保持现有全部交互。
- normalized_requirement: TrajectoryTimeline 内所有手势与刷子在 equal 下关闭；axis/guide 渲染条件加 mode 判断；selectAt 使用当前模式的 placed 几何。
- impacts: [FR-02, task-05]
- evidence: frontend/src/components/daemon/trajectory/trajectory-timeline.tsx:260-278,287-329,349-367,509-660

## D-017@v1: 时间线固定 50px 需裁剪说明区
- type: scope
- priority: P1
- status: confirmed
- source: design-grill
- question: 「时间线固定 50px」与仅新增 scaleMode 的改动面矛盾如何解决？
- answer: 保留 50px 承诺，但 trajectory-timeline.tsx 本次一并裁剪：移除/收起说明行（标题、视野、倍率、图例、覆盖率、模型口径、重置）与提示文案，只保留轴 + 三泳道；重置并入工具栏手势（或随说明区移除）。
- normalized_requirement: 时间线渲染高度固定约 50px；说明信息不占独立行。
- impacts: [FR-01, FR-02, task-05]
- evidence: frontend/src/components/daemon/trajectory/trajectory-timeline.tsx:521-590,592-660

## D-018@v1: D-007 覆盖 D-005 的 Schema 子项
- type: consistency
- priority: P2
- status: confirmed
- source: design-grill
- question: D-005「工具行五标签（含 Schema）」与 D-007「隐藏 Schema」冲突如何记账？
- answer: D-007 覆盖 D-005 的 Schema 子项；D-005 的其余内容（标签结构、可调宽、抽屉）继续有效。
- normalized_requirement: 实施与文档一律按工具行四标签理解。
- impacts: [FR-05]
- evidence: decisions.md D-005/D-007

## D-019@v1: 账本不渲染请求边界点
- type: scope
- priority: P1
- status: confirmed
- source: design-grill
- question: 参考图事件列的「请求边界点」是否有数据支撑？
- answer: 产品路径没有 request 级边界字段（D-006 已声明不搬 request 行），如用 attempts 推导会把模型重试误当请求边界。裁决：删除该子项，事件列只保留轮次起始标签与轮次竖线。
- normalized_requirement: 账本行禁止渲染 request 圆点；轮次标签/竖线保留。
- impacts: [FR-03, task-03]
- evidence: .sillyspec/.runtime/stage-reviews/brainstorm-review-2026-10-22-120200/review.json（新问题B）

## D-020@v1: 时长偏好为全局偏好
- type: definition
- priority: P2
- status: confirmed
- source: design-grill
- question: 时长开关的持久化粒度？
- answer: 采用全局偏好（对齐 dsh 的 `dsh.trajectory.duration`），localStorage key `sillyhub.trajectory.scaleMode`，不按会话区分。
- normalized_requirement: 切换即写入全局 key，挂载时回读；非法值回落 duration。
- impacts: [FR-02, task-02]
- evidence: frontend/src/components/daemon/session-panel/turn-state.ts（既有按会话 key 的对照，本次不采用）
