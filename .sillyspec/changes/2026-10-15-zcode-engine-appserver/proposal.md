---
author: qinyi
created_at: 2026-10-15 13:25:24
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机
平台现有交互式引擎 claude / codex / pi 三家，用户希望在平台上像调用 claude code 一样调用 ZCode 进行单聊会话。ZCode Desktop 内嵌引擎提供 `app-server` 子命令（ZCode 私有协议 stdio 服务端，NDJSON），与平台"spawn CLI 子进程当引擎"的既有模式同构（codex app-server 同为 stdio 自定义协议），接入成本约一个 codex 驱动量级。协议面已经 2026-10-15 两轮实测钉板（端到端全链路跑通：建会话/发消息/token 级流式/打断/关闭；模型路由注入验证生效）。

## 关键问题
1. 平台引擎注册表（INTERACTIVE_PROVIDERS）目前无 zcode 条目，zcode 无法作为会话引擎被创建与调度；
2. ZCode 不是 PATH 上的独立 CLI（Desktop 内嵌引擎），现有探测模式（env → PATH which）不足以发现它，需要固定安装路径回退与 node 执行形态支撑；
3. ZCode 模型路由走其个人 Provider 配置体系（provider_config.json，密钥落文件非 env），与 dsh/codex 的注入形态不同，需要专用 settings 写入器；会话数据库机器全局共享，与 dsh per-session 全隔离的先例不同，隔离边界需显式决策（D-002：配置面隔离、会话库接受共享）。

## 变更范围
sillyhub-daemon：新增 ZCode 私有协议驱动（zcode-envelope.ts 信封层 + zcode-app-server-driver.ts + zcode-events.ts + zcode-settings.ts）、providers.ts 注册（caps 十六键如实申报）、agent-detector 探测项（fallbackPaths/execNode 扩展）、MIN_VERSIONS 版本门、caps 三端镜像刷新。backend：InteractiveProviderLiteral 加 "zcode"、gen:types 双义务。frontend：单聊 SESSION_ENGINE_OPTIONS 加 zcode。详见 design.md 文件变更清单（14 条）。与 dsh 变更代码不重叠（不碰 messages.py 群附件门控）。

## 不在范围内（显式清单）
- 不做群聊成员接入 zcode（阶段 2）
- 不做 team_enabled / 派分身对 zcode 开放（caps.subagent=false）
- 不做 MCP 注入对接（caps.mcp=false，注入面未验证）
- 不做附件链路（caps.attachments=false，同 codex 现状）
- 不做 steering 忙轮注入（caps.steering=false，排队语义生效）
- 不做会话分叉（caps.sessionFork='none'，锚点语义未对接）
- 不做 askuser 对话框桥（caps.dialog='none'，requestUserInput 阶段 1 自动取消）
- 不做多模态块（caps.multimodal=false）
- 不做会话数据库隔离（D-002：接受机器共享）
- 不做 daemon 自动安装 ZCode Desktop（用户自装，D-001）
- 不做批处理层接入（PROVIDER_TO_PROTOCOL 表不动）
- 不碰群附件门控 messages.py（归 dsh 变更 task-06，代码不重叠）

## 成功标准（可验证）
- 装有 ZCode Desktop（引擎 ≥0.16.9）的机器上，单聊可创建 provider='zcode' 会话，完成一轮对话（assistant 消息含 token 级流式/thought 思考流/工具生命周期落 AgentRunLog，前端正常渲染打字机效果）；
- zcode 会话可打断（session/stop）、审批代答三态（allow/deny/超时 fail-closed）行为正确；
- 配置 LlmProvider 的 zcode 会话走平台路由（per-session provider_config.json 注入 + setModel 生效——实测先例 2026-10-15），未配置时回落机器默认 Provider；
- 未装 ZCode Desktop 的机器：引擎不可见/禁用，现有引擎零回归；
- stdin EOF 退出行为实测记录（R-05 verify 项）；
- 相关聚焦测试全绿（daemon 信封/驱动/归一化/注册 + backend Literal + 前端快照）。
