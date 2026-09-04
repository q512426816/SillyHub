---
author: qinyi
created_at: 2026-09-04 14:00:38
---

# 真实 PI 会话全链路冒烟结果（task-07 / FR-05）

> 环境：本机 docker compose 本地栈（backend 8001，镜像 e03e30823 基线——含
> agent-provider-abstraction 的 `_persist_agent_event`，但**不含本变更的 pi 白名单**，
> 见发现 F-1）；daemon 用 worktree 构建实跑（`.sillyspec/.runtime/worktrees/
> 2026-09-04-provider-pi-onboarding/sillyhub-daemon`，`pnpm run build` + `pnpm run
> bundle` 产出，build-id 0f190fa4-20260904131459）。pi 0.81.1（~/.pi/agent/models.json
> 配 Zhipu GLM-5.3），pi runtime `4b8f3ced-77ce-4404-ac4d-f6a7c520b8fa` online。
> 工作区 b97f8231-9404-43bd-89de-38c281c4d875；admin JWT（sub=43f2e40a…，2h）。
> 冒烟后已恢复正式 daemon（~/.sillyhub/daemon/bin，pid 83268——正式 bundle 出自
> main 无 pi driver，部署属 verify 后动作）。
>
> 对照 claude 冒烟 9 项 + PI 适配（thinking / subagent）。payload 形态修正：任务卡
> 写的 `{prompt, provider:'pi', runtime_id}` 会 422（F-1），实际用 runtime_id 单入
> （provider 由 runtime 记录解析落 `agent_sessions.provider='pi'`）。

## 结果总览

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| 1 | 创建 pi 会话 + 首 turn（Bash 真执行） | ✅ PASS | session `29711587-a67e-49f0-a04b-135391e2c754`，run `a0593330-d9de-499d-8cf3-44ff5dd13817`：completed / exit 0（05:19:41→05:19:58）；`[TOOL_USE] bash: echo pi-smoke-e2e` → `[TOOL_RESULT] pi-smoke-e2e`（真实 Bash 输出）；`agent_sessions.agent_session_id=01a06adb-bf3f-76d4-ab2b-efd2f1a16d71`（pi sessionId，get_state 握手合成 session_started → backend pin，符合设计 B-03） |
| 2 | 双轨落库（agent_run_logs） | ✅ PASS | run a0593330：44 行 / 43 行带 `metadata.agent_event`（唯一无事件行=user_input）。事件分布：text 39 / tool_use 2（stdout `[TOOL_USE]` + tool_call 通道行带 tool_kind=bash）/ tool_result 1 / thinking 1。前缀 `[ASSISTANT]`/`[TOOL_USE]`/`[TOOL_RESULT]`/`[THINKING]` 全部由 backend `_persist_agent_event` 合成正常（旧 backend 镜像验证了 pi 事件走同一管线的承诺） |
| 3 | partial 流式（SSE text 实时） | ✅ PASS | turn 2（run `849eef18`）期间订阅 SSE 实收：36 条 log 事件窗 05:22:11.96→05:22:21.66，text delta 逐条增量（"命令"/"已"/"执行"/"，"…各自独立 log 行带 `agent_event:{type:text,seq}`）；pi text_delta 直通（无 is_partial，逐 delta 完整事件——设计 §5.2 口径实证）。注：该流连接时不回放历史，只推实时 |
| 4 | usage 实时（SSE tokens） | ✅ PASS | 同窗 34 条 `event:"tokens"` 与 log 逐行交错（同 timestamp 成对）；中途值恒 66/58/2496（携带前值），turn_end 快照落地后末条更新为 72/58/2560，与 run 终值 input=72 一致。pi usage 在 turn_end 定格是协议行为（pi-events.ts 头注释），"实时"表现为每行落库伴随 tokens 事件 + turn_end 即时刷新 |
| 5 | inject 追加（输入队列） | ✅ PASS | POST `/sessions/{id}/inject` prompt2 → run `849eef18-2170-4f09-b7d7-1dcbbad15887` completed / exit 0；`[TOOL_RESULT] pi-smoke-turn2-inject`（第二轮真实 Bash 输出） |
| 6 | interrupt（进行中 turn 终止） | ✅ PASS | 长 prompt（1 数到 50 慢慢输出）→ run `10a690fa-edb2-402b-bed5-6f9afbb48e1c` 流式中断在 9/50（最后一条为截断的 `[THINKING]` 半句，05:24:12.85 即 interrupt 落点）；interrupt 响应 session 仍 active；run 终态 completed / exit 0 / usage 0/0（abort → agent_settled → _onResult 正常收敛，语义见发现 F-3） |
| 7 | resume（daemon 重启恢复） | ✅ PASS（带发现 F-2） | 重启后 GET 会话 active、agent_session_id 保持。**首次 inject 失败**：run `aabaf89d` parked 等待 60s 超时 failed（sessions.json 载入白名单丢 pi 记录，daemon 本地恢复缺失，见 F-2）。**二次重启收敛**：backend auto-recover sweep（suspended→reconnecting）推 `daemon:session_resume` → daemon `session_resume_ok` ×2（05:37:38，两 pi 会话）→ inject run `cd34f961-59f5-414f-96a9-b66df03d2c72` completed / exit 0，**记忆连续性实证**：模型答出首轮 echo 输出 "pi-smoke-e2e" 并执行 `[TOOL_RESULT] pi-smoke-resume-ok`（--session 01a06adb… resume 生效） |
| 8 | thinking 落库 | ✅ PASS | run a0593330 `[THINKING] The user wants me to execute a simple smoke…`（ev_type=thinking 1 行）；interrupt 轮亦有 thinking 半句行；SSE 实时窗内 thinking 事件 2 条（pi thinking 内容块归一化正常） |
| 9 | claude 零回归 | ✅ PASS | session `ed480a6d-2622-4704-9ac9-c0a0711b6532`，run `bc92f284-d6b1-4a68-a179-8df81de67a15` completed / exit 0；`[TOOL_USE] Bash: echo claude-regression-ok` + tool_call 通道行 + `[TOOL_RESULT] claude-regression-ok`；usage 62218/421 正常。同栈（worktree daemon + pi 注册表扩展）下 claude 双轨/工具执行零回归 |
| 10 | subagent 复核（task-06 结论锚） | ✅ PASS | session `feca66ea-7631-47c2-b969-6d0af9792e34` 三轮：① 无 agent 定义：`[TOOL_USE] subagent:{"agent":"scout",…}` → `[TOOL_RESULT] Agent failed: Unknown agent: "scout". Available agents: none.`（~/.pi/agent/agents/ 无定义——task-06 预判锚原样复现；vendored 扩展装载成功，工具在）；② 临时放 vendored scout.md（改 model 为 cc-switch-zhipu-glm/glm-5.3）→ 子代理真实 spawn 执行 Bash，`[TOOL_RESULT]` 聚合汇报含 `pi-smoke-subagent-probe` 原样输出；③ 事件流中子代理输出**只以聚合 tool_result 呈现、无 per-child 事件**（task-06 实证复核一致）。临时 agent 已清理。caps.subagent=false 口径维持正确 |

**守护测试**：`pnpm exec vitest run tests/interactive/`（worktree sillyhub-daemon）→
**54 文件 / 770 用例全绿**。

## 发现的问题（按约束回报不私修，回实现任务修）

- **F-1（P1，backend）**：`backend/app/modules/daemon/schema.py:106`
  `InteractiveProviderLiteral = Literal["claude", "codex"]` —— POST /api/daemon/sessions
  显式带 `provider:'pi'` → 422 `literal_error`。runtime_id 双入口可绕过（provider 由
  runtime 解析），但任何显式传 provider 的客户端路径被拒；与 design §5.4 已抓的
  前端两处白名单同类——**backend DTO Literal 是第三处引擎白名单盲区**，本变更
  文件清单未覆盖。修复落点：该 Literal 加 'pi'（或改为查 provider_caps/注册表派生）。
- **F-2（P1，daemon）**：`sillyhub-daemon/src/interactive/session-store-persistence.ts:83`
  `VALID_PROVIDERS = new Set(['claude', 'codex'])` —— sessions.json **载入**时 pi 记录
  被静默丢弃（"单条 schema 非法 → 丢弃"路径）。实测：daemon 停机前 pi 会话正常
  落盘（snapshotPersistable 含 agentSessionId/status active，文件实见 19 条含 2 条
  pi），重启后 `session_recover_start count` 少 1（pi 行被 load 过滤）→ daemon 本地
  恢复缺失 → 重启后立即 inject 会 parked 60s 超时失败（run aabaf89d failed 实证）。
  兜底收敛存在（backend auto-recover sweep → SESSION_RESUME，实测 ~1-2min 内
  `session_resume_ok`），但恢复延迟且首轮 inject 必死。修复落点：VALID_PROVIDERS
  加 'pi'（或由 INTERACTIVE_PROVIDERS 键集派生，杜绝第四处白名单）。
- **F-3（P3，观察）**：interrupted turn 的 run 终态记录为 completed / exit 0 /
  usage 0/0，DB 侧与正常完成轮无区分标记（daemon 侧 rpc abort → agent_settled →
  _onResult 正常上报所致，符合 session-manager"终态由 _onResult 按 SDK 实际 result
  收尾"的既有语义）。是否需要 cancelled 终态标记属产品决策，仅记录。
- **F-4（P3，观察）**：轮中途 SSE tokens 事件携带的 usage 是上一快照值（pi 协议
  turn_end 才报 usage，设计 §5.2 已口径化）；前端如需中途递增观感需后续在 daemon
  侧做插值，本期不改。
- **环境噪音（非本变更）**：① 冒烟中本地栈 backend 容器被外部重建两次（05:42:53
  一次致 claude 首次 create 空响应重试），与 pi 改动无关；② worktree daemon 曾被
  daemon 自更新机制 respawn 到正式 bundle（backend 重建后 manifest 更新触发，
  `daemon_self_update_respawn`）——后续验证用 `SKIP_DAEMON_SELF_UPDATE=1` 规避
  （preflight.ts:318 既有运维开关），此为测试手法记录非缺陷。

## 结论

10 项全 PASS（无豁免项；审批卡类 PI 本就 caps=false 不在清单）。核心链路（rpc 长驻
driver → AgentEvent 归一化 → kind:agent_event 双轨落库 → SSE 结构化 → inject/interrupt/
resume 控制）在真实 pi 0.81.1 + GLM-5.3 上全链路实证，claude 同栈零回归，770 用例
守护全绿。两处 P1 白名单盲区（F-1 backend DTO Literal / F-2 daemon persistence
载入白名单）不阻塞功能主路径（runtime_id 入口可建会话；backend sweep 兜底恢复），
但属"新增 provider 零改 backend/daemon 承诺"的实质破口，建议回 task-02/03 落修后
并入本变更换集。subagent 复核维持 task-06 结论：扩展可装载、子代理真实运行、事件
聚合无归属 → caps.subagent=false。
