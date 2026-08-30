---
author: qinyi
created_at: 2026-08-23 21:12:30
---

# 提案（Proposal）— 本地 Agent 会话日志对话化回显（zcode MVP）

## 动机

`2026-08-23-agent-activity-sessions` 上线「本地 Agent 会话」后，用户点开「查看内容」
看到的是 zcode model-io 日志的**原文尾部 256KB**——每行是一次完整 API 请求记录
（全量系统提示词 + 累积对话窗口 + 工具定义），实测单文件 3.6MB/24 行、单行 150KB+，
对人类完全不可读。用户原话：「回显的本地日志无法看，人类完全不可读，是否可以按
会话的形式回显内容？」

## 方案一句话

daemon 侧新增 zcode model-io 解析器（窗口按绝对 offset 对齐重建对话、剥 system
与 reminder、归一化消息段），经新 HTTP 端点透传 KB 级消息给前端，前端直构段列表
复用既有对话渲染组件（工具卡片/思考折叠/Markdown）；解析失败或格式不支持一律
静默回落现有原文查看，现状能力零损失。

## 范围

- **做**：zcode model-io-jsonl 单格式 MVP；daemon RPC + backend 端点 + 前端渲染
  三侧；段窗口（最近 200 段 + 加载更早）；错误/回落全链路。
- **不做**：claude-code/codex/pi 解析（二期扩展解析器注册表）；tool_report 生命周期
  与懒激活链路改动；消息落库；解析缓存；复用 session-log-assembler（Grill B2 裁决，
  见 design §3 非目标）。

## 关键决策

D-001@v1 daemon 侧解析｜D-002@v1 MVP 仅 zcode｜D-003@v1 失败回落原文｜
D-004@v1 方案 A 用户确认｜D-005@v1 四段设计+原型确认｜D-006@v1 Grill 三裁决
（真实格式事实/前端直构/错误双通道分层）。

## 验收要点

- 真实 zcode 会话日志打开「查看内容」→ 对话流（用户气泡/助手正文/工具卡片配对/
  思考折叠），无 system 提示词与 system-reminder 泄漏；
- codex/dsh/cursor 条目 → 回落原文或 409，行为与现状一致；
- 老 daemon / 文件被轮换 → 回落或既有 404 文案，无报错弹窗。
