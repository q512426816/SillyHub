---
author: qinyi
created_at: 2026-09-20 09:36:21
---
# 提案书（Proposal）

## 动机

origin=tool_report 且 turn_count===0 的会话（SillySpec CLI 自动上报创建）打开后主体是日志元数据卡列表，正文藏在每条卡片「查看内容」320px 嵌套小窗——用户结论：应该直接按会话样式展示，只是数据来源不一样（decisions.md D-001，用户亲选方案 A）。2026-09-19 实证调研进一步钉死：token 用量与轮次边界（turnId）在 zcode 日志里齐备但解析器丢弃；claude-code 格式规整（含 usage/isMeta）却无解析器；cursor-agent transcript 干净可解析但 token 不落盘；系统注入消息冒充用户气泡是「内容不对」的展示语义根因。

## 关键问题

1. **形态错位**：回放是「关于日志的报告」而非「对话本身」——用户气泡/答复/工具卡片/轮次徽标全部缺位，与普通会话体验割裂。
2. **token 黑洞**：模型 I/O 日志每次调用都带完整用量（输入/输出/缓存命中/写入），现有解析链路第一步丢弃，用户看不到一个变更烧了多少 token（实测样例会话：输入 6366 万、缓存命中 6247 万）。
3. **harness 覆盖不均**：解析器矩阵只有 zcode 一家；claude-code 存量日志只能看原文 JSONL 尾部；cursor IDE sqlite 连原文都被二进制黑名单 409 挡死；cursor-agent CLI transcript 干净可解析但完全没接入。

## 变更范围

- 回放主体置换：TurnTimeline 直适配（page + dialog 两形态），主日志=正文、subagent_agent_ 前缀子代理日志=「工作会话」次级入口，多主日志切换；
- 显示语义归一化：系统事件（task-notification/system-reminder/isMeta）不冒充用户气泡；首屏最早窗口落点（带上限）；超长输出复用 30k 字符折叠；
- 解析器矩阵：zcode 补 usage/turn_id/model/全会话累计（内层 snake_case 直通）；新增 claude-code-jsonl（对话+usage 全量口径归一）与 cursor-agent-transcript（对话、token 恒未知）解析器；
- 四层链路：daemon → RPC → 平台 schema/OpenAPI → gen:types → 前端；老 daemon/老数据全字段可选缺省「未知」。

## 不在范围内（显式清单）

- 不做 L3 解析产物落库（回放依赖上报机器在线，与现状同口径）
- 不做 cursor-agent 作为 daemon provider 的运行时 token 捕获（stream-json/hooks 属另一功能）
- 不做 cursor IDE store.db 对话化（blob 库、无 token、存量 1 条）
- 不改 sillyspec 仓扫描上报层（cursor-agent 发现/上报在跨仓；本仓预置格式 key 契约）
- 不动已激活 tool_report 会话形态（turn_count>0 走正常对话流 + AgentLogCard）
- 不改 200 段窗口/20MB/5s 预算与 beforeSeq 分页协议

## 成功标准（可验证）

- 打开 137ddfff 同型会话：主体=会话样式对话流（系统事件行、真人用户气泡、思考折叠、工具卡片、轮 token 徽标、用量汇总条）；
- claude-code 日志可对话化回放（非原文）；cursor-agent fixture 走新解析器测试绿；
- token 徽标/汇总条跨 harness 同一全量口径；无数据源显示「未知」；
- 老 daemon mock（无新字段/422）回落原文/未知，不报错；已激活会话、普通会话、群聊零回归；
- scoped 测试全绿（daemon tests/agent-log 5 文件、backend test_agent_log_messages、前端 3 测试文件）。
