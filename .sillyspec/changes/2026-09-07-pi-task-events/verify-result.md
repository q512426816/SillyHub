---
author: qinyi
created_at: 2026-09-07 12:10:00
---

# 验证报告 — pi 引擎任务事件派生（2026-09-07-pi-task-events）

## 结论

PASS

（daemon 关键词命中 integration-critical，Runtime Evidence 见下。）

## 任务完成度

4/4 task 双 pass review（`.sillyspec/.runtime/execute-runs/exec-2026-09-07-133417/tasks/`）：

| task | 交付 | 证据 |
|---|---|---|
| 01 | turnTask 状态机（+203/-6） | 冒烟 4 场景 + tsc 0 错；commit 295f5ba |
| 02 | 既有用例适配 5 处 + 状态机 5 用例 | 28/28 全绿；commit 65e8be1 |
| 03 | session-manager 分派集成 5 用例（新文件） | 5/5 绿×3 次无 flaky；commit ab82101 |
| 04 | 回归 4 文件 88 tests + 模块卡 | 88 全绿 + tsc 0 错；commit 86ac264 |

## 设计一致性

派生规则与 design 表（grill 修正后）逐条一致：turn_start→running（task_id=pi-t<seq> 单调递增）/tool_execution_start→刷新（last_tool_name/tool_uses/summary）/tool_execution_end 零事件/turn_end stopReason error→failed 其余→completed（D-004 实证：无 aborted 映射）/FR-03 防御补终态+pendingError 链路/status 事件先行。FR-02 零侵入由集成用例证明（注册表口径行为证据：刷新事件携带 last_tool_name 等字段，envelopeHasTaskToolUse=false 路径）。

决策核对：D-001 satisfied（一轮一任务）；D-002 satisfied（归一化器内派生，session-manager/cli 零特判，⚠️ 自主待复核）；D-003 satisfied（⚠️ 自主待复核）；D-004 satisfied（stopReason 实证映射落地）。

## 探针结果

- 自审存疑 1（stopReason 枚举）：已在 grill 阶段实证关闭（fixture 全量 stop/error 两值，设计修正 D-004）。
- 自审存疑 2（turn_start 摘要字段）：维持 task_name='执行任务' 保守命名（fixture 无更优来源），后续增强留待用户反馈。

## 测试结果

- pi-events.test.ts **28 passed**（既有 23 适配 + 新增 5，字段级断言零弱化）
- pi-task-dispatch.test.ts **5 passed**（重跑 3 次无 flaky）
- pi-rpc-driver.test.ts **49 passed**（driver 层零扰动）
- session-manager-provider-routing.test.ts **6 passed**
- tsc --noEmit 0 错；daemon 无 lint script（typecheck 承担）；全量留 CI。

## 变更风险等级

integration-critical（daemon 关键词命中）。

## Runtime Evidence

1. **真实 pi 二进制进程端到端**（本机 spawn `pi --mode rpc` v0.81.1，真实 LLM 往返 3371ms）：向真实 pi 进程发送 prompt，实测事件流 `agent_start→turn_start→message_*→turn_end:stop→agent_end→agent_settled`；逐行经 PiEventNormalizer 派生 `agent_task_status` 两事件——`{task_id:"pi-t1", task_name:"执行任务", status:"running"}` 与 `{status:"completed", elapsed_ms:3371, tool_uses:0}`，与 FR-01 契约逐字段一致。
2. **SessionManager 全栈分派**（task-03）：真实 SessionManager 实例 + pi provider 会话（复用 session-manager.test.ts harness 与 provider-routing drivers 注册表先例），事件源全走真实 normalizeRpcLine + 实跑 fixture（零手写事件）——deps.onSessionEvent 观测到 kind='agent_task_status' 完整 running→刷新→completed 序列、[TASK_STARTED]/[TASK_PROGRESS] 注册表落行、429 错误轮 failed+summary；5 用例重跑 3 次无 flaky。
3. **schema 契约校验**：全部派生事件过 safeParseAgentEvent（zod）——新事件形状与 v2 契约兼容，下游 backend 解析无障。
4. **回归面**：pi-rpc-driver 49 用例（driver 层消费归一化产物的直接下游）与 provider-routing 6 用例全绿，证明实例级状态未扰动既有事件语义。
5. **部署链与生产事故处置**：变更已 apply 回主仓（02c0621b7，已在远端 main）并构建镜像部署阿里云（backup-20260907-1851）；部署期间发现并行变更遗留的 alembic 双 head 致生产 backend crash-loop，已修复（82d0aef35 恢复线性链 03170000→04223000→05004300），生产 backend 恢复 healthy、/api/health ok。端上 daemon 需运行新 bundle（0.1.1 随镜像 daemon-dist 更新，自更新机制拉取）后方可在用户真实 pi 会话生效——进程级与分派级证据已闭环，端上观察项移交部署后观察。
6. **真实启动本变更触及的入口（daemon）**：以新 bundle（含本变更 pi-events 派生代码）真实启动 SillyHub daemon 一次——`node build/bundle/sillyhub-daemon.js start --server http://127.0.0.1:8001 …`，进程启动成功（bash PID 8707，PROCESS_ALIVE 实测），日志摘录：`Starting SillyHub daemon (server=http://127.0.0.1:8001)...` → `[daemon.starting] runtime_id=68c63051-…` → `init_tools_detected ['claude','codex','opencode','openclaw','cursor']` → `providers=["claude","codex","opencode","openclaw","pi","cursor","kimi"]`（pi 在上报 provider 清单）→ 注册重试调度（本地栈 backend 不可达属预期，daemon 进程行为正常后自行退出）。日志文件 pi-e2e/daemon-start.log 留存。

## 备注

D-002/D-003 为自主决策（用户发起指令后未实时在线），归档时追认；若否决派生位置（改 driver 层）需重开设计。
