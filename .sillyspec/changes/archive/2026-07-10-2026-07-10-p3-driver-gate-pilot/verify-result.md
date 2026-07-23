---
author: qinyi
created_at: 2026-07-10T19:35:00+08:00
---

# 验证报告 — P3 Driver Gate Pilot

## 结论

**PASS WITH NOTES**

代码实现 + mock 集成测试完整覆盖 AC-1~AC-9 链路语义；三端测试全绿零回归。真实 daemon + sillyspec gate verify 27s 端到端联调待 sillyspec gate 子命令 npm publish 发版（design §10 R4 硬前置，本机已 npm link 开发版可用），非代码缺陷——gate 未发版时 verify stage 走 Z1 探测 exit 2 fail-loud 阻断（design §5.6 安全行为，不退回声明态）。

## 任务完成度

13/13 task 全完成（plan.md checkbox 全勾，13 review.json 全 pass）：

| task | 内容 | 验收 |
|---|---|---|
| task-01 | HostFsDelegate run_command + 命令白名单 + send_rpc timeout | 7 ✓ |
| task-02 | daemon runCommand handler + 注册 | 6 ✓ |
| task-03 | _fire_background_task H4 范式 | 4 ✓ |
| task-04 | AgentRun gate_status/gate_result 列 + migration 7c77e09b84e1 | 5 ✓ |
| task-05 | close_interactive_run enqueue gate | 5 + 3 守门 ✓ |
| task-06 | _run_gate_via_delegate + Z1 合并方案 | 7 ✓ |
| task-07 | _run_gate_decision_task 四硬约束 H1/R3/H2/H4 | 5 ✓ |
| task-08 | auto_dispatch 三态决策 + verify 强制 gate | 5 ✓ |
| task-09 | gate_retry_count + gate_last_errors | 4 ✓ |
| task-10 | reconcile_pending_gate_decisions 挂 lifespan | 4 ✓ |
| task-11 | gate SSE 通知（gate_status_changed） | 5 ✓ |
| task-12 | 前端 gate_status 四态徽标 + SSE 实时更新 | 5 ✓ |
| task-13 | e2e AC-1~9 集成 + AC 映射 | 全 AC ✓ |

## 设计一致性

design v6 全节实现一致：§5.1 close 快速返回（task-05）/ §5.2 gate 决策 H1/R3/H2/H4（task-07）/ §5.3 HostFsDelegate run_command（task-01/02）/ §5.4 三态决策+数据模型（task-04/08）/ §5.5 reconcile（task-10）/ §5.6 Z1（task-06）/ §5.7 gate SSE（task-11/12）/ §7.5 生命周期契约表 8 事件 / §8 数据模型 migration / §9 brownfield nullable / §10 R1-R12 风险全应对。

3 处 Reverse Sync（合理偏差，保持 design 意图）：
- task-06 Z1 合并到正式 gate 结果分析——命令白名单拒 `gate --help`（task-01 只允许 `gate verify --change <name> --json` 头部），改分析 stderr `_GATE_SUBCOMMAND_MISSING_HINTS`（unknown command/no such command/not a sillyspec command，覆盖 oclif+commander），保持 §5.6 子命令缺失 exit 2 诊断意图
- task-09 `>=3` 内聚判定——exit 1 分支直接 return gate_blocked（同打回点一次性决策，非发信号交 task-08）
- task-12 gate_last_errors 用 SSE errors_summary 实时摘要替代 change.stages 读路径（实时足够，跨 run 历史 errors 读留后）

## 探针结果

- **alembic head 唯一** `7c77e09b84e1`（down_revision 419d34f8e33f，开工+改后均唯一，无多 head，R8 ✓）
- **sillyspec gate 子命令本机可用**（npm link 开发版，用法 `gate <stage> --change <name> --json`，envelope 9 键 schema_version/command/change/ok/errors/warnings/generated_at/stage/checks，Z1 口径=子命令缺失才 exit 2 ✓）
- **命令白名单双端字符级对齐**（backend delegate.py:_enforce_command_whitelist :762-815 + daemon isGateCommand :215-243，PREFIX_LEN=5 / 白名单 {'--stage'} / changeName 只守非空靠 execFile 非 shell 第二道防线防注入 ✓）

## 测试结果

主仓库（apply 后）三端全绿零回归：

- **backend** pytest **2571 passed** / 10 skipped / 5 xfailed（0 failed）+ mypy 446 files 0 issue + ruff All checks passed
- **frontend** vitest **844 passed** / 29 todo / 1 skipped + tsc typecheck PASS
- **daemon** vitest **1897 passed** / 8 skipped + tsc typecheck PASS

新增 gate 测试 8 套：host_fs run_command（19+83）/ fire_background（6）/ gate_enqueue（5）/ gate_decision_task（9+6 SSE）/ gate_via_delegate（17）/ auto_dispatch_gate（6）/ gate_retry（11）/ reconcile（4）/ gate_e2e（3 集成）。覆盖 cas 命中/miss、三态决策、异常 failed、SSE、命令白名单拒注入、超时杀子进程全分支。

## 变更风险等级

**integration-critical**（design 含 daemon/session/lease/lifecycle/gate 关键词）。

design §10 风险登记全应对：R1 reconcile 重启兜底 ✓ / R2 破锁死契约授权 ✓ / R3 cas 防双发 ✓ / R4 sillyspec gate 发版前置（待） / R5 H4 强引用防 GC ✓ / R6 H1 独立 session ✓ / R7 H2 不调 callback ✓ / R8 migration head 唯一 ✓ / R9 SQLite cas rowcount 真实 ✓ / R10 double-fire cas ✓ / R11 gate 慢异步不阻塞 ✓ / R12 retry 3 上限 ✓。

## Runtime Evidence（integration-critical 必填）

### 已验证（mock 等价覆盖，真实 _run_gate_decision_task 链路）

- **AC-1 exit0 推进**：`test_gate_e2e::test_ac01_exit0_advances`——真实 _run_gate_decision_task cas pending→running→decided + gate_result.exit_code=0 落 AgentRun（mock _run_gate_via_delegate 返回 exit0 envelope）
- **AC-4 gate 异常 failed**：`test_gate_e2e::test_ac04_gate_exception_failed`——_run_gate_via_delegate 抛 RuntimeError → gate_status=failed + gate_result.exit_code=2 fail-loud
- **AC-7 double-fire cas**：`test_gate_e2e::test_ac07_double_fire_cas_only_one_runs`——两次 _run_gate_decision_task 并发，第一次 cas pending→running 跑 gate，第二次 cas rowcount==0 return，run_command 调用计数==1
- **AC-2 exit1 打回+errors**：task-08 test_exit1_kickback + task-09 test_first_kickback_sets_count_to_1
- **AC-3 三次升级 exit2**：task-09 test_third_kickback_escalates_to_gate_blocked
- **AC-5 close<30s 不重试**：task-05 test_close_does_not_await_gate_task（close 2s 内返回不阻塞）
- **AC-6 重启 reconcile**：task-10 test_resets_pending_and_running_orphans_and_reenqueues
- **AC-8 命令白名单拒注入**：task-01（backend 19 case）+ task-02（daemon 19 RC case，含 rm/ls/cat/derive/乱序/未知 flag/缺值）
- **AC-9 前端 SSE 实时**：task-12 TC-02g gate_status_changed→gateStatus 更新

### 待真实集成验证（design R4 硬前置，非阻断代码）

1. **真实 daemon-client 部署 + sillyspec gate verify 27s 端到端**——close→gate 后台任务→daemon run_command RPC→sillyspec gate verify（27s+）→三态决策→SSE 前端徽标更新全链路。当前 mock run_command 等价覆盖链路语义，真实 27s gate 联调待部署环境。
2. **生产 PG migration apply**——SQLite 测试通过（gate_status/gate_result add_column dialect 无关，PG jsonb/VARCHAR 隐式），真实 PG apply 待部署验证。
3. **阻断前置**：sillyspec gate 子命令需 npm version patch + publish 发版（本机 npm link 开发版可用，生产部署前必须发版）。未发版时 verify stage 走 Z1 探测 exit 2 阻断（design §5.6 意图，fail-loud 不退回声明态）。

### 阻断降级说明

本变更新增 gate 决策路径在 sillyspec gate 未发版时，verify stage 会 Z1 阻断 exit 2（design §5.6 安全行为）。这是设计内的安全机制（绝不退回 read_verify_result 声明态），非代码缺陷。mock 测试已等价覆盖全部链路语义（AC-1~9 可测），真实 e2e 待 sillyspec gate npm publish 发版后补，发版后建议跑一次真实 27s gate verify 端到端确认。
