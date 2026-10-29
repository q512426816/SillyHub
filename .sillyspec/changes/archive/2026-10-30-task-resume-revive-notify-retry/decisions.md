---
author: flow-machine-draft
created_at: 2026-10-29T23:58:35.905Z
---
# 决策记录（Decisions）— 2026-10-30-task-resume-revive-notify-retry

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- **最大风险**：SDK 续唤时是否可靠重发 task_started 未实证（CLI 转录不记 system 帧、daemon.log 无注册日志；归一化器注释已知「SDK 重放 task_started」形态存在）。若 SDK 对某些续唤路径不重发帧，resumed 信号源缺失，运行期显示失真仍在——本变更保证「SDK 重发时全链路通」，不声称覆盖引擎不发信号的场景（引擎契约限制，如实声明）。 - **试过放弃：时间阈值启发式复活**（终态后 N 秒外 running 视为续唤）——task-sweep-liveness-guard 历史否决同型，时间猜测必误判长任务/跨轮任务，不复活。 - **重试风暴风险**：上限 3 次 + 指数退避 + 仅 5xx/网络错误触发；4xx 即刻放弃。502 实测场景（平台网关故障时段）多事件并发各退避，最坏 4 次请求/事件，可接受。
