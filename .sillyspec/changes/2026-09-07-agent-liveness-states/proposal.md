---
author: qinyi
created_at: 2026-09-07 10:35:00
---

# 提案书（Proposal）— Agent 会话活性状态推导

## 动机

平台对本地 agent 会话的感知止步于登记（日志路径 + 元信息 + 对话化渲染），回答不了"这个 agent 此刻是活的还是死的、在干活还是在等我"。多会话并行场景下"切来切去找哪个卡住了"是核心痛点；派活系统对 running 期 worker 只有"超时即杀"的盲判。2026-09-07 三项实证（E-08 第一方权限管线覆盖面 / E-03 zcode 日志证伪 / E-02 codex 词汇表）已为路线定形：活性走 daemon 日志 tail 推导，blocked 走第一方权限事件汇聚。

## 关键问题

1. **进度≠活性**：进度只在 `--done` 推进——agent 卡住 20 分钟进度纹丝不动，用户无从分辨"还在跑"和"已经死了"。
2. **等人无信号**：agent 卡在权限确认等人时无信号离开本机；scan 型待审有第一方管线但派发编排（list_workers）看不到，仍按超时 kill。
3. **登记盲区**：登记只发生在 CLI 调用入口——卡在首次调用之前、未接流程的裸 agent 会话永远不上册。

## 变更范围

P1 全量 a–e（D-001@v1）：daemon liveness tailer + 三层数据源自发现 + zcode/codex/claude 三个 deriver；backend 状态四列落库 + `POST /api/agent-logs/states`（upsert-create）+ `agent_blocked` 通知；前端状态徽章 + 多会话聚合 + 通知消费；`list_workers` liveness 字段 + sillyspec 仓派发模板知情决策改写。详见 design.md §5/§6。

## 不在范围内（显式清单）

- 不做 PTY 常驻 / 终端复用 / 屏幕扫描（Herdr 路线）
- 不改 CLI 上报主契约（不上报日志内容、不新增 CLI 常驻）
- 不做 blocked 自动批准（只升级给人；自动批另立评估）
- 不含 `agents status` CLI 命令与协议文档 §8 定稿（P2，sillyspec 仓另立变更）
- 不含 Herdr interop / 模式 B' 状态上行（P3 缓议）
- 不做 pane 粒度编排

## 成功标准（可验证）

- 派发 zcode 会话后平台视图 10s 内出状态；裸 agent 会话（全程不调 sillyspec）同样 10s 内出状态
- 人为制造 scan 型确认等待 → agent_blocked 通知在 120s 阈值 + 10s 内到达；空闲会话不得产生 blocked 通知（R-01 回归）
- tailer 崩溃不影响 `read_agent_log_messages` 与登记链路（R-02 回归）
- worker 卡确认时 `list_workers` 可见 blocked 且升级非 kill；长任务不被抢跑 kill
- zcode 会话上下文压缩换文件后 tailer 经 reset/重扫恢复跟踪不串台
- CLI 上报契约零变更；旧落库行显示 unknown，零迁移兼容
