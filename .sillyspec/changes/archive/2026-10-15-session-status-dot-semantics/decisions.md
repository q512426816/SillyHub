---
author: flow-machine-draft
created_at: 2026-10-15T06:41:34.217Z
---
# 决策记录（Decisions）— 2026-10-15-session-status-dot-semantics

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：转圈信号取活性 working 依赖 agent 日志上报链路（无日志/未上报的会话活性缺失 → 非终态行留白，用户可能觉得「跑着的会话没转圈」）。缓解：活性链路是既有成熟机制（工作台总览卡同源），且终态红/绿点不依赖活性，最坏退化为留白而非错误标识。放弃的方案：a) status=active 即转圈——会让所有未结束聊天会话永久转圈（用户确认否掉）；b) 保留行尾灯只改行首点——两套点并存，语义打架的根源不除（用户确认移除并入）；c) 把完成通知做进 use-session-liveness hook——完成是会话 status 转移不是日志 state 转移，数据源不同，硬塞进 hook 会让 hook 依赖会话列表数据，耦合更差，故检测放面板层。
