---
author: qinyi
created_at: 2026-06-14T01:56:05+0800
id: task-23
title: 真实 backend 冒烟（task_available→claim→start→messages→complete+patch）
priority: P0
estimated_hours: 2
depends_on: [task-21, task-22]
blocks: [task-24, task-25]
wave: W5
allowed_paths:
  - sillyhub-daemon/scripts/smoke-lease.*
  - .sillyspec/changes/2026-06-13-daemon-nodejs-rewrite/SMOKE.md
---

# task-23: 真实 backend 冒烟（task_available→claim→start→messages→complete+patch）

> 变更：`2026-06-13-daemon-nodejs-rewrite` · Wave W5（CLI + 冒烟 + 收尾）· T-W5-03。
> 性质：**端到端冒烟验收任务**，不是写 daemon 主源码的任务。
> 承接风险：**R-02（WS/REST 契约漂移）P0 的最终验证**——前面 task-03/17/18/20 的契约单测都是 mock，本任务是第一次把 Node daemon 对着真实 backend 跑通完整 lease，是 design.md G-02「契约不变」与 R-02「真实冒烟走通完整 lease」的落锤动作。
> 时机铁律：本任务**是 task-24（删 Python 源码）的前置门槛**——冒烟未全绿禁止进 task-24；design.md §9 兼容策略：「仅在 W5 真实冒烟通过后才删除」。
> daemon 主源码状态：task-01..task-20 已实现（tsc 零错误）、CLI 在 task-21、单测在 task-22（16 文件 ~326 用例全绿）。本任务不写源码，只跑真实链路 + 记录证据。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 新增（可选） | `sillyhub-daemon/scripts/smoke-lease.sh` 或 `sillyhub-daemon/scripts/smoke-lease.mjs` | 半自动化冒烟脚本：启 backend → 启 daemon → 触发 task → 抓日志 → 断言关键词。execute 子代理可选用纯手动，脚本只是辅助。**不修改 daemon 主源码** |
| 新增 | `.sillyspec/changes/2026-06-13-daemon-nodejs-rewrite/SMOKE.md` | 验收记录：每步观测点截图/日志摘录 + AC 表逐项勾选 + 通过结论。这是 task-24 解锁的唯一证据文件 |

> 严禁修改 `sillyhub-daemon/src/**`（daemon 主源码）。若冒烟发现 bug，记录到 SMOKE.md，回退到对应 task-NN 修复，不在本任务改源码（非目标 NG-1）。

## 前置条件

执行冒烟前必须全部满足（任一缺失中止本任务，等对应 task 补齐）：

| 前置 | 证据 | 来源 |
|---|---|---|
| P1 | task-01..task-20 源码已实现，`cd sillyhub-daemon && pnpm tsc --noEmit` 零错误 | design G-04 增量可交付 |
| P2 | task-21 CLI 可用：`sillyhub-daemon start --server <url> --token <tok>` 能启动 daemon | task-21 蓝图 AC |
| P3 | task-22 单测全绿：`pnpm test` 16 文件 ~326 用例通过 | task-22 蓝图 AC-03 |
| P4 | 一个真实运行的 SillyHub backend（FastAPI 后端 + 前端，端口对齐 local.yaml，默认 backend `:8001`、前端 `:3001`） | `.sillyspec/.runtime/local.yaml` |
| P5 | 一个可用的 agent runtime（推荐 claude code CLI，且 `~/.sillyhub/daemon/credentials.json` 已配置 `{{USER_GITHUB_TOKEN}}` 等占位符的真实值） | task-13 credential 契约 |
| P6 | git workspace mirror 目录可写（`~/.sillyhub/daemon/workspaces/` 或 config 里 `workspace_dir` 指向的路径） | task-15 workspace 契约 |

## 实现要求

### R1. 冒烟目标链路（必须逐项可观测，缺一不可）

一次完整的 lease 生命周期，七环节：

1. **register**：daemon 启动 → 向 backend `/api/daemon/register` 注册 runtime，backend 返回 `runtime_id`，daemon 日志出现 `[daemon.registered] runtime_id=<id>`。
2. **task_available**：在前端/后台创建一个 task，backend 通过 WS（或 HTTP 轮询兜底）下发 `daemon:task_available`，daemon 日志出现 `[daemon.task_available] lease_id=<id>`。
3. **claim**：daemon 调 `/api/daemon/leases/{id}/claim` 拿到 `claim_token`，backend 侧 task 状态从 pending → running，daemon 日志出现 `[daemon.lease_claim_failed]` 不出现（即成功）+ claim_token 非空。
4. **start**：daemon 调 `/api/daemon/leases/{id}/start`，backend 侧 task 标记已开始。
5. **agent spawn**：TaskRunner 按 provider（stream_json 协议，推荐 claude）spawn agent 子进程，stdin 自动批准（onControl），子进程开始产出 stdout。
6. **messages 流转**：adapter 逐行 parse 子进程 stdout → `AgentEvent` → `submitMessages` 回 backend，前端能看到流式输出（至少出现一条 assistant text message）。
7. **complete + patch**：agent 退出 → TaskRunner 收集 `git diff` → daemon 调 `/api/daemon/leases/{id}/complete` 提交 patch，backend 记录 task=completed + diff 非空（至少一处文件改动）。

### R2. 必须覆盖至少一个 stream_json 协议 provider

task-06 的 stream_json adapter 是 W1 最复杂、R-03（stdin 自动批准 hang）风险最高的协议。冒烟**至少**跑通 claude / gemini / cursor 之一（推荐 claude，因 credentials 最常见）。其余协议（json_rpc/jsonl/ndjson/text）由 task-22 单测覆盖契约，不在本冒烟强制范围。

### R3. backend 地址取自 local.yaml，不硬编码

- daemon `--server` 参数读 `.sillyspec/.runtime/local.yaml` 的 backend url（实测默认 `http://localhost:8001`）。
- daemon `--token` 读 local.yaml 或本地 config 的 token。
- **禁止**在脚本里硬编码 `http://localhost:8000`（task-24 实测 local.yaml 无 daemon/python 引用，端口以实际启动的 backend 为准）。

### R4. 证据落 SMOKE.md（task-24 解锁的唯一依据）

SMOKE.md 必须包含：

- 冒烟时间、操作人、backend 版本（git commit）、daemon 版本（`sillyhub-daemon --version` 或 package.json version）。
- 七环节逐项的**日志摘录**（daemon stdout 的 `[daemon.xxx]` 关键行）+ **backend API 响应**（`/api/daemon/leases/{id}` 返回的 status 字段流转截图或 curl 输出）。
- AC-01..AC-07 表逐项 ✓/✗，任一 ✗ 则整体失败，不进 task-24。
- 若中途失败，记录失败环节 + 错误堆栈 + 初步归因（归到哪个 task-NN），Python 版保持原样可作回退。

## 冒烟流程（分步骤 + 观测点 + 通过标准）

### 步骤 0：环境准备（5 min）

| 操作 | 命令 |
|---|---|
| 确认 Node 版本 ≥ 20 | `node --version` |
| 确认 daemon 构建 | `cd sillyhub-daemon && pnpm tsc --noEmit && echo OK` |
| 确认单测基线 | `cd sillyhub-daemon && pnpm test 2>&1 \| tail -3` |
| 启动 backend（前端 + 后端） | 按 local.yaml 指示，通常 `cd backend && uv run uvicorn app.main:app --port 8001` + `cd frontend && pnpm dev` |
| 确认 backend 健康 | `curl http://localhost:8001/api/health`（或实际端口）返回 200 |
| 确认 agent CLI 可用 | `which claude && claude --version`（或 gemini/cursor） |
| 确认 credentials | `cat ~/.sillyhub/daemon/credentials.json \| jq keys`（含 `{{USER_GITHUB_TOKEN}}` 渲染后的真实值） |

**通过标准**：六项全部 ✓。任一失败先修环境，不进步骤 1。

### 步骤 1：启动 daemon + register（AC-01）

| 操作 | `cd sillyhub-daemon && pnpm start -- --server http://localhost:8001 --token <tok>`（或 `npx tsx src/cli.ts start ...`） |
|---|---|
| 观测点 1（daemon 日志） | 出现 `[daemon.starting]` → `[daemon.agents_detected] agents=[claude,...]` → `[daemon.registered] provider=claude runtime_id=<srv-rid>` |
| 观测点 2（backend） | `curl http://localhost:8001/api/daemon/runtimes` 能看到刚注册的 runtime（provider=claude，status=online） |
| 通过标准 | daemon 日志有 registered + 非空 runtime_id；backend runtimes 列表含该 runtime；无 `[daemon.register_failed]` |

### 步骤 2：触发 task_available（AC-02）

| 操作 | 在前端 UI 创建一个 task（选 provider=claude，填一个会改文件的 prompt，如「在 README.md 末尾加一行 `smoke-ok`」），或通过 backend API POST 创建 |
|---|---|
| 观测点 1（daemon 日志） | 出现 `[daemon.task_available] lease_id=<id>` |
| 观测点 2（backend） | task 状态 = pending（等待 daemon claim） |
| 通过标准 | daemon 在 5s 内收到 task_available（WS 正常）；若 WS 未通，poll loop 每 `poll_interval` 秒也能 getPendingLeases 拿到（HTTP 轮询兜底） |

### 步骤 3：claim（AC-03）

| 操作 | （自动）daemon 收到 task_available 后调 claimLease |
|---|---|
| 观测点 1（daemon 日志） | 无 `[daemon.lease_claim_failed]`；claim_token 内部传递（日志可能不打印 token，但后续 startLease 调用说明拿到了） |
| 观测点 2（backend） | task 状态 pending → running；`/api/daemon/leases/{id}` 返回含 `claim_token` |
| 通过标准 | task 进入 running；daemon 日志出现 `[daemon.task_completed]` 之前的 `[daemon.lease_start...]` 链路 |

### 步骤 4：agent start + spawn（AC-04）

| 操作 | （自动）TaskRunner 拿到 claim 后调 startLease，然后按 provider spawn agent 子进程 |
|---|---|
| 观测点 1（daemon 日志） | 出现 spawn 相关日志（如 `[task_runner.spawn] cmd=claude ...`，具体由 task-19 实现） |
| 观测点 2（系统） | `ps aux \| grep claude` 能看到子进程；stdin 自动批准（onControl）无 hang（R-03 验证点） |
| 通过标准 | 子进程启动且不立即退出（exit_code != 127 command not found）；stdin 不阻塞（R-03 核心）；无 `[daemon.lease_start_failed]` |

### 步骤 5：messages 流转（AC-05）

| 操作 | （自动）agent 子进程产出 stdout，adapter parse → submitMessages |
|---|---|
| 观测点 1（daemon 日志） | 出现 submitMessages 调用日志（如 `[task_runner.submit] messages=1`） |
| 观测点 2（前端） | task 详情页能看到流式 message 输出（assistant text block） |
| 观测点 3（backend） | `/api/daemon/leases/{id}/messages` 的 POST 次数 ≥ 1；DB 的 agent_run messages 表有记录 |
| 通过标准 | 前端可见至少一条 agent 产出的 message；backend 落库 messages 数 ≥ 1 |

### 步骤 6：complete + patch（AC-06）

| 操作 | （自动）agent 子进程退出 → TaskRunner collectDiff → daemon completeLease |
|---|---|
| 观测点 1（daemon 日志） | 出现 `[daemon.task_completed] lease_id=<id> success=true`；patch 字段非空（diff 含 README.md 改动） |
| 观测点 2（backend） | task 状态 running → completed；`/api/daemon/leases/{id}` 返回 result.patch 非空字符串 |
| 观测点 3（git） | workspace 目录 `git diff` 显示预期改动（README.md 末尾 `smoke-ok`） |
| 通过标准 | task=completed；patch 非空（files_changed ≥ 1）；无 `[daemon.lease_complete_failed]` |

### 步骤 7：全程无 uncaught error（AC-07）

| 操作 | `tail -100 ~/.sillyhub/daemon/daemon.log \| grep -iE "error\|stack\|throw\|uncaught"` |
|---|---|
| 观测点 | 唯一允许的「error」是单次心跳/poll 的 transient 失败后自愈（`[daemon.heartbeat_failed]` 后续恢复）；**不允许** uncaught Exception / Promise rejection / stack trace |
| 通过标准 | 无致命错误；lease 状态机正常流转（pending→running→completed），未卡死在某一态 |

## 边界处理

| # | 场景 | 处理 |
|---|---|---|
| B1 | **冒烟任一环节失败** | **禁止进 task-24 删除 Python 源码**。在 SMOKE.md 记录失败环节 + 错误 + 归因（哪个 task-NN），Python 版 `sillyhub_daemon/` 保持原样可作回退（design §9）。回到对应 task 修复后重跑本冒烟 |
| B2 | **backend 端口/地址取错** | daemon `--server` 必须读 local.yaml 的实际 backend url，**禁止**硬编码 `http://localhost:8000`。若 backend 实际跑在 `:8001`，daemon 连 `:8000` 会 register 失败（connection refused）——这是配置问题不是代码 bug |
| B3 | **agent CLI 未安装或 credentials 缺失** | 步骤 0 的 `which claude` 失败 → abort，提示安装；credentials.json 缺 `{{USER_GITHUB_TOKEN}}` → agent 子进程会报 auth 错误，daemon 日志应出现可读错误（非 hang）。核对此错误信息是否友好是 task-16/13 的验收延伸 |
| B4 | **daemon 中途崩溃 / Ctrl+C** | lease 状态应被标记 failed（backend 端 lease 有 `lease_expires_at` 超时，daemon 崩了 backend 自动重分配）。**不允许** lease 卡死在 running 永远。冒烟中故意 Ctrl+C 一次验证：重启 daemon 后同一 lease 能被重新 claim（或 backend 标记 failed 后新 lease） |
| B5 | **非阻塞：手动一次性验收** | 本任务是**手动一次性**冒烟，不需要 CI 自动化（CI 由 task-22 的 16 个单测文件覆盖契约）。脚本 `smoke-lease.*` 只是辅助，execute 子代理可纯手动跑 |
| B6 | **WS 连接失败回退 HTTP 轮询** | 若 daemon 日志出现 `[daemon.ws_connect_failed]` 且持续，验证 poll loop 是否仍能 `getPendingLeases` 拿到 task（步骤 2 的兜底路径）。WS 断线期间任务不丢是 design §9 不变项 |
| B7 | **task 一直不被 claim（daemon 看不到 task_available）** | 检查：daemon 的 runtime 是否在 backend runtimes 列表（register 是否成功）；backend 是否把 task 路由到该 runtime（provider 匹配）；WS 是否真的连上（`[daemon.ws_disconnected_reconnect]` 频繁说明 WS 没通） |
| B8 | **patch 为空（agent 没改文件）** | 若 agent prompt 让它改文件但它没改，complete 仍会调用但 patch 为空。这算 AC-06 **未通过**（要求 patch 非空）。改用更确定的 prompt（如 echo 追加）确保 agent 真改文件 |

## 非目标

| # | 非目标 | 理由 |
|---|---|---|
| NG-1 | **不改 daemon 源码** | 冒烟发现 bug 回到对应 task-NN（task-19 TaskRunner / task-20 Daemon / task-06 adapter 等）修复，本任务只跑 + 记录 |
| NG-2 | **不删 Python 源码** | 那是 task-24，本任务通过后才解锁。Python 版在冒烟期间始终保留作回退 |
| NG-3 | **不追求 CI 自动化冒烟** | 手动一次性即可。CI 由 task-22 的 vitest 单测覆盖契约，真实 backend 冒烟不适合进 CI（依赖外部 agent CLI + credentials） |
| NG-4 | **不做性能压测** | design N-06 明确不追求超越 Python 版吞吐。冒烟只验功能链路通，不测 QPS |
| NG-5 | **不覆盖全部 12 provider** | 只强制覆盖 stream_json 协议至少一个（claude/gemini/cursor）。其余 4 协议由 task-22 单测覆盖契约，真实 agent 冒烟留给后续运维 |
| NG-6 | **不写新的单测** | 本任务是端到端冒烟，单测归 task-22（已完成）。若冒烟中发现边界用例需补单测，记录到 SMOKE.md，回到 task-22 补 |
| NG-7 | **不改 backend** | design N-01 明确 backend 完全不变。若冒烟发现 backend 端点行为与 daemon 预期不符，是 daemon 适配问题，回 task-17/18 修 |

## 参考

| 来源 | 章节 | 关键内容 |
|---|---|---|
| `tasks/task-22.md` | 测试覆盖范围 | 16 文件 ~326 用例已覆盖各模块契约（mock 级）；本任务补**端到端真实链路**验证 |
| `tasks/task-17.md` | REST 端点契约 | claim/start/submitMessages/complete 的 URL/method/body 结构（snake_case 字段：`runtime_id` / `claim_token` / `agent_run_id`）；`HubHttpError` 的 status 分支（409 claim 冲突、401 token 无效） |
| `tasks/task-20.md` | lease 状态机 | `_runLeaseStateMachine` 四步：claim → start → execute → complete；`_handleWsMessage` 的 TASK_AVAILABLE 分发；inflightLeases 去重；claim_resp.payload 嵌套 vs 平铺兼容 |
| `tasks/task-06.md` | stream_json adapter | stdin 自动批准（onControl，R-03）；assistant/user/system/result/control_request 事件解析；本任务强制覆盖此协议 |
| `tasks/task-19.md` | TaskRunner 编排 | workspace → CLAUDE.md → credential → adapter → spawn → submit → diff；子进程 stdout 背压（R-04） |
| `tasks/task-21.md` | CLI | `sillyhub-daemon start --server --token`；PID 文件 + 日志路径（`~/.sillyhub/daemon/daemon.log`） |
| `tasks/task-24.md` | 删除 Python 前置门槛 | task-24 R1 明确：「task-23 真实 backend 冒烟已通过」是硬门槛，本任务的 SMOKE.md 是其解锁证据 |
| `backend/app/modules/daemon/protocol.py` | backend 对端契约 | WS 消息类型常量（`daemon:task_available` 等）+ lease 状态枚举；daemon 严格适配不改它 |
| `design.md` §10 R-02 | 风险与应对 | 「WS 消息类型/lease 状态机与 backend 对端漂移 | P0 | ... W5 真实冒烟走通完整 lease」——本任务就是这条应对的落地 |
| `design.md` §9 | 兼容策略 | 「Python 版在 W0–W4 全程保留并可运行；仅在 W5 真实冒烟通过后才删除」——本任务是这把锁的钥匙 |
| `design.md` §2 G-02 | 契约不变 | 「与 protocol.py 的 WS 消息类型、REST 端点、lease 状态机逐字对齐 | 契约单测 + 冒烟走通一次完整 lease」——本任务是 G-02 的最终验收 |

## TDD/验证步骤

> 本任务是端到端验收，不是单测驱动。流程是「**启动 → 触发 → 观察 → 记录**」四段式。

### 步骤 1：环境就绪（对应前置条件 P1-P6）

逐项确认前置条件表，任一缺失 abort。记录 backend git commit + daemon version 到 SMOKE.md 头部。

### 步骤 2：启动 backend + daemon（对应冒烟流程步骤 0-1）

启 backend → 健康检查 → 启 daemon → 观察 register。AC-01 通过才进步骤 3。

### 步骤 3：触发并观察完整 lease（对应冒烟流程步骤 2-7）

前端创建 task → 持续 tail daemon 日志 + curl backend API 观察状态流转 → agent 子进程跑完 → complete。七环节逐项打勾。

### 步骤 4：核对 backend 落库（AC-05/06 的落库证据）

- `curl http://localhost:8001/api/daemon/leases/{id}` 返回 status=completed、result.patch 非空。
- 前端 task 详情页能看到完整 message 流 + 最终 diff。
- DB（若方便查）的 lease / agent_run / message 记录数符合预期。

### 步骤 5：落 SMOKE.md + 解锁 task-24

AC-01..AC-07 全绿 → SMOKE.md 写通过结论 + 截图/日志摘录 → task-24 可执行。
任一 AC 红 → SMOKE.md 记录失败 + 归因 → 不解锁 task-24，回到对应 task 修复。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | daemon start 后查 register 结果 | backend `/api/daemon/runtimes` 含刚注册的 runtime（provider=claude，status=online）；daemon 日志出现 `[daemon.registered] provider=claude runtime_id=<非空 srv-rid>`；无 `[daemon.register_failed]` |
| AC-02 | 前端创建 task 后触发 task_available | daemon 日志在 5s 内出现 `[daemon.task_available] lease_id=<id>`（WS 正常）；或 WS 断线时 poll loop 在一个 `poll_interval` 周期内拿到（B6 兜底） |
| AC-03 | claim 成功 | daemon 无 `[daemon.lease_claim_failed]`；backend task 状态 pending → running；`/api/daemon/leases/{id}` 返回含非空 `claim_token` |
| AC-04 | agent start + spawn | `ps aux` 能看到 agent 子进程（claude/gemini/cursor）；子进程不立即退出（exit_code != 127）；stdin 自动批准无 hang（R-03 验证：子进程持续产出 stdout 不阻塞）；无 `[daemon.lease_start_failed]` |
| AC-05 | messages 流转 | agent 产出的 assistant text message 经 adapter parse 后 submitMessages 回 backend；前端 task 详情页可见流式输出；backend `/api/daemon/leases/{id}/messages` POST 次数 ≥ 1；落库 messages 数 ≥ 1 |
| AC-06 | complete + patch | agent 退出后 daemon 调 completeLease；backend task 状态 running → completed；`result.patch` 非空字符串（files_changed ≥ 1，含预期文件改动）；git workspace `git diff` 显示预期改动；无 `[daemon.lease_complete_failed]` |
| AC-07 | 全程无 uncaught error | `daemon.log` 无 stack trace / uncaught Exception / unhandled Promise rejection；lease 状态机正常流转（pending→running→completed）未卡死；允许的「error」仅为 transient 心跳/poll 失败后自愈 |
| AC-08 | SMOKE.md 证据完整 | 七环节逐项有日志摘录或截图；AC-01..AC-07 逐项 ✓；含 backend version + daemon version + 冒烟时间；结论「通过」则解锁 task-24，「失败」则记录归因不解锁 |

## 关键规则

- 本蓝图**独立完整**，execute 子代理只读 task-23.md 这一个文件就能执行冒烟（契约结论引自各 task 的 AC 表，不依赖阅读其他 task-N.md 全文）。
- 边界处理 8 条（B1-B8），覆盖失败处置 / 端口配置 / agent 缺失 / 崩溃恢复 / 非阻塞性质 / WS 兜底 / 路由问题 / patch 为空。
- 验收标准 8 条（AC-01-AC-08）用表格，每条可单独观测判定，禁止笼统「基本能用」表述。
- frontmatter `created_at` 精确到秒：`2026-06-14T01:56:05+0800`。
- SMOKE.md 是 task-24 解锁的唯一证据文件，必须落盘到 `.sillyspec/changes/2026-06-13-daemon-nodejs-rewrite/SMOKE.md`。
