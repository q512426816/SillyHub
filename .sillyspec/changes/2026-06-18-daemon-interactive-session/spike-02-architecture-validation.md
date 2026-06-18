---
author: qinyi
created_at: 2026-06-18T20:55:03
status: SDK 集成前置验证（决定 D-002@v2 vs D-002@v3，不进当前 execute 关键路径）
---

# spike-02：Claude SDK 集成验证（D-002@v3 硬门）

## 0. 定位（先读）

- **目的**：验证 `@anthropic-ai/claude-agent-sdk` 在本仓库 daemon（TypeScript / Windows）下能否落地为 `ClaudeSdkDriver`，决定 D-002@v3 是否正式取代 D-002@v2。
- **不在 execute 关键路径**：当前不阻塞；但**通过后才回 brainstorm/plan 重做 task-03/06/07/08/09**。
- **外部项目（happy）行为仅作参考，不作规范**：见 §4 元教训。
- **结论处理**：硬门通过 → D-002@v3 立项 + 重做 plan；硬门不通过 → 回 D-002@v2 直接 execute。

## 1. 背景：三份架构分析收敛（2026-06-18）

围绕"是否从 spawn+resume（D-002@v2）改为 SDK 同进程多轮（D-002@v3）"，经多轮分析收敛：

- **可行性**：Claude SDK 路线（D-002@v3）可行。
- **改造量可控**：新增 `InteractiveSessionManager` + driver 层，**与现有 `TaskRunner`（batch）并存，不替换**。现有 lease / WS / AgentRun / AgentRunLog / Redis / SSE / 权限审计全部保留。task-01/04/05/10/11 保留，task-03/06/07/08/09 按 v3 重做。
- **不 Big Bang**：先 `ClaudeSdkDriver`，`CodexAppServerDriver` 后续单独落地。
- **SDK 内部仍 spawn claude**，只是 stdin/stdout 管理权从我们的手工 readline/stdin 转移给 SDK。
- **交互语义**：SDK 路线仍为 turn 级（result 后 push 下一条）。**运行中注入在 SDK 下语义未知**，属 spike 子项，不得外推 happy 行为。
- **不照搬 happy 控制面**：Fastify / Socket.IO / E2E 加密 / machine API / daemon 生命周期 / 离线 session / TUI 均不抄，只参考执行面（driver）。

## 2. 架构边界（D-002@v3 目标态）

```
Backend（不变）: AgentSession / AgentRun / AgentRunLog / Redis / SSE / 权限审计
                         │
Daemon: TaskRunner（保留）            → batch lease + 其他 provider（现有 adapter 不动）
       InteractiveSessionManager（新增）
         ├─ ClaudeSdkDriver           → 官方 Agent SDK（本 spike 验证对象）
         └─ CodexAppServerDriver      → 参考 happy，后续独立落地
```

## 3. spike 验证项

### 硬门（不通则 SDK 路线阻塞，回 D-002@v2）

**H1. Windows 鉴权 + SDK 定位 claude**
- 做法：Windows 上 `pnpm add @anthropic-ai/claude-agent-sdk`，跑最小 `query()`，观察 SDK 用内置 claude 还是系统 `claude.CMD`，鉴权（API key / OAuth）如何传递。
- 通过标准：能在 Windows 跑通一个 query，鉴权复用现有 `~/.sillyhub/daemon/credentials.json` 体系。
- 不通过后果：SDK 路线在 Windows 部署阻塞 → 回 D-002@v2。

**H2. 同一 Query 连续两个 result（能力2 硬门）**
- 做法：`query({ prompt: AsyncIterable })`，push msg1 → 收 result → push msg2 → 收第二个 result。
- 通过标准：同一 SDK 进程内出现两个独立 result，第二轮响应含第一轮上下文（会话连续）。
- 不通过后果：同进程多轮不成立 → 回 D-002@v2。

### 设计输入（影响 task 设计，不阻塞路线）

**D1. interrupt() 后续轮**：turn1 执行中调 SDK interrupt，再 push msg2，验证能否继续下一 turn。
**D2. canUseTool 远程审批延迟**：canUseTool 回调里 await 远程决定（模拟），验证 agent 能暂停等待、不超时。
**D3. 进程崩溃后 resume**：kill 进程，新进程 `query({ resume: sessionId })`，验证恢复上下文。
**D4. 后台任务归属（SDK 特有难点）**：观察 turn `result` 之后 SDK 是否继续吐后台任务事件，明确"result 后事件归属哪个 AgentRun / 是否开新 run"。这关系到"每 turn 一个 AgentRun"的完成边界。

### 子项（运行中注入，SDK 下未知）

**S1. 运行中注入语义**：turn 执行中（未 result）向 AsyncIterable push msg2，观察 claude 反应——立即影响当前 turn / 排队到下一 turn / 拒绝。仅"成功 push"不算真注入，须观察对执行的可观察影响。
- 注：happy 未实现此能力，但"happy 没做 ≠ SDK 不支持"，需独立验证。

## 3.7 实测结果（2026-06-18 执行）

**环境**：node v24.15.0 / pnpm 9.6.0 / Windows；SDK `@anthropic-ai/claude-agent-sdk@0.3.181`（`claudeCodeVersion` 2.1.181）。**鉴权经系统 env**：`ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic`（智谱中转，模型全映射 `glm-5.2`）—— 即 daemon 真实部署环境。脚本与产物均在仓库外 `%TEMP%\claude-sdk-spike\`，**主树零改动**。

**两硬门：全过 → D-002@v3 立项。**

- **H1 ✅ 通过**：`query({ prompt: 'Reply with exactly: PONG' })` → `result/success` `"PONG"`（9.8s）。鉴权经 env 继承（未传 `options.env`，SDK spawn 的 claude 继承 `ANTHROPIC_AUTH_TOKEN`+`BASE_URL`，走中转→`model=glm-5.2[1m]`）。**SDK 默认用内置二进制**：运行中进程路径 = `…\.pnpm\@anthropic-ai+claude-agent-sdk-win32-x64@0.3.181\…\claude.exe`（224MB，平台 `optionalDependencies` 自带），**不依赖系统 claude.CMD**（`pathToClaudeCodeExecutable` 文档："Uses the built-in executable if not specified"）。→ daemon 无需预装系统 claude。
- **H2 ✅ 通过**：`query({ prompt: AsyncIterable<SDKUserMessage> })`，push msg1→result1→push msg2→result2。result1=`"OK"`@8.9s / result2=`"ZEBRA-742"`@17s（第二轮回忆第一轮密钥），**同 session_id**（`5b31bbdf-…`）。同进程多轮成立。

**设计输入：**

- **D1 ✅**：`interrupt()` 是 **turn 级**。turn1 数数中调 `q.interrupt()` → result1 `subtype=error_during_execution`（当前 turn 中断标记）；query **不结束**，msg2 续轮 → result2 `success`。含义：interrupt=终止当前 AgentRun（标 interrupted），session 仍 active，SDK 下续轮**无需重新 spawn**（优于 v2 的 per-turn spawn+resume）。
- **D2 ✅（核心）+ caveat**：`canUseTool` 回调内 `await 6000ms` 模拟远程人审，3 次调用 claude 全程等待（各 6003ms），result `success`，**无超时** → 远程审批机制成立（回调为 async，带 `AbortSignal`）。**caveat**：GLM 后端 Write 工具调用 3 次均报 permission error、文件未创建 —— GLM 中转的工具兼容性问题，**非 SDK 路线阻塞**（§4 元教训：GLM 后端 ≠ 官方 Claude）。
- **D3 ✅**：SDK **自动持久化** session 到 `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`。新 node 进程 `query({ options: { resume: sessionId } })` 恢复 H2 的 session，正确回忆 `ZEBRA-742`，session_id 匹配。→ 支撑 Wave3 崩溃 resume（D-003），daemon 只需记 session_id + 固定/还原 cwd。
- **D4 ✅**：Task（子 agent）事件 `task_started`/`task_updated`/`task_notification` **全部在 result 之前**；`events_after_result=0`。→ **result 是干净终止边界，"每 turn 一个 AgentRun"归属清晰，无孤儿后台事件**（D-002@v3 特有难点在本场景不成立）。
- **S1 ✅（语义已定）**：AsyncIterable prompt 模式下，msg2 带 `priority:'now'` 在 result1 之前 yield，**仍排队到 turn2**（result1=完整数数 1-5，result2=`"INJECTED"`）。→ **SDK 路线交互语义 = turn 级，不支持运行中注入**，与 D-002@v2/happy 一致。daemon 不应承诺运行中注入。（注：`streamInput()` 主动注入模式未单独验证；prompt 模式结论已满足 daemon 的 turn 级定位。）

**总结**：两硬门通过，**D-002@v3 正式立项（supersedes v2）**。SDK 路线在本环境（Windows + 智谱/GLM 中转）可行，交互 turn 级（不承诺运行中注入），resume / 后台归属 / interrupt 续轮 / canUseTool 远程审批均有支持。**caveat**：(a) GLM 中转的工具调用兼容性（D2 Write 失败）是真实部署风险，driver 实现需考虑工具降级/重试；(b) 本环境后端为 GLM，结论对"官方 Anthropic 后端"需另证；(c) `streamInput` 主动注入与长时间后台 bash 任务归属未单独覆盖，留待 driver 实现阶段补验。

**证据产物**：`%TEMP%\claude-sdk-spike\` 下 `h1.mjs`/`h2.mjs`/`d1.mjs`/`d2.mjs`/`d3.mjs`/`d4.mjs`/`s1.mjs`（仓库外，可复跑）。

---

## 4. 元教训（避免重蹈）

讨论过程中三次同类错误，记录以儆：

1. spike-01：把"happy 用 SDK 多轮"外推为"CLI `-p` 多轮可行" → 被证伪。
2. 把"happy 同进程多轮"描述为"运行中真注入" → 被纠正（happy 也是 turn 级）。
3. 把"happy 没做运行中注入"外推为"SDK 不支持运行中注入" → 被纠正（SDK 下未知）。

**规则**：happy 是**实现样本**，不是**能力规范**。happy 做了某事 ≠ 必然可行；happy 没做某事 ≠ 不可行。每个能力都要**独立 spike 验证**。

## 5. 与当前 plan 的关系

- spike-02 不进 execute 关键路径，不影响现有 task-01~11 蓝图的存在。
- **当前不 execute D-002@v2 的 task-03**（三份分析倾向 v3，先 spike 再定）。
- spike 结果：
  - **硬门通过** → D-002@v3 正式立项（supersedes v2），回 brainstorm 设计 driver 层 / 后台任务归属 / interrupt / resume / canUseTool 远程，重做 task-03/06/07/08/09 蓝图，重排 plan，execute（先 ClaudeSdkDriver，Codex 后续）。
  - **硬门不通过** → 回 D-002@v2 直接 execute（task-03 现有蓝图就绪），SDK 路线作未来演进。

## 6. spike 执行方式

- 建议在**新会话**执行（干净上下文 + 本文件 + decisions.md 作输入）。
- 产出：spike 结果记录（每项通过/失败 + 证据）追加到本文档 §3，并据此更新 decisions.md（D-002@v3 status: proposed → accepted/superseded）。
- 不修改主树代码（spike 产物放临时目录或 worktree）。
