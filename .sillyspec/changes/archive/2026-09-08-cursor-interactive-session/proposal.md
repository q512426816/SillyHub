---
author: qinyi
created_at: 2026-09-08 12:17:37
---

# 提案书（Proposal）

## 动机

平台交互式会话目前仅支持 claude / codex / pi 三个引擎，cursor 只能跑批量任务（团队派发/批量执行），不能像其它引擎一样开多轮对话会话。用户要求"平台 agent 再补充接入 cursor 的能力"——补齐 cursor 的交互式会话链路，让 cursor 成为第四个可选会话引擎。

## 关键问题

1. **注册面缺口**：`INTERACTIVE_PROVIDERS`（daemon 注册表）、`PROVIDER_CAPS`（三端能力矩阵）、backend `InteractiveProviderLiteral`（DTO 校验）、前端两处引擎白名单、daemon 会话持久化 `VALID_PROVIDERS` 均无 cursor——五层都会拦住 cursor 会话（创建即 UnsupportedProvider / 422 / 前端不可选 / 重启丢会话）。
2. **无既有 driver 可复用**：cursor-agent CLI 无 stdin 控制协议（无 `--input-format`）、无 Claude Agent SDK 握手、`worker` 子命令实测是 Cursor 云端注册通道——三件套抽象层落地后还没有第四个 provider 验证过"无长驻协议 CLI"的接入形态。
3. **帧结构未实证**：cursor 的 stream-json 帧只有批量层代码证据（claude 同构子集推断），system 帧是否带 session_id、`--resume` chatId 语义、result 帧形状均未真机验证（本机 cursor-agent 登录凭证已过期，阻塞实测）。

## 变更范围

按接入手册档C 变体（探测表已有，补 interactive 层）：

- daemon：新建 `cursor-driver.ts`（每轮 respawn + `--resume chatId` 薄 driver，Windows resolveWindowsCmdShim）+ `cursor-events.ts`（无状态归一化器）；注册表/装配/持久化白名单三处注册点。
- backend：caps 镜像 + 守护测试 EXPECTED_PROVIDERS + `InteractiveProviderLiteral` 加 "cursor"。
- frontend：caps 镜像 + 两处引擎白名单。
- 前置实测（Wave 0）：真实帧样本抓取（fixture 进 golden 测试）+ resume 连续性验证 + 非 force 权限探针（D-003 结论回填）。
- 测试与冒烟 + onboarding 手册案例锚。

## 不在范围内（显式清单）

- 不做批量层任何改动（已可用）。
- 不做 liveness 推导器注册（避免与活跃变更 2026-09-08-session-list-liveness-dot 撞代码，留后续）。
- 不做平台侧 Cursor 凭证配置（llm_provider agent_kind 扩展 + CursorCredentialInjector，留后续）。
- 不做 `--mode plan/ask`、`--worktree`、`--sandbox`、worker 等 CLI 能力映射（manualApproval/askUserOnly/mcpServers/blocks 忽略，caps 对应 false）。
- 不做群聊 GROUP_SUPPORTED_PROVIDERS / `session_crud.py` `_SessionProviderQuery` 存量白名单面扩展（pi 亦缺的存量缺口，留后续统一收口）。
- 不做旧文本协议扩展（新 provider 信息一律走 AgentEvent + metadata）。

## 成功标准（可验证）

- daemon 三件套注册完备：`INTERACTIVE_PROVIDERS` 含 cursor 且 `capsOf` 守卫过、`provider-registry.test.ts` 键集合 = `['claude','codex','cursor','pi']` 全绿。
- 三端 caps 逐键一致且守护测试 `test_provider_caps_alignment.py`（EXPECTED_PROVIDERS 已同步）全绿。
- 前端可选 Cursor 引擎建会话（两处白名单放行）；显式 `provider:"cursor"` 请求不再 422。
- 真机冒烟：一轮真实对话双轨落库（文本行 + `metadata_.agent_event`）+ SSE agent_event + usage 实时；第二轮 `--resume` 记忆连续；interrupt 后 AgentRun 终态 failed + error_code='interactive_interrupted'（规范通道）；caps false 项 UI 正确隐藏。
- 既有三 provider 零回归（相关测试全绿 + claude 会话冒烟不回归）。
- 未安装 cursor 的环境行为不变（探测 unavailable → 前端不展示）。
