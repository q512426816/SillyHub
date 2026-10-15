---
author: flow-machine-draft
created_at: 2026-10-15T06:06:16.365Z
---
# 设计记录（Design Record）— 2026-10-15-session-status-dot-semantics

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

会话列表一行原有两套点（行首状态点 + 行尾活性灯），且行首点把 active 画成青点——本平台 active 只表示「会话开着」（空闲也在内），并非「正在执行」，用户无法从点分辨会话在干嘛，语义混乱。本变更参考 deepseek-harness 的 StateDot 五态（done 绿/ongoing 转圈/error 红/warning 琥珀/idle 弱化），把行首标识重定义为单一源 `sessionStatusIndicator(status, 活性state)`：failed→红点、ended→绿点、活性 working→动态转圈、活性 blocked→琥珀点、reconnecting→转圈、其余一律留白；行尾活性灯退役，悬停详情卡与未读红角标平移进行首槽（SessionStatusSlot，18px 恒占位保证各行标题对齐）。转圈的「进行中」信号取活性推导 working 而非 status=active（用户确认项：正在干活才转圈）。

另按用户补充需求新增「执行完成通知」：面板挂载期内检测会话由非终态翻 ended 且当前不选中该会话 → 行首槽亮绿色通知角标（localStorage 落盘，键 `sillyhub:session-completed-unread:<id>`，与活性未读同款机制），点击/回车/深链进入该会话（selected 边沿）后消失。改动全部收敛在 `frontend/src/components/sessions/session-list-panel.tsx`（纯前端展示层）与其测试文件，后端与 API 契约零变化。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `session-list-panel.tsx` 模块内：删除 `statusDotClass(status)`（6px 点色类），新增纯函数 `sessionStatusIndicator(status, livenessState)` 返回判别联合 `SessionStatusIndicator = {kind:"dot",cls,label} | {kind:"spinner",label} | null`；新增模块级 `isCompletedUnread/markCompletedUnread/clearCompletedUnread`（localStorage 键前缀 `sillyhub:session-completed-unread:`）；新增内部组件 `SessionStatusSlot`。
- `SessionRow` props：新增可选 `completedUnread?: boolean`；`liveness/livenessUnread` 语义不变（悬停卡/未读角标位置随槽迁移）。
- 对外（跨模块）导出签名零变化：`SessionListPanel` props、`formatRelativeTime`、`sessionListPollInterval`、scope 类型均不动；后端端点/OpenAPI 无改动，无 gen:types 义务。
- 行内 DOM 契约变化：`data-testid="liveness-dot"` 退役 → `data-testid="session-status-indicator"`（18px 行首槽）；点 aria-label 从「状态 <status>」改为语义文案（异常失败/执行完成/正在执行/在等你/恢复中）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：活性 map 与会话列表是两个独立数据源（30s/10s 轮询），到达顺序不定——判定函数把 status 终态放在活性之前，陈旧活性（如会话已 ended 但活性仍 working）不会把终态行画成转圈；活性未到只影响非终态行（回退留白），不影响终态行。
2. 并发写：完成通知/活性未读均为「单浏览器单标签」localStorage 键，按 sessionId 隔离无竞争；多标签同开时两端都可能 mark/clear 同一键，后果只是角标亮/灭的展示差异，无数据损坏面（键仅存在性语义，值无累积含义）。
3. 切换/生命周期：完成通知检测基线 prevStatusRef 在内存，挂载后首个快照即基线——历史已终态会话不会误报；页面关闭期间完成的会话不补报（已在注释声明，属预期范围）；已落盘的通知键跨重挂/刷新保留至用户点击，SessionRow 的 selected 边沿清除覆盖点击/Enter/深链三路入口，批量勾选不清除（与活性未读一致）。
4. 作用域：通知键以 sessionId 为粒度全局唯一，跨 workspace/change/quicklog/runtime 四种 scope 共享同一份落盘（与活性未读同策略），不会串台；面板重挂载（scope 切换）后行组件从 localStorage 重读，通知不丢。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：转圈信号取活性 working 依赖 agent 日志上报链路（无日志/未上报的会话活性缺失 → 非终态行留白，用户可能觉得「跑着的会话没转圈」）。缓解：活性链路是既有成熟机制（工作台总览卡同源），且终态红/绿点不依赖活性，最坏退化为留白而非错误标识。放弃的方案：a) status=active 即转圈——会让所有未结束聊天会话永久转圈（用户确认否掉）；b) 保留行尾灯只改行首点——两套点并存，语义打架的根源不除（用户确认移除并入）；c) 把完成通知做进 use-session-liveness hook——完成是会话 status 转移不是日志 state 转移，数据源不同，硬塞进 hook 会让 hook 依赖会话列表数据，耦合更差，故检测放面板层。
