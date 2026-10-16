---
author: qinyi
created_at: 2026-10-16 11:02:17
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机
会话中"让用户决策的信息"（AskUser 提问、Plan 审批）散落在聊天流各处：pending 提问卡 sticky 在聊天流顶部、Plan 审批卡在输入区上方、已答历史穿插在时间线 turn 内。会话变长后，用户无法一眼看到"当前会话正在/曾经等过我做哪些决定"。变更文件已有悬浮 pill 聚合入口（2026-10-13-session-change-files-hover），决策信息缺少同款聚合视图。

## 关键问题
- 决策点分散三处（sticky 卡/审批卡/时间线内嵌），长会话中回看历史决策要在聊天流里翻找；
- 已答历史无独立查看入口——时间线内嵌形态只有一句话摘要，看不到当时的完整选项与自己的选择；
- 被最小化的提问卡只剩右下角胶囊一条还原路径，与其它决策信息无统一入口。

## 变更范围
- 新增会话面板"待决策"悬浮 pill 组件（SessionDecisionsHover）：胶囊入口 + hover 下拉分组列表（待决策置顶/已答历史默认折叠）+ 历史只读详情弹窗；
- 挂载点改造：与变更文件 pill 并排成悬浮行；
- pending 项点击定位回聊天流卡片（含还原最小化卡、高亮闪烁）；
- TurnTimeline 与 session-change-files-hover 各加一个向后兼容的可选 prop；
- 纯前端实现，数据面零新增（消费既有 SSE 状态与 REST）。

## 不在范围内（显式清单）
- 不在 pill 弹层内直接作答（作答仍走聊天流 sticky 卡 / Plan 审批卡现有交互）
- 不聚合普通工具审批（门户会话 ask_user_only=true 不会发生，D-005）
- 不新增后端端点/持久化/schema（D-006）
- 不改造 dialog 模式（runtimes 弹窗）挂载，仅 page 模式

## 成功标准（可验证）
- 会话有 pending 提问/Plan 审批或有已答历史时，输入条上方右侧出现"待决策"pill（与变更文件 pill 并排），徽标数 = 当前待决策数；三类信息全空时不渲染；
- hover/点击 pill 弹出分组下拉：待决策组置顶（标题+类型徽标+状态短语），已答历史组默认折叠可展开（状态徽标+回答摘要+时间）；
- 点击 pending 项：时间线滚顶 + 对应 sticky 卡高亮闪烁，被最小化的卡先还原；
- 点击历史项：打开只读详情弹窗（问题+选项列表，当时选择标 ✓+提问/回答时间）；
- 分组纯函数与组件渲染 vitest 用例通过，既有 session-change-files-hover / turn-timeline 测试无回归。
