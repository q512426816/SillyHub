---
author: qinyi
created_at: 2026-10-13 12:16:14
---

# 决策记录 — 2026-10-13-session-change-files-hover

## D-004@v1 : ChangeFileTree 实时性走可选 autoRefreshMs prop（Grill 修正，弃「零改造」表述）
- type: architecture
- status: implemented（brainstorm step7 独立审查抓出 P1 后定稿）
- source: review（独立审查子代理源码实证）
- question: 「实时掌控」的文件树刷新机制——零改造复用还是组件最小扩展？
- answer: 给 `ChangeFileTree` 加可选 prop `autoRefreshMs?: number`（默认 `undefined` 不轮询），设置时挂载起 `setInterval(refreshTree, ms)` + 卸载清除；弹窗内传 15000。
- evidence: change-file-tree.tsx L438 唯一 setInterval 仅保存 pending 态 2s 轮询（5min 上限），树本身是挂载单次拉取——「常驻轮询」为失实声明，零改造则实时性落空。
- 否决「父组件定时 key 重挂载」：会重置展开/选中状态，体验差；否决「快照语义」：不满足用户实时掌控诉求。默认值保证既有消费方（ChangeFilesCard/移动端）行为不变。

## D-001@v2 : 会话页面悬浮展示变更文件采用「胶囊入口 + hover 下拉列表 + 点项开大弹窗」形态（方案 A，step5 用户修正）
- type: architecture
- status: implemented（brainstorm step5 设计确认轮定稿）
- source: user（AskUserQuestion 两轮：step4 选方案 A；step5 修正交互形式后亲确认）
- question: 会话页面悬浮展示变更文件采用什么交互形态？
- answer: **胶囊入口 + hover 下拉 + 点项开弹窗**。后端新增「会话关联变更列表」端点（`change_session_links` M:N 关联表 JOIN `changes`，排除 deleted，未归档优先/最新优先排序）；前端 SessionPanel 聊天区右下角**非圆圈胶囊入口**（「🗂 变更文件 + 进行中数量徽标」，在跑时呼吸动画），**鼠标悬浮直接弹出下拉项形式的变更列表**（进行中置顶 + 已归档默认折叠可展开，不用先开弹窗）；点下拉项打开 max-w-6xl × 85vh 大弹窗展示 `ChangeFileTree`（弹窗头部下拉可切换变更，key=changeId 重挂载）；弹窗打开时 15s 轮询刷新。
- evidence: brainstorm step4 方案选择轮（A/B/C 三方案，用户选 A）+ step5 设计确认轮（用户反馈"悬浮不要圆圈，改为类似下拉项的、直接在悬浮处显示"→ 修正原型后用户亲确认"确认，继续"）
- rationale: 数据单一真相（link 表全量，覆盖一个会话多变更历史）；hover 即见列表满足「悬浮展示」字面诉求（用户 step5 修正意见）；弹窗用 Modal 不用 Drawer（FRONTEND_PAGE_STYLE §6）；ChangeFileTree 零改造复用。
- supersedes: D-001@v1（悬浮球+弹窗内左栏列表形态被用户否决：不要圆圈、列表不应藏在弹窗里）

## D-001@v1 : 会话页面悬浮展示变更文件采用「悬浮球 + 大弹窗」形态 — 已修订
- type: architecture
- status: superseded（step5 用户反馈修正：不要圆圈悬浮球，列表要 hover 直接展示；v2 保留后端端点与弹窗规格，仅交互入口改为胶囊 + hover 下拉）
- evidence: brainstorm step4 方案选择轮（A/B/C 三方案对比，用户选 A）
- rationale: 数据单一真相（link 表全量，覆盖一个会话多变更历史）；悬浮形态不挤占现有三栏布局（方案 B 的详情列仅 320px 且与子代理面板互斥、可见性不稳定）；弹窗用 Modal 不用 Drawer（FRONTEND_PAGE_STYLE §6 明确规则）；ChangeFileTree 零改造复用。

## D-002@v1 : 落选方案 B（详情列内嵌区块）— rejected
- type: architecture
- status: rejected
- question: 会话页面悬浮展示变更文件选哪种实现形态？
- answer: 方案 B：在右侧「会话详情」列 TaskExecutionPanel 下方内嵌「关联变更」区块，点变更名开弹窗看文件树。
- 否决理由: 详情列仅约 320px 宽，塞变更列表+文件入口拥挤；`detailColumnVisible = !mobile && (subagentPanelOpen || detailOpen)`，详情列与子代理面板互斥且可被用户折叠，入口可见性不稳定；与用户「悬浮展示」的原始诉求不符。
- 复潮条件: 若未来产品决策砍掉悬浮元素、且详情列拓宽并常驻（不再与子代理面板互斥），可重新评估。

## D-003@v1 : 落选方案 C（纯前端拼凑）— rejected
- type: architecture
- status: rejected
- question: 会话页面悬浮展示变更文件选哪种实现形态？
- answer: 方案 C：不改后端，前端用 `AgentSessionRead.change_id` + `current_change_id` 两个字段逐个 `getChange` 拼变更列表。
- 否决理由: 两个字段最多覆盖 2 个变更（创建绑定 + 当前绑定），`change_session_links` M:N 表才是一个会话全部关联变更的唯一真相；历史执行过的其它变更全部丢失，不满足「一个会话内多个变更、归档可展开」的核心需求；且逐个串行请求无排序/归档分组信息（还要逐条补 ChangeSummary）。
- 复潮条件: 若后端把关联变更全量内嵌进会话详情 DTO（目前评估为 DTO 膨胀、实时性差而否决），纯前端方案的自然上限才会解除。
