---
plan_level: full
execution_mode: main
---

# 实现计划（Plan）— 2026-10-13-change-files-refresh-sync

## Spike 前置验证

无——全部依赖设施（send_rpc/绑定解析/根映射/CLI 命令语义）已经 brainstorm 独立评审五交叉点源码实证（review-2026-10-13-125701），无技术不确定性。

## Wave 1（并行，无依赖——两仓文件正交）
- task-01
- task-04

## Wave 2（依赖 Wave 1——同仓串行，仍两仓并行）
- task-02
- task-05

## Wave 3（依赖 Wave 1+2 的 daemon 链）
- task-03

## Wave 4（收账，依赖 Wave 2+3 全部）
- task-06

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | daemon 执行器 runSyncChange | W1 | P0 | — | FR-01/FR-04/FR-05, D-001@v1 | sillyspec-manager.ts 查根+串行两条 CLI+结构化回执 |
| task-04 | backend 同步前置 | W1 | P0 | — | FR-01/FR-02/FR-04, D-002@v1/D-003@v1/D-005@v1 | router.py _sync_change_via_daemon 四路降级 |
| task-02 | daemon RPC 注册 | W2 | P0 | task-01 | FR-01/FR-02/FR-03/FR-05, D-002@v1/D-004@v1 | sillyspec_sync_change handler+防抖 Map |
| task-05 | backend 测试 | W2 | P0 | task-04 | FR-01/FR-02, D-002@v1/D-003@v1 | pytest 触发/四路降级/透传+回归 |
| task-03 | daemon 测试 | W3 | P0 | task-01, task-02 | FR-01/FR-03/FR-04/FR-05, D-001@v1/D-004@v1 | vitest 守卫/防抖/串行/失败结构 |
| task-06 | 收账 | W4 | P1 | task-03, task-05 | D-005@v1 | typecheck/聚焦测试/清单核验 |

## 关键路径
task-01 → task-02 → task-03 → task-06（daemon 链最长，决定最短交付周期）

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）
- **降级铁律**：GET files 任何情况下都返回现有镜像数据，同步失败绝不 500（D-003@v1——未绑定/离线/超时/远端错误四路全部 log.info 后放行）
- **service.list_files 零改动**：纯读语义不动，其它调用方不受影响（D-005@v1）
- **前端零改动、响应 schema 不变**：不新增/不修改任何 HTTP 端点与表结构，api-types 无需重新生成
- **协议面只加 method 不加 message type**：走既有 daemon:rpc 同步通道，不新增 fire-and-forget 消息类型
- **参数白名单双端对齐**：daemon SAFE_CHANGE_NAME_RE（daemon.ts:1611）+ isWorkspaceIdShape（daemon.ts:1335）；change 参数从 backend change.change_key 透传
- **命令语义（D-001@v1）**：串行 `sillyspec platform sync --change X` → `sillyspec platform sync-docs --change X`，单条 120s 超时，cwd=主仓根
- **防抖（D-004@v1）**：15s TTL + in-flight 去重 + 1000 条硬帽，进程内存态不落盘
- **不接入借用兜底**：未绑定 daemon 即降级，不借他机 CLI 副作用
- **测试纪律（CLAUDE.md 规则 0）**：禁止跑全量测试，仅跑本变更相关聚焦测试，全量留给 CI

## 全局验收标准
1. 两仓新增测试全绿（daemon vitest 新文件 + backend pytest 新文件）
2. 既有 backend/app/modules/change/tests/test_files_router.py 回归全绿（service 零改动证据）
3. （brownfield）老 daemon/未绑定/离线场景下 GET files 行为与现状完全一致（降级路径测试覆盖）
4. daemon typecheck 零错误；backend ruff/mypy 聚焦检查零错误

## 覆盖矩阵（decisions.md 全量 D 条目）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-03 | 串行两条 CLI 调用序断言；actions[].cmd 枚举 |
| D-002@v1 | task-02, task-04, task-05 | send_rpc method/params 断言；handler 注册 |
| D-003@v1 | task-04, task-05 | 四路降级 pytest 用例（200 恒返回） |
| D-004@v1 | task-02, task-03 | 防抖 skipped 用例（fake timers）；硬帽断言 |
| D-005@v1 | task-04, task-06 | service.list_files diff 零改动；清单核验无漂移 |
| D-006@v1 | — | rejected 决策，无覆盖任务（复潮条件已登记） |
| D-007@v1 | — | rejected 决策，无覆盖任务（复潮条件已登记） |
