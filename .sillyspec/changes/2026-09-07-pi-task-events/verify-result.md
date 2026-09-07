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

1. **真实进程外归一化验证**（task-01 冒烟）：node v24 type-stripping 直跑 normalizeRpcLine，构造 turn_start/tool_execution_start×2/tool_execution_end/turn_end(stop) JSONL 序列，实测事件流 running(pi-t1)→刷新×2（tool_uses 1→2、last_tool_name/summary 递进）→completed(elapsed_ms 走秒、tool_uses=2)；错误轮 turn_end(stopReason=error) → failed(content=errorMessage)；FR-03 场景（turn_end 丢失 + 顶层 error 后新 turn_start）实测先 completed(pi-t1, summary=pendingError 兜底) 再 running(pi-t2)。
2. **SessionManager 全栈分派**（task-03）：真实 SessionManager 实例 + pi provider 会话（复用 session-manager.test.ts harness 与 provider-routing 的 drivers 注册表注入先例），事件源全走真实 normalizeRpcLine + 实跑 fixture（manual-success-turn/real-error-turn，零手写事件）——deps.onSessionEvent 观测到 kind='agent_task_status' 完整 running→刷新→completed 序列、[TASK_STARTED]/[TASK_PROGRESS] 行落盘（注册表口径行为证据）、429 错误轮 failed+summary 载 errorMessage；5 用例重跑 3 次无 flaky。
3. **schema 契约校验**：全部派生事件过 safeParseAgentEvent（zod）——新事件形状与 v2 契约兼容，下游 backend 解析无障。
4. **回归面**：pi-rpc-driver 49 用例（driver 层消费归一化产物的直接下游）与 provider-routing 6 用例全绿，证明实例级状态未扰动既有事件语义。

## 备注

D-002/D-003 为自主决策（用户发起指令后未实时在线），归档时追认；若否决派生位置（改 driver 层）需重开设计。
