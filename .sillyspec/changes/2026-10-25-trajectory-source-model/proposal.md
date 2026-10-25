---
author: qinyi
created_at: 2026-10-25 09:48:17
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机

轨迹视图补齐「上下文 / 系统」两类行时发现结构性数据缺口：dsh 的引擎事件原生携带消息来源（source.kind）与请求头快照，本平台日志层两者皆无——团队派发指令、后台通知等系统注入全部以 user_input 落库且 metadata 为空（DB 实证），前端无从区分，轨迹里全标「用户」。用户裁决按 dsh 机制做全套：数据层来源标记 + 请求级配置面快照上报，跨三端。

## 关键问题

1. **来源不可辨**：系统注入与真实用户输入在数据层无法区分（无标记），展示层只能猜（启发式已被否决）。
2. **配置变更不可见**：系统提示词/工具清单变更无任何记录，用户无法从轨迹判断"这轮配置变了"。
3. **透传断链**：daemon 上报的 metadata 在 backend submit_steps 只落 `_agent_event` 一键，其余全丢（知识库已知坑）。

## 变更范围

- backend：三注入点盖 `turn_trigger`（team_brief / worker_dispatch / agent_notice）；submit_steps metadata 白名单透传；`session_header` channel 落库。
- sillyhub-daemon：轮边界采集配置面快照（systemPrompt 配置段 / allowedTools / mcpServers），字段级比较，仅 initial / change 上报。
- frontend：`TURN_TRIGGER_META` 补三行（上下文行经既有链路）；`session_header` 装配 `request_header` 段 → 轨迹「系统」行（四态文案，前端 diff）；revert 之前的启发式代码。
- 真码原型已登记（轨迹原型扩展三类新行）。

## 不在范围内（显式清单）

- 不回填存量历史会话标记（无标记如实显示「用户」行）。
- 不获取引擎（Claude Code CLI）内部系统提示词全文（配置面口径）。
- 不在会话页聊天流渲染系统行（只进轨迹）。
- 不新建表 / 端点 / 查询链路。
- 不改轮次状态机、SSE 建流协议、日志读取 API 形状、OpenAPI schema。

## 成功标准（可验证）

- 三注入点的 user_input 落库带对应 `turn_trigger` 值；真实用户输入不盖戳。
- 新会话首轮落 `session_header`（initial）日志；配置变更轮落 change 日志；无变化不落。
- 轨迹：盖戳消息显示「上下文」行（团队派发/Worker 派发/通知三形态）；快照变更显示「系统」行（初始/系统提示词/工具/双变更四态文案）。
- 旧 daemon/旧 backend 组合零行为变化；`submit_steps` 白名单键透传、白名单外丢弃。
- 启发式代码 revert；三端测试零回归、类型检查全过。
