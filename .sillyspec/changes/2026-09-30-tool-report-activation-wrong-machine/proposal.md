---
author: qinyi
created_at: 2026-09-30 11:00:12
---
# 提案书（Proposal）

## 动机

本地 Agent 会话（CLI 上报聚合的 `origin='tool_report'` 会话）在平台上继续对话时整体不可用（服务器会话 473a8c37 实证）：发消息导致历史回放被切走、消息发送秒败、会话被永久钉死在错误机器上且 UI 无任何机器/agent 选择手段。根因是上报链路不携带机器身份、派发与上报机器无关联、接手未按引擎能力分档（resume/交接）。

## 关键问题

1. **错机派发 + 钉死**：懒激活 cwd 取上报的 Windows 路径，机器按"心跳最新"自选命中 Mac mini，daemon cwd 守卫拒绝启动后 run 秒败，但激活事务已把会话钉死错误机器，重试恒失败。
2. **回放消失体感**：激活置 turn_count=1 使前端主体从本地日志回放切到对话时间线，历史收进默认折叠栏，加上新轮秒败，用户体感"之前的信息全没了"。
3. **上下文断裂**：接手一律新开引擎会话——claude-code 本可 resume 原引擎会话被浪费，zcode 无 adapter 强行映射 claude 且无上下文交接，新会话完全不知之前在做什么。

## 变更范围

- 上报协议 v2：entries 携带 machine 块（machine_id/hostname）落 platform_agent_logs 两新列；daemon 心跳附 machine_id（平台侧就绪，CLI 仓另立）。
- 接手（takeover）新链路：原会话永远只读；首条消息分叉式创建接手会话（fork 三件套溯源），原机四级钉定派发（machineId→hostname→allowed_roots 唯一→409 中文报错），claude-code/codex native 档 resume 原引擎会话，zcode 等 handoff 档交接文档注入 + 引擎/档案重选。
- 懒激活分支退役（inject 对 pending tool_report 会话 409 指引 takeover）。
- 存量钉死会话一键重置端点 + 页面按钮。
- 前端衔接状态 UI：衔接方式提示条、接手 agent 选择器、原机离线错误卡、回放主体保持。

## 不在范围内（显式清单）

- 不做 CLI（sillyspec 仓）侧 machineId 生成与上报改造（跨仓另立变更）
- 不做交接文档 LLM 总结（v1 确定性模板）
- 不做普通 chat 会话的换机/迁移
- 不做 zcode 等引擎的 daemon adapter 接入
- 不改变既有 fork 端点（POST /sessions/{id}/fork）行为

## 成功标准（可验证）

- 老 CLI 上报（无 machine 块）行为不变（extra=ignore，列 NULL）
- 未激活 tool_report 会话发首条消息：原会话保持只读回放（turn_count=0），创建带 fork 溯源的接手会话并派发到上报机器；原机离线时 409 中文报错、不建会话、不换机
- claude-code 会话接手后 daemon 以 resume 原引擎会话启动（lease metadata 含 resume_session_id）
- zcode 会话接手带交接文档首 prompt，且引擎/档案可重选（校验属于原机支持集合）
- 存量钉死会话（如 473a8c37）页面一键重置回只读回放态
- 旧前端对 pending tool_report 会话调 inject 收到 409 + takeover 指引文案
