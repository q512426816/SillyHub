# E2E Steering 集成验证证据 — 2026-09-18-single-chat-steering

- 执行时间：2026-09-18 19:08 – 19:25 UTC（本地 2026-09-19 03:08 – 03:25）
- 执行方式：真实 daemon↔backend 端到端（worktree 栈，独立 DB/Redis，未触碰生产容器）
- 验证角色：集成验证（verify 阶段，未改任何代码）

## 1. 环境

| 项 | 值 |
|---|---|
| worktree | `C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\worktrees\2026-09-18-single-chat-steering` |
| 分支 / commit | `sillyspec/2026-09-18-single-chat-steering` / `87df29c95e20a9d7ad2ae20745140807925da3fd`（9 commit，task-01…task-10） |
| backend | worktree backend，uvicorn 127.0.0.1:**8002**（主仓 .venv python + PYTHONPATH 指向 worktree/backend，规避 editable install 回主仓坑），`/api/health` 返回 `commit_sha=87df29c95e20` 证实跑的是 worktree 代码 |
| DB | 独立库 `platform_e2e_steering`（生产 postgres 容器内 createdb，alembic upgrade head 全量迁移） |
| Redis | 独立容器 `e2e-steering-redis`（宿主 6380→6379） |
| daemon | worktree `pnpm build`（tsc → dist/），`SILLYHUB_DAEMON_DIR=%TEMP%\e2e-steering\daemon-state`，`node dist/cli.js start --server http://127.0.0.1:8002 --api-key shk_live_HrM…`，日志 `%TEMP%\e2e-steering\daemon.log` + `daemon-state\daemon.log` |
| 注册 runtime | 7 个全部 online：claude `685b06dc`、codex `5ec2e63e`、cursor `093d374b`（+pi/opencode/openclaw/kimi） |
| LLM 凭证 | bigmodel anthropic 兼容代理（glm-5.2，deploy/.env）→ backend LLM provider `499d8bc4`；codex 用本机 `~/.codex` 凭证（daemon 文件层注入）；cursor 用本机 cursor CLI |
| bootstrap API | admin 登录（username=admin）→ POST /api/auth/api-keys 拿 shk_live key → POST /api/llm-providers（bigmodel-e2e）→ workspace `ed894e95` + agent profiles：e2e-claude `a40cf48f`（挂 provider+glm-5.2）、e2e-codex `84c4c7b2` |

## 2. claude 会话 e2e（主验证）— PASS（纯生成形态：轮边界吸收 + 次轮自动执行）

会话 `b61f58a9-5840-40e7-b0e8-6511a82e70c4`，run `3093df59-0154-440a-ba73-0170e2889296`。

时间线（UTC）：
1. 19:17:02 POST /api/daemon/sessions（prompt：从 1 慢慢数到 300 中文大写，不用工具）
2. 19:17:03（run running 后 1.29s）POST /api/daemon/sessions/{id}/inject（"STOP-COUNTING-NOW-42：停止数数，只回复 STEERED-OK-42"）

第二次 inject 的 HTTP 响应原文（本变更新契约）：

```json
{"session_id":"b61f58a9-5840-40e7-b0e8-6511a82e70c4","run_id":"3093df59-0154-440a-ba73-0170e2889296","status":"running","queued":false,"queue_entry_id":null,"steered":true}
```

- `steered=true`、`queued=false`、`run_id` = 活跃 run（未新建 run）✔
- backend 日志：`control_command_enqueued kind=session_inject`（19:17:03.613，command `c34333e9`）+ daemon ACK（POST /controls/ack 200）→ mid-turn 注入指令真实送达 ✔
- 留痕：user_input 行 19:17:03 挂同一活跃 run 3093df59 ✔
- **无 interrupt**：backend 全程 0 条 `session_interrupt` 控制；run 以 `interactive_run_closed status=completed sdk_status=success is_error=false api_requests=1` 收敛；SSE 监听（/api/daemon/sessions/events）0 个 interrupt 事件 ✔

实际形态（记录）：**纯生成形态**。引导消息被 Claude SDK 命令队列在轮边界吸收（19:17:03 推入 → 19:17:58 首轮数数完成后吸收），次轮自动执行——引擎 transcript（`daemon-state\claude-config\projects\C--Users-qinyi-sillyhub-workspaces\f57eb063-991b-4dbc-90c2-e13099651499.jsonl`）原文：

```
USER  2026-09-18T19:17:03  【当前用户信息】…（含数数任务首句）
ASST  2026-09-18T19:17:58  好的，从 1 数到 300，格式为「N: N的中文大写」：…（数完 300）
USER  2026-09-18T19:17:58  STOP-COUNTING-NOW-42：停止数数，只回复 STEERED-OK-42
ASST  2026-09-18T19:18:08  STEERED-OK-42
```

→ 最终输出包含 marker **STEERED-OK-42**（次轮自动执行形态，验收规则两形态之一）✔

**如实记录的观察项（非本场景 FAIL 项，按验收规则仍 PASS）**：平台 run 在首轮 result（19:17:58.606 `interactive_run_closed api_requests=1`）即收敛，次轮（19:17:58→19:18:08）在 SDK query 内自动执行，其 `STEERED-OK-42` 输出**未回传落库**到 backend 会话日志（GET /sessions/{id}/logs 仅 6 条，止于首轮）。即引擎侧生效但平台侧 UI 日志看不到次轮输出——与 task-04 spike「纯生成=轮边界双形态」结论一致，属 NG-1/R-04 记录的引擎原生行为边界，建议后续变更跟进（对齐 codex 形态的留痕体验）。

## 3. codex 会话 e2e（驱动新代码 turn/steer）— PASS（同 turn mid-turn fold，平台日志可见）

会话 `7723abf7-71eb-4ce6-a82e-6ea1fb155633`，run `9038f911-d71f-4843-b3d5-dd262817f0ec`。

1. 19:21:46 建会话（同款数数任务，provider=codex，本机 ~/.codex 凭证）
2. 19:21:47（run running 后 1.29s）inject 引导消息，响应原文：

```json
{"session_id":"7723abf7-71eb-4ce6-a82e-6ea1fb155633","run_id":"9038f911-d71f-4843-b3d5-dd262817f0ec","status":"running","queued":false,"queue_entry_id":null,"steered":true}
```

时间线（backend 会话日志实测）：
- 19:21:46 user_input 数数任务；19:21:47 user_input 引导消息（挂同一 run）
- 19:21:47→19:22:15 assistant 流式数数 1→300（turn 继续未中断）
- 19:22:21 `stdout [ASSISTANT] STEERED-OK-42` ← **marker 落在平台会话日志内**
- 19:22:21.779 `interactive_run_closed status=completed sdk_status=success api_requests=2`

关键证据：`api_requests=2` 且全程 `agent_run_status=running`（19:22:15 数数输出结束后至 19:22:21.730 marker 上报期间 run 未收敛）——两次模型调用发生在**同一引擎 turn** 内，即 turn/steer 注入被引擎受理后在下一模型调用边界 fold 进同 turn（codex-app-server-driver.ts task-03 新分支：`_writeTurnSteer` 成功路径静默无日志，此为行为学证明；若走了 heldTurns 轮边界回落，首轮 turn/completed 会在 19:22:15 以 api_requests=1 收敛 run，marker 不可能挂在 run 9038f911 名下）。daemon.log 中无 steer 被拒/回落痕迹（无 error/warn）。✔ 无 interrupt（backend 0 条 session_interrupt 控制）✔

## 4. 降级对照 cursor（caps steering=false）— PASS（忙轮排队降级，行为与现状一致）

会话 `57fdf5b8-8580-4c25-bf23-3b002fb3f90a`（runtime_id=cursor runtime 创建，cursor CLI 本机可用，会话真实运行）。

忙轮（run `19dadc86` running 中）inject 响应原文：

```json
{"session_id":"57fdf5b8-8580-4c25-bf23-3b002fb3f90a","run_id":null,"status":"queued","queued":true,"queue_entry_id":"5362346f-e1ff-4b8b-8050-3508ca08b803","steered":false}
```

- `queued=true`、`steered=false`、`run_id=null`、`queue_entry_id` 非空 → 走既有排队路径，不报错 ✔
- 首轮 19:24:18–19:24:28 完成后，排队条目自动派发为次轮 run `645ae96d`（19:24:35–19:24:41），队列清空，次轮输出 `STEERED-OK-42`（19:24:41）✔

## 5. 结论

| 场景 | 结果 | 关键证据 |
|---|---|---|
| claude 单聊忙轮 steering | **PASS**（纯生成形态：次轮自动执行） | inject 响应 `steered=true,queued=false`；引擎 transcript ASST `STEERED-OK-42`（19:18:08）；无 interrupt；留痕挂活跃 run |
| codex 单聊忙轮 steering（新 turn/steer 代码） | **PASS**（同 turn mid-turn fold） | inject 响应 `steered=true,queued=false`；`api_requests=2` 单 turn 双模型调用；marker 在平台会话日志（19:22:21）；无 interrupt |
| cursor 降级对照 | **PASS** | 忙轮 inject `queued=true,steered=false` + queue_entry_id；终态后自动派发次轮执行出 marker |

零 interrupt 佐证（全栈）：backend.log 全程控制指令仅 7 条 `session_inject`（3 会话各含首句 + claude/codex/cursor 引导各 1 + cursor 次轮派发 1），`session_interrupt` 计数 **0**；三个 run 均以 `completed/success` 收敛。

观察项（供后续变更参考，不阻塞本变更验收）：
1. claude 纯生成形态下，次轮自动执行的输出不回传平台会话日志（run 已在首轮 result 收敛）——引擎原生行为边界（NG-1/R-04 已备案），但与 codex 形态的平台可见性不一致，用户体验有差。
2. daemon `cli.js start` 不读 config.json 的 server_url/api_key（需命令行显式传参）；config.json 中的值不生效——与既有 ~/.sillyhub 配置文件并存逻辑有关，非本变更引入。

## 6. 清理记录

- backend（uvicorn :8002）与 daemon 进程已停止（cli stop + 进程确认）
- 容器 `e2e-steering-redis` 已 docker rm（删除）
- 数据库 `platform_e2e_steering` 已 dropdb（删除）
- 生产栈（8001/5432/3001）全程未动；本机 ~/.codex、cursor CLI 只读使用
