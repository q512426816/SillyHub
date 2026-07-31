---
author: WhaleFall
created_at: 2026-07-30T18:18:00
task: task-13
type: verification-run-log
---

# task-13 实跑验证记录 — daemon 心跳卡死 + 回复重复修复

> 变更 `2026-07-30-daemon-heartbeat-dedup-fix` · 部署：本机 Docker（backend）+ 本机 daemon 进程

## 部署动作

1. worktree 修复（task-01~12，3 commit 6a9ca54a/dc9bf20b/d25c61b9）git apply 到主仓库（sillyspec worktree apply 卡 design 清单校验，按 docs/sillyspec 坑 git apply 绕过）。
2. daemon rebuild：`cd sillyhub-daemon && pnpm build`（tsc，dist 含 Wave1 卡死修复 + Wave2 重复修复）。全局 `E:\Software\nodejs\node_modules\sillyhub-daemon` symlink → 项目，dist 同步。
3. 停旧 daemon（PID 23648 连 8000、PID 4080 连 3000，精确 PID taskkill）。
4. 启动修复后 daemon：`node dist/cli.js start --server http://localhost:8000 --api-key shk_live_Wal... --force` → Runtime `fde9478a-9c54-449a-8404-832c5d52f08a`，daemon_registered ✅，agents=[claude]。
5. backend rebuild + up：`docker compose build backend && up -d backend`（task-08 service.py 重复修复生效），backend healthy；daemon 自动重连 online。

## ✅ 目标1：daemon >2min online（卡死修复验证通过）

卡死 bug 原状：daemon 跑约 2min 事件循环冻死，backend last_heartbeat 停更，标 offline。

实跑观察（postgres daemon_instances.last_heartbeat_at）：

| 时点 | last_heartbeat_at(UTC) | lag | 结论 |
|---|---|---|---|
| T0（启动后） | 2026-07-30 10:15:41 | 9.52s | online，心跳正常 |
| T1（+130s，>2min） | 2026-07-30 10:18:14 | 9.68s | **online，跨过 2min 卡死点心跳持续** |
| T2（backend 重启后重连） | 2026-07-30 10:24:50 | 1.89s | online，重连后心跳正常 |

- last_heartbeat_at 跨过原 2min 卡死点持续更新，lag 始终 < 15s 心跳周期；backend 重启后 daemon 自动重连仍 online。
- daemon 进程 23800 持续在跑，CPU 1.39s（非冻死 idle）。
- **Wave1 卡死修复生效**：PolicyCache.set 去 resolveRealPath 统一归一口径（task-01）+ isPathUnderAnyRoot 判定时 realpath（task-02）+ _syncAllowedRoots 短路（task-03）+ 口径点统一（task-04），消除每心跳 changed=1 → set → realpath/stat 风暴。

## 目标2：回复不重复（#35 场景）— ✅ 实跑验证通过（task-14 补丁后）

### task-08 不彻底的根因 + task-14 补丁

- task-08 override 回退用 `flushed_partials`（submit_messages 内局部变量）+ `self._session.expunge`（只撤 pending 未 commit 的对象），**只覆盖单次 submit_messages 调用内**。实跑发现 daemon 流式 partial（半截）与 complete+override 信号**分两次 submit_messages 到达**——partial 在调用 A 已 commit 落库，override 在调用 B 到达时：局部 dict 跨调用不共享 + partial 已 persisted 无法 expunge + AgentRunLog 无 segment_id 列定位 → 删不掉已落库半截 → 回复仍重复。
- task-14 补丁：AgentRunLog 加 `segment_id` 列（String 200, nullable, indexed；partial 行写值，complete 行 NULL）+ override 信号（[ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE]）跨调用 `select + await session.delete` 已 commit partial（migration `202608310900`，down=`202607301000`）。

### 实跑证据（2026-07-31，会话 `35334e5b-1aaa-4256-83d2-306ede7d4b62` / run `fd31d1ac-bad9-4eea-8d3b-7ccf0bdbdc38`）

场景：agent 试图写 `F:\test.txt`，被运行时策略（Runtime Policy）拒绝，回复说明被拒。

- backend 日志 7 次 `daemon_messages_override_deleted_committed_partial`（跨调用 DELETE 实证，非单测）：
  - `main:msg_…653c9495617d4693:thinking` deleted=1
  - `main:msg_…653c9495617d4693:text` deleted=1
  - `main:msg_…9a23637f8b11a4bda:thinking` deleted=2
  - `main:msg_…9a23637f8b11a4bda:text` deleted=6
- DB `agent_run_logs`（run fd31d1ac）统计：
  - 残留 partial 行（segment_id IS NOT NULL）= **0**（半截全被跨调用 DELETE）
  - override 信号落库 = **0**（信号都 continue，不污染日志）
  - 最终保留 2 行 `[ASSISTANT]` + 3 行 `[THINKING]`，均为完整段落、互不重复（无「半截+全文」双发，#35 消除）。
- 单测：`test_run_sync_assistant_override.py` 12 用例全绿（含 5 个跨 submit_messages 调用用例）+ daemon 套件 567 全绿 + mypy/ruff 干净。

### 部署

- backend rebuild + `--force-recreate` + alembic upgrade 到 `202608310900`（segment_id 列 + `ix_agent_run_logs_segment_id` 索引已建，psql 复核）；容器内新代码确认（`_revoke_committed_partials` ×3、segment_id 列、migration 文件）；`/api/health` ok。
- daemon 侧：segmentId type 修复上轮已部署生效（override matched=5）；[DEBUG-task13] 日志源码已清（运行中 daemon 旧 dist 仍打 DEBUG，纯噪声，功能不受影响，待 rebuild dist + 重启静默）。

## 红线对照

- B1（isPathUnderAnyRoot sandbox 安全）：task-10 改前改后对照 43 用例全绿，task-02 实现无缺陷。daemon online 后实际路径判定随心跳正常工作（未触发越权异常）。
- B2（[ASSISTANT_OVERRIDE] metadata 无 thinking:true）：task-07 实现达标 + task-12 测试断言确认。

## 结论

- 卡死修复（核心阻塞 bug）：**实跑验证通过**，daemon >2min 持续 online + backend 重启重连仍 online。
- 重复修复：**实跑验证通过**（task-14 跨调用 DELETE 补丁后）——会话 35334e5b 回复无「半截+全文」双发，残留 partial=0、override 信号落库=0，backend 日志 7 次跨调用 DELETE 实证。
