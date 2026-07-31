---
author: WhaleFall
created_at: 2026-07-31T09:55:00
task: verify
type: verify-result
---

# 验证报告（Verify Result）— daemon 心跳卡死 + 回复重复修复

> 变更 `2026-07-30-daemon-heartbeat-dedup-fix` · 含 task-14（task-08 不彻底的跨调用补丁）

## 结论

**PASS**

两个核心 bug 均经**真实端到端集成验证**（非 mock 单测）通过：卡死（daemon >2min online）+ 回复重复（#35 半截+全文双发消除）。单测全绿、设计一致、决策闭环。

## 任务完成度

完成率 **14/14**（tasks.md task-01~13 + plan Wave 2.1 task-14）。

| Task | 内容 | 状态 | 证据 |
|---|---|---|---|
| task-01 | PolicyCache.set 去 resolveRealPath | ✅ | runtime-policy.ts `resolveRealPath` 出现 0 次（已移除） |
| task-02 | isPathUnderAnyRoot 补 resolveRealPath（下沉判定） | ✅ | path-utils.ts `isPathUnderAnyRoot` 命中（B1 红线，task-10 改前改后 43 用例对照） |
| task-03 | _syncAllowedRoots 短路 | ✅ | daemon.ts `_syncAllowedRoots` 命中 |
| task-04 | 所有 set/判定点口径统一 | ✅ | grep 全覆盖（含 _handlePolicyUpdate:2010 normalize） |
| task-05~07 | daemon partial 带 segmentId + emit [ASSISTANT_OVERRIDE] | ✅ | session-manager.ts `ASSISTANT_OVERRIDE` 6 处；B2 metadata 无 thinking:true |
| task-08 | backend 识别 ASSISTANT_OVERRIDE 删 partial | ✅ | service.py override 分支（单调用 expunge） |
| task-09 | interactive dedup_key 补 seq | ✅ | daemon.ts + error-classify.ts |
| task-10~12 | 测试（路径判定/口径短路/override 删 partial） | ✅ | 全绿 |
| task-13 | 实跑 daemon >2min online + 回复不重复 | ✅ | verification/run-log.md（卡死表 + 重复实跑） |
| task-14 | backend 持久化 segment_id + 跨调用 override DELETE | ✅ | model segment_id 列 + migration 202608310900 + service `_revoke_committed_partials` 7 处 + 12 单测 + 实跑 7 次 DELETE 日志 |

## 设计一致性

实现符合 design.md（方案 A：照搬 thinking 全套），不发明新机制：

- 卡死（D-001）：PolicyCache.set 去resolveRealPath 统一归一口径 + isPathUnderAnyRoot 判定时 realpath（下沉）+ _syncAllowedRoots 短路（D-004）+ 口径点统一。消除每心跳 changed=1 → set → realpath/stat 风暴。
- 重复（D-002）：照搬 thinking override + 删 partial。**task-14 是 D-002 的跨调用补全**——design §5 Wave2 原描述「backend 删 partial」当时隐含单调用假设，实跑暴露 partial 与 override 跨 submit_messages 调用（task-08 expunge 只撤单调用 pending）。task-14 加 segment_id 列 + 跨调用 select+session.delete 已 commit partial，仍属 D-002「照搬 thinking override + 删 partial」方案，不违背 design。
- 非目标守住：未改前端 / agent 行为 / thinking 机制本身 / lease-session-agent_run 状态机 / WS·HTTP 心跳（design §3）。

## 探针结果

- **未实现标记扫描**（变更文件）：`grep 尚未实现|TODO|FIXME|HACK|XXX` → 0 匹配 ✅
- **关键词覆盖**：design 关键能力词（PolicyCache 口径统一 / isPathUnderAnyRoot realpath / 短路 / [ASSISTANT_OVERRIDE] / [THINKING_OVERRIDE] / segmentId / flushed_partials 删 partial / segment_id 跨调用 DELETE）源码均命中 ✅
- **测试覆盖**：变更模块测试文件齐全（runtime-policy.test.ts / path-utils.test.ts / session-manager.test.ts / daemon-policy-update.test.ts / test_run_sync_assistant_override.py）✅
- **决策追踪覆盖**：decisions 内嵌 design §10（D-001~D-005@v1），plan 覆盖矩阵映射 FR→task→证据，无 P0/P1 未决 ✅

## 决策追踪矩阵

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1（卡死口径：realpath 下沉判定） | FR-01/FR-03 | task-01,02,04,10,11 | runtime-policy.ts resolveRealPath=0、path-utils isPathUnderAnyRoot、口径测试 | PASS |
| D-002@v1（重复：照搬 thinking override + 删 partial） | FR-02 | task-05~09,12,13,14 | override emit + 删 partial + **task-14 跨调用 DELETE** + 实跑不重复 | PASS |
| D-003@v1（卡死 Wave1 优先） | Wave 顺序 | Wave 分组 | 卡死先修 + 部署 online 后验证重复 | PASS |
| D-004@v1（_syncAllowedRoots 短路） | FR-01 | task-03,11 | JSON.stringify 相同 return + 短路测试 | PASS |
| D-005@v1（R4 异步化本轮不做） | R4 | — | 口径+短路已消除风暴（实跑 >2min online），异步化不做 | PASS |

## 测试结果

- **backend** `app/modules/daemon/tests/`：**567 passed**（含 test_run_sync_assistant_override 12 用例：5 跨调用 + 7 单调用/不串扰）。
- **mypy** `app/modules/daemon/run_sync/service.py`：clean。
- **ruff** check + format：clean。
- **daemon（TS 独立子项目）**：policy / session-manager override / 路径判定测试 execute 时全绿（task-10 改前改后 43 用例对照 B1 红线）。
- 前端未改（test_strategy=module，不测前端）。

## 技术债务

变更文件无 TODO/FIXME/HACK/XXX。遗留（非债务，已记录）：运行中 daemon 旧 dist 仍打 [DEBUG-task13] 日志（源码已清，纯噪声，功能不受影响，待 rebuild dist + 重启静默）。

## 变更风险等级

**integration-critical**（自动判定命中 daemon / backend / session / lease / lifecycle / heartbeat 关键词，且变更确属真实跨 daemon↔backend 进程集成）。本变更确为跨进程集成（daemon 流式 override 信号 → backend 跨调用 DELETE），需真实集成证据——见下 Runtime Evidence（已满足）。

## Runtime Evidence（真实 daemon↔backend 集成，非 mock）

**部署**：backend Docker `--build --force-recreate`（容器内新代码确认：`_revoke_committed_partials`×3、segment_id 列、migration 文件）+ alembic upgrade 到 `202608310900`（psql 复核 `agent_run_logs.segment_id` 列 + `ix_agent_run_logs_segment_id` 索引已建）+ `/api/health` ok。daemon 进程连本机 :8000。

**卡死修复（端到端）**：daemon 启动后 >2min 仍 online，`last_heartbeat_at` 跨过原 2min 卡死点持续更新（lag 始终 <15s 心跳周期），backend 重启后 daemon 自动重连仍 online（run-log.md T0/T1/T2 表）。

**重复修复（端到端真实集成）**——会话 `35334e5b-1aaa-4256-83d2-306ede7d4b62` / run `fd31d1ac-bad9-4eea-8d3b-7ccf0bdbdc38`，agent 试图写 `F:\test.txt` 被运行时策略（Runtime Policy）拒绝：

- backend 日志 7 次 `daemon_messages_override_deleted_committed_partial`（真实 daemon→backend override 信号触发跨调用 DELETE，非单测）：
  ```
  {"segment_id":"main:msg_…653c9495617d4693:thinking","deleted":1,"event":"daemon_messages_override_deleted_committed_partial"}
  {"segment_id":"main:msg_…653c9495617d4693:text","deleted":1,…}
  {"segment_id":"main:msg_…9a23637f8b11a4bda:thinking","deleted":2,…}
  {"segment_id":"main:msg_…9a23637f8b11a4bda:text","deleted":6,…}
  ```
- DB `agent_run_logs`（run fd31d1ac）终态断言：
  - 残留 partial 行（`segment_id IS NOT NULL`）= **0**（半截全被跨调用 DELETE）
  - override 信号落库（`[ASSISTANT_OVERRIDE]`/`[THINKING_OVERRIDE]`）= **0**（信号都 continue，不污染日志）
  - 最终 5 段回复（2 [ASSISTANT] + 3 [THINKING]）均为完整段落、互不重复 → **#35 半截+全文双发消除**。

**结论**：两个 bug 端到端真实集成验证通过（runtime evidence 齐全）。
