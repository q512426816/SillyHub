---
author: qinyi
created_at: 2026-09-15 01:01:42
---

# 决策记录 — 2026-09-14-session-thinking-level

## D-001@v1：范围=v2 全量（创建时选档+动态档位查询+会话中切换），自动压缩/思考配置不纳管

- type: scope
- status: confirmed
- source: user
- question: 思考级别功能 v1（仅创建时选档）还是 v2（全量动态化）？
- answer: 用户指定 v2 全量——"继续做下个事，之前跟你说的 v2"。含：①创建时选档（CreateSessionInput.thinkingLevel）②按模型动态档位查询（daemon RPC）③会话中切换（compact 同款 RPC 模式）④codex caps.thinking 漂移顺手修。各引擎思考预算自动配置不纳管（同 D-001 compact 先例）。
- normalized_requirement: 三面统一（创建/查询/切换）+统一七档词表+driver 层映射+caps 第 13 键门控（cursor 不渲染）。
- impacts: 全栈（caps 链+daemon 三 driver+backend 端点+前端表单与会话控件）。
- evidence: 用户本轮指令+前轮 AskUserQuestion（仅手动/仅空闲约束沿用）。
- priority: high
- 锚点: providers.ts:ProviderCaps（第 13 键落点）
- 模块域: sillyhub-daemon, frontend, backend

## D-002@v1：架构=compact 同款 RPC 模式（可选 driver 方法+daemon RPC handler+caps 键）

- type: architecture
- status: confirmed
- source: design
- question: 思考级别设置/查询/切换走什么通道？
- answer: 方案 A：照 2026-09-14-session-ctx-compact 刚验证的 RPC 模式——driver.ts 加可选 `getThinkingLevels?(handle)`/`setThinkingLevel?(handle, level)` 两契约方法；daemon.ts 注册 `session_get_thinking_levels`/`session_set_thinking_level` 两 RPC handler；backend 两端点（GET 档位列表+POST 切换）；caps 第 13 键 `thinking_level`（claude/pi/codex=true、cursor=false）。B（进程重启式）否决：切档重启子进程丢流式状态体验差；C（inject 文本）否决：pi/codex 不认文本且档位查询无通道。
- normalized_requirement: 查询=pi get_available_thinking_levels/claude supportedModels().filter(当前 model).supportedEffortLevels/codex 默认五档；切换=pi set_thinking_level/claude Query.applyFlagSettings({effortLevel})/codex thread/settings/update {reasoningEffort}。
- impacts: driver.ts 契约+三 driver 实现+daemon.ts RPC handler+session-manager 守卫+backend 端点+前端。
- evidence: 调研报告（sillyhub-daemon/node_modules/@claude-agent-sdk sdk.d.ts（pnpm .pnpm hash 目录内）:2505/:2552+codex 二进制 strings+pi rpc.md）+方案对比轮。
- priority: high
- 否决理由: B 体验差且丢状态；C 数据形态不可行。
- 复潮条件: 引擎提供文本 slash 切档通道可重评。
- 模块域: sillyhub-daemon, frontend, backend
