# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论必须写明 PASS / FAIL**——
> 留「待填」会被 gate 判不过（fail-closed）。

## 结论：PASS（8/8 任务双 Gate+验收 pass；四路径集成回归绿；真机三态验证过；无 P0/P1 遗留）

## 任务完成度
tasks.md 8/8 勾选；per-task review 8/8 双 pass（exec-2026-08-29-152018）；独立 QA 验收 pass（三必查+四交界+B1/B2/B3 落代码）。全部完成。

## 设计一致性
整体一致。三处已声明偏差在案：task-06 facade 直调（pending_controls 同款先例，后续收口建议记录）/reason 不收紧 Literal（心跳保活宁宽勿断）/机器视图 DTO 内联 router 子类化（最小改动）；验收 P2-1 注释失实与 P2-3 design 陈旧参数已当场修正（bfbff8b0）；P2-2 双源常量留档。

## 探针结果（CLI 机械预填）
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中

#### 探针 2：设计关键词覆盖
关键词→锚点（grep 实证）：hasRunningTurn/hasActiveLease（session-manager/task-runner）、_isBusyForUpdate/_tryUpdate/_deferUpdate/_scheduleUpdateRetry/_updateBusy（daemon.ts）、startDiskProbe/DISK_BUILD_ID_RE/pending-update.json/self_reload_check_interval_sec（daemon/config/cli）、fetchLatestBuildId（preflight）、pending_update 列/迁移 20260829150000/MachinePendingUpdateRead/WithPending（backend）、MachinePendingUpdate/三状态横幅（frontend）。全命中。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（sillyhub-daemon/src/interactive、sillyhub-daemon/src、sillyhub-daemon/tests）找到 12 个测试文件（sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts、sillyhub-daemon/tests/adapters/ndjson.test.ts …）
- ✅ task-02: 模块目录（backend/app/modules/daemon、backend/migrations/versions、backend/app/modules/daemon/tests）找到 26 个测试文件（backend/app/modules/daemon/audit/tests/test_audit.py、backend/app/modules/daemon/audit/tests/test_model.py、backend/app/modules/daemon/grants/tests/conftest.py、backend/app/modules/daemon/grants/tests/test_grants_authorization.py、backend/app/modules/daemon/grants/tests/test_migration.py …）
- ✅ task-03: 模块目录（sillyhub-daemon/src、sillyhub-daemon/tests）找到 12 个测试文件（sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts、sillyhub-daemon/tests/adapters/ndjson.test.ts …）
- ✅ task-04: 模块目录（sillyhub-daemon/src、sillyhub-daemon/tests）找到 12 个测试文件（sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts、sillyhub-daemon/tests/adapters/ndjson.test.ts …）
- ✅ task-05: 模块目录（sillyhub-daemon/src、sillyhub-daemon/tests）找到 12 个测试文件（sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts、sillyhub-daemon/tests/adapters/ndjson.test.ts …）
- ✅ task-06: 模块目录（backend/app/modules/daemon/runtime、backend/app/modules/daemon、backend/app/modules/daemon/tests）找到 21 个测试文件（backend/app/modules/daemon/audit/tests/test_audit.py、backend/app/modules/daemon/audit/tests/test_model.py、backend/app/modules/daemon/grants/tests/conftest.py、backend/app/modules/daemon/grants/tests/test_grants_authorization.py、backend/app/modules/daemon/grants/tests/test_migration.py …）
- ✅ task-07: 模块目录（frontend/src/lib、frontend/src/components/daemon、frontend/src/components/daemon/__tests__）找到 20 个测试文件（frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts、frontend/src/lib/daemon.test.ts、frontend/src/lib/errors.test.ts、frontend/src/lib/ppm/execute-time.test.ts …）
- ✅ task-08: 模块目录（backend、sillyhub-daemon/src、frontend/src/lib、sillyhub-daemon/tests/integration）找到 61 个测试文件（backend/app/core/spec_paths.py、backend/app/core/tests/test_auth_deps_db_release.py、backend/app/core/tests/test_config_auth.py、backend/app/core/tests/test_errors.py、backend/app/core/tests/test_monitoring.py …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 4：决策追踪覆盖
D-001→FR-01→task-01/04（忙判定+屏障用例）；D-002→FR-01→task-04（30s 复查+清定时器用例）；D-003@v2→FR-03→task-03/04/07（读文件探测+直启+info 横幅）；D-004→FR-04/05→task-05/06/07（三端链+四路径集成）；D-005→FR-02→task-04（所有权全路径+停摆注释）；D-006→全部。闭环。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 2400 backend endpoints (live [scan-root 516] + artifact 2064), 0 frontend calls [scope: change-diff (3 files @ scan-root)] | 720 backend endpoints unused by frontend
- ⚠️ 720 个后端端点前端未调用（warning 不阻断）：GET /admin/roles、POST /admin/roles、GET /admin/organizations、POST /admin/organizations、GET /admin/users …

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

## 测试结果
本变更相关：daemon 新增 81 用例（busy-check 14/column 5/disk-probe-pending 18/orchestrator 17/preflight+4/heartbeat-pending 7/integration 4/config 键列表+回归 44+51+64 等）全绿 tsc 0；backend 5+19+142 受影响回归绿 mypy 778 零新增 ruff 干净；frontend 8+74 绿 tsc 0；gen:types 两轮幂等零 diff。known_failures 未新增豁免。

## 决策追踪矩阵（如存在 decisions.md；无则删本节）
| 决策 | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01 | 01/04 | 忙判定+屏障用例 | 闭环 |
| D-002@v1 | FR-01 | 04 | 30s 复查+清定时器 | 闭环 |
| D-003@v2 | FR-03 | 03/04/07 | 读文件探测+直启+横幅 | 闭环 |
| D-004@v1 | FR-04/05 | 05/06/07 | 三端链四路径集成 | 闭环 |
| D-005@v1 | FR-02 | 04 | 所有权全路径+停摆注释 | 闭环 |
| D-006@v1 | 全 | 01-08 | 整体 | 闭环 |

## 技术债务
探针 1 零命中。存量债两条留档：preflight facade 透传参数收口（task-06 偏差 1）；daemon.ts 双源常量 DAEMON_BIN_DIR/BUNDLE_NAME（task-06 偏差 2 注释在案）。

## 变更风险等级
integration-critical（daemon/heartbeat/机器视图跨进程链，准确）。无抑制语境。部署级+集成级证据见 Runtime Evidence。

## Runtime Evidence
**端到端（integration test，真实 daemon↔backend 非 mock）** — 2026-08-29 19:37-19:38，主仓代码（apply 后 commit 0ff835b2）：
- 准备：共享 dev postgres `alembic upgrade head` → 4766d997cf09 → **20260829150000** 单 head（新列落地）
- 真实启动一次（部署级）：`uv run uvicorn app.main:app --port 8013`，日志实证三 sweeper 常驻协程正常（session_reconnect/lease_expiry/control_command_gc started）
- 真实心跳×真实 DB 三态验证（真实 daemon api-key X-API-Key，事件链：
  - ①携带 pending_update（server_command/build-old→build-new）心跳 200 → DB `pending_update` 落库四键含 since=`2026-08-29T11:37:43.612864+00:00`
  - ②同内容重放心跳 200 → DB since **原值保留**（11:37:43.612864 未漂移——upsert 保留语义真机实证）
  - ③无字段心跳 200 → DB `pending_update IS NULL`（清除语义真机实证）
  - ④reseed disk_change（验证后清理置 NULL 还原）
- 机器视图 HTTP 透出：不涉及真机 JWT（admin 为迁移账户密码不掌握）——以 task-06 test_pending_update_upsert.py 的 HTTP 全链用例为准（两端点含/不含两态断言，10 用例实跑绿）
- daemon 侧重试/直启/终检：不涉及真机进程重启（会打断开发环境）——以四路径集成用例为准（路径①-④断言顺序数组/零调用负断言，4 用例实跑绿）
- 失败模式排除：无 X-API-Key 心跳 401（鉴权不受影响，沿既有）
- 关停：backend 8013 已停，DB 脏数据已清理

## 代码审查
无功能性问题。质量亮点：验收 QA 三 P2 两处当场修正；集成用例用可控 deferred 精确卡下载窗口+真实探测循环；upsert 哨兵测试防时钟抖动。总体：生产级。
