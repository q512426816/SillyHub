---
author: qinyi
created_at: 2026-09-03 23:45:00
---

# 提案书（Proposal）

## 动机

SillyHub 目前真正可用的 agent 只有 Claude Code，事件归一化散落两处半（批量 adapter.parse / 交互式 backend `_extract_sdk_messages` / daemon stream_event 缓冲），`[ASSISTANT]` 文本协议是三端事实契约。用户目标：后续**便捷且稳定**地接入其他 agent CLI。对照 multica（23 agent CLI）调研结论：统一事件通道 + 声明式注册表是其滚雪球根基（详见 research-multica-agent-adaptation.md）。本变更把这两个模式落到 SillyHub（方案A 渐进下沉，D-001@v1）。

## 关键问题

1. **归一化散落**：换一个 agent 必须同时改 daemon driver、backend `_extract_sdk_messages`（只认 Claude SDK 形状）、前端文本协议解析三处，每接一个 provider 重写一遍归一化 hack。
2. **交互式契约缺口**：`InteractiveDriver` 输入侧中性但输出侧透传 raw 消息，SessionManager 6177 行内 15+ 处 `provider === 'claude'` 分支，SDK 类型泄漏到 cli.ts。
3. **能力门控散落**：前端 session-panel 与 backend daemon/session service 散落硬编码 provider 判断，新增 provider 时每处都可能漏改。

## 变更范围

- **P1 事件契约**：AgentEvent v2（类型+zod schema，8 型+一等字段）；ClaudeEventNormalizer 有状态归一化器（完整展开/partial+override/depth 三块移植）；会话级信号 status 事件化；backend `_persist_agent_event` 双轨分支（零 DDL）；前端 normalize 双轨。
- **P2 注册表/能力矩阵**：providers.ts 注册表（InteractiveProvider 推导）；SessionManager 门控下沉；ProviderCaps 三端镜像表 + 守护测试；门控收敛；接入清单文档。

## 不在范围内（显式清单）

- 不实际接入新 agent（gemini/opencode 等，后续 change 验证三档路径）
- 不弃用 Claude Agent SDK（直接 spawn 列为后续可选优化）
- 不做数据库迁移（零 DDL）
- 不退役旧文本协议（双轨期兼容，退役为后续 change）
- 不动批量路径各 adapter 的 parse 实现（仅类型联合对齐）
- 不引入 execenv 式环境准备层（注册表预留字段位）

## 成功标准（可验证）

- Claude 交互式会话渲染与现状等价：同一事件序列生成的两种载荷（旧文本行 vs agent_event 行）双路径 fixture 对照，normalize 渲染模型树等价（design §2 目标 2）
- golden 三源对照通过：ClaudeEventNormalizer 输出 ≡ 现状三处实现联合语义（含 partial→override→撤回、实时 usage、子代理归属）
- codex 交互式会话在新事件契约下工作
- 新增 provider 不改 `InteractiveProvider` 类型系统（注册表条目即可）；三端能力表对齐守护测试通过
- 旧 daemon（无 kind 键消息）行为与现状一致（兼容轨测试）
- 产出 docs/agent-provider-onboarding.md 三档接入清单
