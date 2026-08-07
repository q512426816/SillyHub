# spike-B 报告 — read_only worker `--allowedTools` 传递链端到端实测

> 变更：`2026-08-06-public-mcp-server` / task-07（spike-B）
> 验证目标（plan.md）：read_only worker 的 `--allowedTools` 传递链是否真通
> （CC-03 / R-09：`stream-json.ts:333` 已消费 vs `execution.py:14-23` docstring
> "不强制" vs `tool_config` 二义）。通过标准：派一个 read_only worker，实测其
> 只能用 Read/Glob/Grep，写工具被拒。
> **结论：PASS（链路已通，无须补通）。** 唯一债是 `execution.py:14-23` docstring
> 过时（task-08 修）。

## 验证方式

子代理连续 429 失败，本 spike 由主 agent 以**静态代码追踪**完成（不起 daemon
实跑——实跑需真实 claude CLI + 在线 daemon，环境成本高；链路每一环均为
无分支直传，静态追码即可确证）。

## 传递链逐环证据（backend → daemon → claude CLI）

| 环 | 位置 | 行为 | 状态 |
|---|---|---|---|
| 1. 产出 | `backend/app/modules/agent/execution.py:75-94` `worker_tool_config(read_only)` | `read_only=True` → `{mode:'plan', allowed_tools:['Read','Glob','Grep'], max_turns:25}` | ✅ 已存在 |
| 2. 派发传入 | `execution.py:242` | `dispatch_to_daemon(..., tool_config=worker_tool_config(read_only))` | ✅ 已存在 |
| 3. 写进 lease | `backend/app/modules/agent/placement.py:407-408` | `metadata["tool_config"] = tool_config` | ✅ 已存在 |
| 4. daemon 读 lease | `sillyhub-daemon/src/daemon.ts:3641` | `toolConfig: execCtx?.tool_config ?? execPayload.toolConfig`（fetch metadata 优先） | ✅ 已存在 |
| 5. daemon 拼 CLI 参数 | `sillyhub-daemon/src/adapters/stream-json.ts:333-335` | `tc.allowed_tools` → `--allowedTools Read,Glob,Grep`；`:322` `tc.mode` → `--permission-mode plan` | ✅ 已存在 |

## 关键发现（推翻 design/plan 的旧担忧）

1. **链路完整，无断点**：5 环全通，read_only worker 实际被 claude CLI 限成
   `--permission-mode plan --allowedTools Read,Glob,Grep`，写工具（Edit/Write/Bash）
   不在白名单内被物理拒绝。CC-03/R-09 担心的"传递链没接通"不成立。

2. **`tool_config` 二义已澄清**：design 曾担心 `tool_config` key 有 `tool_governance`
   vs `credential_config` 二义。实查：`metadata.tool_config` 是 **tool 治理**（白名单/
   mode/max_turns），与 credential（`daemon.ts:3044` 的 `provider_config` 第 0 层
   ANTHROPIC token 渲染）是**两个独立 key**，无二义。无须拆 key。

3. **唯一债是过时 docstring**：`execution.py:14-23` NOTE 仍写"tool_config is
   passed ... 不强制"，与现状（已全链强制）矛盾。这是文档债，不是功能缺口。

## 对 Wave 3 范围的影响

- **task-08**：范围收敛为"仅修 `execution.py:14-23` docstring 反映现状"，
  无须补通传递链、无须拆 `tool_config` 二义 key。
- **task-09**（已完成）：dispatch 落 `AgentRun.read_only` 列，与传递链正交。
- **无 Wave 3 范围扩大**：spike 不通过的后备分支（补通 backend→daemon 链 +
  拆 tool_config 二义）**不触发**。

## 风险残留

- 静态追踪未实跑真实 claude CLI。verify 阶段端到端验收（plan.md 全局标准：
  "read_only worker 实测被限成 Read/Glob/Grep"）时派一个真实 read_only worker
  复核，作为最终确认。
