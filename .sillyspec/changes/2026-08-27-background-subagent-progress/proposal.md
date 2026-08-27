---
author: qinyi
created_at: 2026-08-27 09:25:00
change: 2026-08-27-background-subagent-progress
---

# Proposal · 后台异步子代理进度可视化

## 动机

主 agent（Claude Agent SDK 0.3.181 interactive session）用 `Agent` 工具**后台异步模式**派发子代理后，平台对子代理生命周期完全失明。生产实证（会话 dd345992，2026-08-26/27）：两个后台子代理真实运行 1h45m+，但前端显示"已完成 / 00:00"（0.1 秒启动回执被当作完成信号）、后台卡片永远转圈且无任何进度内容、用户无法分辨"还在跑"与"卡死了"（沉默 26 分钟）。会话顶部下拉的时间进度一栏全是 00:00。

根因是三处链路缺口（详见 `design.md` §1）：daemon 只发一次 `agent_task_status: running`、之后再无进度与终态事件（SDK 已提供的 `task_started/task_progress/task_notification` 系统消息被 backend `_extract_sdk_messages` 静默丢弃）；前端用"派发往返耗时"冒充子代理时长；跨轮到达的子代理日志在展示层变成孤儿块。

## 关键问题（现有方案为何不够）

1. **信号源现成但被丢**：SDK 0.3.181 已声明完整任务生命周期消息（`SDKTaskNotificationMessage` 含 status: completed|failed|stopped + summary + `usage.duration_ms` 真实时长），但 backend 对 system 类消息一律返回 `[]`，daemon 也不拦截——不是 CLI 不给，是平台没接。
2. **展示层推导口径错误**：异步启动回执 0.1 秒内与 tool_use 配对，`collectSubagents` 据此判"done"、目录据时间戳差显示"00:00"——口径把"派发成功"当成了"执行完成"。
3. **一次性 SSE 无法回放**：即便补事件，刷新/历史回看后状态全丢，需要持久化载体。

## 变更范围

跨 sillyhub-daemon + backend + frontend 三子项目（单一变更，不拆分，D-001@v1）：

- **daemon**：session-manager 拦截 `task_started/task_progress/task_notification`（+`task_updated` 轻量），维护会话级任务表，映射扩展 `agent_task_status` SSE 事件；解析异步启动回执兜底（防假完成）；生命周期节点落 `[TASK_*]` stdout 日志行（D-002@v1）。
- **backend**：`AgentTaskStatusEvent` schema 扩展（终态 + 进度字段，向后兼容）+ Redis 发布透传；`submit_messages` 跨轮归位（带 `parent_tool_use_id` 的行落回派发 run，D-003@v1）；空 prompt inject 422（D-004@v1）。
- **前端**：后台卡片全生命周期（正在做什么/走秒/tokens/最后活跃 X 分钟前/终态定格）；子代理目录与会话块异步感知（不再假"已完成/00:00"）；发送按钮空内容禁点。

## 不在范围内（显式清单 / Non-Goals）

见 `design.md` §3：N1 不覆盖 dispatch_worker 平台 worker（team-mission 独立链路）；N2 不做按子代理计费拆分；N3 不做暂停/恢复/停止控制 UI；N4 历史数据不迁移；N5 不做 Codex provider 后台任务；N6 不新增 DB 表/列。

## 收益

- 后台子代理从"黑盒假完成"变为"可观察的真生命周期"：状态、进度、真实时长、活跃度四维可见。
- 消灭会话页面三类误导：假"已完成"、假"00:00"、永远转圈的卡片。
- `[TASK_*]` 持久行 + 归位让历史回看与实时同源，孤儿 stub 消除。

## 风险

见 `design.md` §9（R-01 SDK 运行时发射待 spike 验证为最高风险，兜底路径独立成立；R-02 god 文件改动；R-03 日志行量节流；R-04 归位语义回归）。
