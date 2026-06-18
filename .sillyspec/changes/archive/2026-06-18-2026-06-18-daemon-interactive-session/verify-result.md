---
author: qinyi
created_at: 2026-06-19T03:40:00
---

# 验证报告 — daemon-interactive-session

## 结论

**PASS WITH NOTES**

变更完整实现，符合 design.md（v3 SDK driver 层），本变更引入测试全绿，9 个当前版本决策闭环无 unresolved blocker。遗留项为环境受限 + 文档滞后，非实现缺陷。

## 任务完成度

12/12 task 全部完成（文件存在 + 功能实现 + 测试通过）：

| Task | 覆盖 | 状态 |
|---|---|---|
| task-01 R-exe | 系统 claude wrapper→exe 补验 | ✅ sandbox 跑通 + 3 集成测试 |
| task-02 数据模型 | agent_sessions/lease.kind/agent_session_id | ✅ 14 模型测试 + 迁移 + D-001 守门 |
| task-03 协议契约 | WS 5 消息 + 4 payload 双侧对齐 | ✅ 19 TS + 38 Py 契约测试 |
| task-04 ClaudeSdkDriver | SDK 同进程多轮 + kind 分流 | ✅ driver/session-manager/input-queue + 5 测试 |
| task-05 backend session | REST/service/placement | ✅ 两段式 dispatch + 行锁 + 4 测试 |
| task-06 SSE 聚合 | session 级 channel + 双 publish | ✅ 12 测试 |
| task-07 联调+空闲 | interrupt turn 级 + 空闲 30min | ✅ 47 case |
| task-08 canUseTool 人审 | 三端 + 5min 超时 | ✅ daemon33+backend23+frontend7 |
| task-09 审批收敛+GLM | deny 收敛 + GLM 透传 | ✅ 24 daemon + 16 backend |
| task-10 resume | 持久化 + 崩溃恢复 | ✅ 43 daemon + 12 backend |
| task-11 前端面板 | InteractiveSessionPanel | ✅ 34 测试 + build |
| task-12 列表+历史+弹窗 | GET /sessions + logs + dialog | ✅ 18 测试 |

## 设计一致性（design.md v3 truth source）

- 架构（driver 与 TaskRunner 并存，D-002@v3，batch 零改动）✅
- 数据模型（agent_sessions 13 字段 / lease.kind / agent_session_id FK，D-005 三元）✅
- 接口（ClaudeSdkDriver / SessionManager / WS 5 消息 / REST / session SSE 聚合）✅
- 兼容（kind 默认 batch / D-009 系统 claude / D-008 GLM 透传 / WS 静默丢弃）✅
- 8 处合理 Reverse Sync 偏差（均记文档）：driver wrapper→exe（task-01）/ ws-client 单 onMessage / schema.py 单数 / AgentRun 无 created_at / permission 经 SSE 非 WS / SessionStatus 加 running / Wave 编号细化 / 系统 claude.CMD→真.exe

## 探针结果

1. **未实现标记**：本变更新增源码无 TODO/FIXME/HACK/XXX/尚未实现 ✅
2. **设计关键词**：会话/inject/interrupt/end/resume/permission/canUseTool/SSE/driver/空闲回收 等全有实现 ✅
3. **测试覆盖**：37 测试文件覆盖 12 task ✅
4. **决策追踪**：9 决策闭环，无 P0/P1 unresolved blocker ✅

## 决策追踪矩阵

> D-002 演进链：D-002@v1（1 session=1 lease 多 turn 复用 spawn）→ D-002@v2（每 turn 独立 spawn + resume，spike-01 证伪后回退）→ **D-002@v3**（SDK 同进程 driver 层与 TaskRunner 并存，spike-02 §3.7 两硬门通过后立项，v1/v2 均 superseded）。当前实现基于 D-002@v3，下表仅列当前版本生效决策。

| 决策 | → FR | → task | evidence |
|---|---|---|---|
| D-001@v1 | FR-01/09 | task-02 | AgentSession 表 + agent_session_id FK，session_id 未改 |
| D-002@v3 | FR-01/02/04/09 | task-04 | src/interactive driver 并存，TaskRunner 零改动 |
| D-003@v1 | FR-08 | task-10 | resume 持久化 + query resume |
| D-004@v1 | FR-06 | task-07 | 空闲 30min 扫描 |
| D-005@v1 | FR-03 | task-02/05/06 | 三元关系 + session SSE 聚合 |
| D-006@v1 | FR-10 | task-04~12 | 全栈 |
| D-007@v1 | FR-07 | task-08 | canUseTool 人审 + 5min 超时 |
| D-008@v1 | FR-08b | task-09 | GLM 透传不预禁 |
| D-009@v1 | R-exe | task-01/04 | wrapper→exe 解析 + .npmrc 排平台包 |

## 测试结果（merge 后主仓库 8afff51）

- backend daemon/agent: 398 passed
- daemon interactive/protocol/ws-client: 219 passed + typecheck 0
- frontend: 205 passed + typecheck 0 + build 成功
- lint: ruff / mypy / typecheck 全绿

## NOTES（遗留项，非阻断）

1. **PostgreSQL online 证明受限**：task-02/05 的 alembic online 往返 + 并发 inject 证明（AC-04）因本地 PG 容器端口未映射 host + 无 .env 无法 host 直连，用 offline SQL + SQLite fixture 等效验证；代码已正确写 `with_for_update` 行锁，online apply 待 CI/部署补。
2. **task 蓝图 AC checkbox 滞后**：task-02/03/04/07/08/09/12 蓝图内部 AC checkbox（85 个）未回填——execute 实现并验证了 AC 但未回填 task 蓝图 checkbox（plan.md 的 task 级 checkbox 已勾 [x] 12 个）。建议归档前完善回填。
3. **预存失败（非本变更引入）**：daemon 6 个（agent-detector3/cli2/spec-pull-push1/terminal-observer，test 文件不在本变更 diff）+ backend 5 个（admin2/git_identity1/incident2，本变更未碰这些模块）。均经 git stash / 模块归属确认。
4. **QA P2 建议后续优化**：permission-approval-dialog 死 import hack（`void Fragment`）/ 倒计时与 backend 5min 同步 / active session 接管进行中 turn / CONVENTIONS os.getenv→Settings / 旧 quick-chat 死代码清理。
5. **get_pending_leases 越权 P0**（router.py:848-884）：预存端点，非本变更引入（git diff 确认），是真实安全问题，建议单独变更修复。

## 模块文档

scan 文档把 daemon 标 Python 已过时（实际 TS），design.md 以实际 TS 代码为准。⚠️ 非阻断（模块文档未及时更新 daemon TS 部分）。

## 反向同步（reverse sync，已记文档）

实现过程中发现的与原 design 偏差，均合理实现调整，已记录：
1. SDK spawn 不带 shell:true → .cmd 路径 EINVAL，driver 需解 wrapper 取真 .exe（task-01 发现，记 task-01.md）
2. ws-client 实际单 onMessage 派发，SESSION_* 路由在 daemon.ts（task-04 真实代码结构）
3. backend schema 文件名实际 `schema.py`（单数，非 schemas.py）（task-09）
4. AgentRun 无 created_at 字段，历史回看用 coalesce(min logs.timestamp, started_at)（task-12）
5. permission 链路经 session SSE 事件（复用 task-06 channel），非独立 WS
