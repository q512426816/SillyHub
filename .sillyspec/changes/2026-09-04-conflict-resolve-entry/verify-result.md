---
author: qinyi
created_at: 2026-09-05 00:52:00
---

# 验证报告 — 2026-09-04-conflict-resolve-entry（变更中心平台同步处理区）

## 结论

**PASS**

integration-critical 门控：本变更真改 backend+daemon+heartbeat，判级成立不豁免；Runtime Evidence 见下节（真实执行证据，非推断）。

## 任务完成度

11/11 任务完成（tasks.md 全勾，主仓暂存态逐一指认）：

| 任务 | 完成证据 |
|---|---|
| task-01 | backend protocol.py:101-102 两常量 + ws_hub.py send_sillyspec_resolve/send_sillyspec_ghost_cleanup（send_to_runtime 范式） |
| task-02 | router.py:1400/1438 两端点（RuntimeAdminUser + _get_owned_instance 越权 404 + change 白名单 422 + 504 DaemonRuntimeOffline） |
| task-03 | DaemonHeartbeatSillySpecCommandResult DTO + daemon_instances 新列 + 迁移 20260904223000（单头链）+ heartbeat_daemon 两态落库 + register 双分支恒清 + MachineSillySpecCommandResultRead 机器视图 |
| task-04 | test_sillyspec_platform_commands.py 40 用例（权限四态/白名单 14 变体/504/两态/latest-wins/register 恒清/机器视图/OpenAPI） |
| task-05 | protocol.ts 常量+payload+结果类型 + daemon.ts 两直连 case + SillySpecCommandExecutor 四方法接口 + in-flight guard 忙拒 |
| task-06 | sillyspec-manager 四执行器方法（flag 单点映射/ghost 两步 doctor→sync/结果矩阵全收敛）+ 10min 终态窗 + heartbeat 第 7 可选尾参 + config 键默认 120 |
| task-07 | sillyspec-platform-command.test.ts 35 用例 + 三既有测试适配（config 键表/MSG 计数 22→24/heartbeat fixture） |
| task-08 | lib/daemon.ts 两触发函数 + gen:types 产物（463 paths/577 schemas，幂等 md5 一致）+ DaemonMachineRead 补字段 |
| task-09 | platform-sync-section.tsx + use-machine-sync-action-access.ts + 桌面/移动挂载 + 10 用例，两页面 51 既有零回归 |
| task-10 | 总览卡两区 CLI 指引改 Link 跳变更中心，7 用例过 |
| task-11 | 三模块文档各 1 条变更索引（grep 各命中 1） |

## 设计一致性

独立 QA 验收（execute-review-2026-09-05-000829，22/22 pass）：
- 四决策逐条实证：D-001 fire-and-forget 通道（无队列表无 ack）、D-002 范围（冲突+ghost，abort 零命中）、D-003 权限（双端 gating + 警示不硬禁）、D-004 两态（三关键位：service 无条件落库无保持分支/register 双分支恒清/daemon 无 null 写键路径）。
- 非目标反向核：control_commands 词表未动、sillyspec_status/sillyspec_update 通道零改动、无 diff 对比视图。
- §7.5 生命周期 8 事件（含 register 恒清行）均有实现位+测试锚点。
- 数据流两条（sillyspec_command_result 七跳、resolve payload 五跳）各跳点在 diff 可指认。
- P2×5：3 项文档措辞已修（design HeartbeatBody 归属/useQuery 括注、daemon 文档 getCommandResult 一词），2 项接受（hook 独立文件、ghost 两步独立超时已声明取舍）。

## 探针结果

- 关键词探针：diff 全文 grep `abort` 零命中；`shell` 仅注释（数组形参不经 shell 的设计说明），无实际拼接。
- 集成盲区探针：三端契约对账四组（见 Runtime Evidence）。
- 代码质量探针：新增行零 TODO/FIXME/console.log/debugger。

## 测试结果

**主仓合入态（apply 后，含并行会话共存文件）三端全绿：**

| 端 | 命令 | 结果 |
|---|---|---|
| backend | `uv run pytest app/modules/daemon -q --no-cov -n auto` | **2021 passed** |
| backend | `ruff check` / `ruff format --check` | 全过 / 199 files already formatted |
| daemon | vitest 主批（排除 3 预存 flake 文件） | **3495 passed, 9 skipped**（193 文件） |
| daemon | vitest 串行批（3 flake 文件独占） | **33 passed** |
| daemon | `pnpm typecheck`（tsc --noEmit） | 0 错 |
| frontend | `pnpm test` | **3371 passed**（270 文件） |
| frontend | `pnpm lint` / `tsc --noEmit` | 0 Error / 0 错 |

新增/适配测试合计：backend 40 + daemon 35 + 前端组件 10 + 适配 4 文件（config/MSG 计数/heartbeat fixture/两页面 mock 接线 + 总览卡断言更新）。

## 变更风险等级

**integration-critical**（design 命中 backend/daemon/heartbeat 关键词，且实际真改）——不豁免，Runtime Evidence 如下。

## Runtime Evidence（integration-critical 真实集成证据，均为本机实际执行）

1. **WS 消息常量三端对齐**（主仓实跑 grep）：`backend/app/modules/daemon/protocol.py` `DAEMON_MSG_SILLYSPEC_RESOLVE = "daemon:sillyspec_resolve"` / `DAEMON_MSG_SILLYSPEC_GHOST_CLEANUP = "daemon:sillyspec_ghost_cleanup"` ↔ `sillyhub-daemon/src/protocol.ts` `SILLYSPEC_RESOLVE: 'daemon:sillyspec_resolve'` / `SILLYSPEC_GHOST_CLEANUP: 'daemon:sillyspec_ghost_cleanup'` 逐字一致；另有契约测试 `protocol-session-contract.test.ts` 钉死字面量（MSG 计数 22→24）。
2. **REST 契约闭环**（主仓实跑）：`backend/openapi.json` grep 命中 sillyspec-resolve/sillyspec-ghost-cleanup 4 处（两路径×path+operationId）；`frontend/src/lib/api-types.ts` 命中 MachineSillySpecCommandResultRead/MachineSillySpecResolveRequest 6 处；OpenAPI 端点导出实测含两新路径（W2 自验原文）。
3. **心跳字段端到端**：daemon `hub-client.ts` body 键 `sillyspec_command_result`（undefined=不出现，测试断言 `in` 语义）↔ backend `router.py` `DaemonHeartbeatSillySpecCommandResult` DTO 同名字段（grep 实证）→ `runtime/service.py` 整包直写 `daemon_instances.sillyspec_command_result`（test:647-664 直读库断言两态）→ `GET /machines` 透出（test 七键逐值断言）；daemon 侧集成测试实证真 manager→槽→`_sendHeartbeatOnce` 第 7 参携带/过期回 length=4 无显式 null。
4. **迁移链**：alembic 只读探针实测 `heads=['20260904223000']` 单头；测试库经 fixture create_all 新列自动生效（2021 用例含新列读写）。
5. **合入后回归**：上节三端全绿为主仓暂存态实跑（含并行会话共存未提交文件的真实集成状态），非 worktree 隔离态。

## 遗留与备注（不阻断）

1. verify 对账排除 8 个并行会话声明文件（model.py/router.py/openapi.json/api-types.ts 等与 2026-09-04-session-task-execution-panel、quick-ecb56bbe 共享声明）——本变更对这些文件的改动已实际落盘且测试全绿，仅对账归属让渡。
2. `tests/daemon-register-error-hint.test.ts` makeConfig 未补新 config 键（不在 allowed_paths、不红不涉断言）——后续顺手项。
3. ghost 两步各自独立 120s 超时（最坏 240s > 前端 150s 恢复窗）：迟到结果被前端忽略、可重试，无害；如遇真实案例再收口共享预算（代码注释已声明取舍）。
4. 部署面提醒：daemon 新指令需配套后端先上（旧 daemon 忽略新消息有 default-warn 兜底）；DB 迁移 20260904223000 需随发版执行。
