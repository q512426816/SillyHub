---
author: qinyi
created_at: 2026-10-15 12:08:02
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机
平台现有交互式引擎 claude / codex / pi 三家，用户希望在平台上像调用 claude code、pi 一样调用 DeepSeek Harness（dsh）进行单聊会话。dsh 官方提供 `--profile acp` stdio 接入面（Agent Client Protocol v1 标准协议），与平台"spawn CLI 子进程当引擎"的既有模式完全同构（codex app-server 同为 stdio JSON-RPC），接入成本约一个 codex 驱动量级。

## 关键问题
1. 平台引擎注册表（INTERACTIVE_PROVIDERS）目前无 dsh 条目，dsh 无法作为会话引擎被创建与调度；
2. dsh 的模型体系自管（llm-pi-ai 路由配置），不接管模型路由则平台 LlmProvider（密钥/base_url/模型选择）体系对 dsh 会话失效；
3. 现有群消息附件门控硬编码 `provider != "claude"`（messages.py:791-797），与单聊 caps 判定口径不一致，是新增引擎时必须清掉的口径债。

## 变更范围
sillyhub-daemon：新增 ACP 驱动（dsh-acp-driver.ts + dsh-acp-events.ts + dsh-settings.ts）、providers.ts 注册（caps 如实申报）、agent-detector 第 13 个探测项、MIN_VERSIONS 版本门、caps 三端镜像刷新。backend：InteractiveProviderLiteral 加 "dsh"、群附件门控统一为 caps 口径、gen:types。frontend：单聊 SESSION_ENGINE_OPTIONS 加 dsh。详见 design.md 文件变更清单（14 条）。

## 不在范围内（显式清单）
- 不做群聊成员接入 dsh（阶段 2）
- 不做 team_enabled / 派分身对 dsh 开放
- 不做 compact 通道（caps=false 走现有 409 拒绝）
- 不做 steering 忙轮注入（caps=false，排队语义生效）
- 不做 token 级流式（ACP 仅提交点通知，接受 UI 无打字机效果）
- 不做 daemon 自动安装 dsh（用户自装，D-001）
- 不做批处理层接入（PROVIDER_TO_PROTOCOL 表不动）

## 成功标准（可验证）
- 装有 dsh ≥0.2.1 的机器上，单聊可创建 provider='dsh' 会话，完成一轮对话（assistant 消息/thinking/工具生命周期落 AgentRunLog，前端正常渲染）；
- dsh 会话可打断（session/cancel）、审批代答三态（allow/deny/超时 fail-closed）行为正确；
- 配置 LlmProvider 的 dsh 会话走平台路由（patch + env 注入），未配置时回落 dsh 本机默认模型；
- 未装 dsh 的机器：引擎不可见/禁用，现有三引擎零回归；
- 群附件门控：claude/pi/cursor/dsh 放行、codex/未知引擎拒绝（caps 口径测试钉死）；
- 相关聚焦测试全绿（daemon 驱动/归一化/门控 + backend Literal/门控 + 前端快照）。
