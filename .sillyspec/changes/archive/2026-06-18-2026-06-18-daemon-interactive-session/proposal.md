---
author: qinyi
created_at: 2026-06-18T13:54:52
---

# Proposal — 交互式会话管控（D-002@v3 · SDK driver 层）

## 动机

当前 daemon 是**批处理执行器**：派发 lease → spawn agent → 跑完 → 结束。现有 quick-chat 的"多轮"是伪多轮（每轮新进程 + `--resume`），无法中途追问 / 实时权限往返 / 打断本轮保留会话。

**spike-02（§3.7）已验证**：`@anthropic-ai/claude-agent-sdk` 的 `query(AsyncIterable)` 可在 daemon 同进程跑多轮（H1/H2 硬门通过），鉴权经 env 继承（智谱/GLM 中转），SDK 默认用内置 claude.exe。据此立项 **D-002@v3**：新增 `InteractiveSessionManager` + `ClaudeSdkDriver`，与现有 `TaskRunner`（batch）**并存非替换**，SDK 同进程多轮取代 v2 的 per-turn spawn+resume。

## 关键问题（现有方案为什么不够）

1. **正在跑的 agent 收不到中途追问**：`task-runner.ts:721-751` 写一次 prompt 后 stdin 不再写，`result` 后 `stdin.end`。
2. **多轮是伪多轮**：quick-chat 每轮新建 AgentRun + 新进程 + `--resume`，重启开销大、状态不连续。
3. **无实时权限往返与打断语义**：`stream-json.ts:writeControlResponse` 只自动批准；cancel 即结束整个进程，无"中断本轮保留会话"。

## 变更范围（方案 A：driver 层与 TaskRunner 并存，lease.kind 分流）

- **Wave 1 核心交互**：daemon 新增 `src/interactive/`（ClaudeSdkDriver + SessionManager + input-queue，SDK `query(AsyncIterable)` 同进程多轮，`pathToClaudeCodeExecutable`=系统 claude）；`agent_sessions` 表 + `lease.kind` + `agent_runs.agent_session_id`；lease.kind 分流（batch→TaskRunner 零改动）；WS 控制消息；session 级 SSE 聚合。
- **Wave 2 权限往返**：`canUseTool` 远程人审（WS→前端 allow/deny，D-007）+ GLM 工具失败错误透传（D-008）。
- **Wave 3 resume**：SDK 自动持久化 + daemon SessionStore 元数据 + 重启 `query({resume})` 恢复 + reconnecting 状态。
- **Wave 4 前端管控台**：runtimes 页 quick-chat 升级会话面板（输入/打断/结束/审批弹窗/历史回看）。

## 不在范围内（显式清单）

- ❌ happy 式 E2E 加密中转 / 控制面（Fastify/Socket.IO/TUI/machine API/离线 session）
- ❌ 替换 TaskRunner（batch 路径不动）
- ❌ 预禁工具 / per-provider 工具黑白名单（D-008 错误透传）
- ❌ 带 SDK 平台二进制包 224MB（D-009 用系统 claude.CMD）
- ❌ 运行中注入（spike S1，turn 级）
- ❌ 多 agent 铺通（聚焦 claude；codex 后续 CodexAppServerDriver 单独）
- ❌ 改批处理 lease 模型
- ❌ Wave 1/2 崩溃恢复（崩溃=failed），resume 放 Wave 3

## 成功标准（可验证）

1. **[兼容] 旧配置默认行为不变**：`lease.kind` 默认 batch，现有批处理 lease 与 quick-chat resume 路径零变化。
2. **[Wave1-核心] SDK 同进程多轮**：首 turn result 后追问创建新 AgentRun，第二轮含首轮上下文、同 `agent_session_id`（spike H2 复现）。
3. **[Wave1-interrupt] 分离生效**：`interrupt()`=当前 run failed、session active 可续轮；end=kill + status=ended。
4. **[Wave1-SSE] 跨 turn SSE 连续**：一个 SSE 连接贯穿整个会话，多 turn 实时回显、历史可回看。
5. **[Wave1-exe] 系统 claude 跑通**：ClaudeSdkDriver 用 `pathToClaudeCodeExecutable`=系统 claude.CMD 跑通（R-exe 补验，task-03 前置）。
6. **[Wave2-审批] canUseTool 远程人审**：前端 allow/deny 后 driver 继续/中止；5min 超时 deny。
7. **[Wave2-GLM] 错误透传**：GLM 工具失败不阻断 session。
8. **[Wave3-resume] daemon 重启恢复**：active 会话 reconnecting → 恢复，上下文不丢（spike D3）。

详细设计与验收见 `design.md`，决策台账见 `decisions.md`，spike 证据见 `spike-02-architecture-validation.md` §3.7。
