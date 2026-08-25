---
author: qinyi
created_at: 2026-08-25 20:30:00
plan_level: full
---

# 实现计划（Plan）— 团队分身子会话化 P1 治理地基

## Spike 前置验证

无——方案经独立 Design Grill 两轮核验（工具注入链路 / 三元组复用 / 虚拟映射判据
均已对源码逐点确认），无残留技术不确定性。

## Wave 1（数据模型基础，无依赖）

- task-01

## Wave 2（派发基建 + 判据原语，依赖 Wave 1）

- task-02
- task-03
- task-04
- task-08

## Wave 3（完成信号端点 + 治理口径，依赖 Wave 2）

- task-07
- task-11

## Wave 4（判据替换 + daemon 工具注入，依赖 Wave 3）

- task-09
- task-06

## Wave 5（派发接线 + 收口 + 摘要行化，依赖 Wave 4）

- task-05
- task-10
- task-13

## Wave 6（patrol 兜底 + UI 入口，依赖 Wave 5）

- task-12
- task-14

## Wave 7（回归收尾，依赖 Wave 1-6）

- task-15

> 拓扑分层（plan postcheck 修正版）：同 Wave 任务互不依赖且无共享文件。文件串行
> 链——mcp_tools.py：task-07(W3)→task-09(W4)→task-05(W5)；mission_context.py：
> task-04(W2)→task-07(W3)→task-09(W4)。task-06 依赖 task-07 端点故后置 W4。
## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 数据模型：迁移 + AgentSession 两列 + 解析函数 | W1 | P0 | — | FR-01, D-001@v1 | alembic 加 parent_session_id/worker_done_at；mission_worker_sessions 一层枚举；resolve_mission_for_session 环检测 |
| task-02 | execution.py worktree 块抽共享 helper | W2 | P0 | task-01 | FR-02 | git 探测/direct 旁路/worktree_add 抽出，新旧派发同源 |
| task-03 | placement：stage 参数 + 代表钉定模式 | W2 | P0 | task-01 | FR-02, FR-07, D-004@v1 | prepare_interactive_dispatch 写 lease metadata.stage；代表 binding 跳属主校验 |
| task-04 | create_session 三元组参数化 + 分身简报 | W2 | P0 | task-01 | FR-02 | session/service.py 复用模式（parent/owner/stage/首 run 双标记）；mission_context 分身简报渲染 |
| task-05 | dispatch_worker 换子会话三元组派发 | W5 | P0 | task-02,03,04 | FR-02, FR-09 | 保留 scope/越权/治理门/在线预检/AgentRunWorkspace；执行段换三元组 |
| task-06 | daemon 分身受限 MCP server | W4 | P0 | task-03 | FR-03, D-003@v1 | mcp-server.ts worker_done 单工具 + env 门控；session-manager 注入分支三路生效 |
| task-07 | backend worker_done 端点 | W3 | P0 | task-01 | FR-04 | worker_done_at + summary 挂首 run + SETNX DEL 重开工 + 迟到 409/include_terminal |
| task-08 | is_worker_complete + mission_derive_status | W2 | P0 | task-01 | FR-05, D-005@v1 | 虚拟 run 映射 + workers_only + done 优先于终态 failed |
| task-09 | 判据点全面替换 | W4 | P0 | task-08 | FR-05, FR-09 | 七处判据点/derive 消费点换单一真相源 |
| task-10 | converge 沿树批量 end_session | W5 | P0 | task-09 | FR-06 | merge 成功后收口；冲突/needs_manual 不收口 |
| task-11 | control 治理口径更新 | W3 | P0 | task-08 | FR-07 | cancel 名单扩子会话；can_dispatch_worker 混跑口径；cost_from_runs union |
| task-12 | patrol 孤儿子会话扫描 | W6 | P1 | task-10 | FR-06 | 独立查询 mission 终态 + 子会话活跃 → 补发 end_session |
| task-13 | 摘要子会话行化 + gen:types | W5 | P0 | task-09 | FR-08, FR-09 | TeamMissionWorkerSummary 加 sub_session_id/first_run_id；_team_mission_summary 数据源；openapi+api-types 同步提交 |
| task-14 | team-task-block 点击入口 | W6 | P0 | task-13 | FR-08 | 分身行点击按 sub_session_id 复用 session-panel |
| task-15 | 测试补全 + 全量回归 | W7 | P0 | task-01..14 | 全部 FR | backend test_worker_subsession_* + daemon interactive 测试 + 三端全量；含预期行为变更的既有断言更新（test_control_orchestrator_exclusion / test_session_team_mission / test_team_mission_create_block / test_mission_status / test_patrol / test_converge_mission_reentrant / cli-session-manager-injection / session-manager-main-agent-mcp） |

## 关键路径

task-01 → task-09 → task-05/10/13 → task-14 → task-15（数据模型 → 判据 → 派发/收口/
摘要 → UI → 回归；mcp_tools.py 沿 07→09→05 跨 Wave 串行避免并行互覆）。

## 全局验收标准

1. backend `uv run pytest`、frontend `pnpm test`、daemon `pnpm test` 全绿；
2. 集成冒烟：派团队 → 分身以子会话形态创建（DB parent 关系 + owner=创建者）→
   分身调 worker_done → mission 状态经 mission_derive_status 正确流转 →
   converge 后子会话全部 ended、worktree 清理只发生在已完成分身；
3. brownfield 零回归：未派团队 / 存量 batch 分身 mission 行为逐字节不变
   （双判据兼容，全量回归守护）；
4. 分身工具列表只含 worker_done（递归闸保持）。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01 | FR-01 验收（parent 关系 + 环检测 + 枚举不含轮次 run） |
| D-002@v1 | task-07, task-08 | FR-04 验收（重复完成周期 + 追问重开工语义） |
| D-003@v1 | task-06 | FR-03 验收（单工具 + 重启保持 + 主控不变） |
| D-004@v1 | task-03, task-05 | FR-02/07 验收（代表机器钉定 + owner 对齐） |
| D-005@v1 | task-08, task-09 | FR-05 验收（idle 不误判 + 各状态源一致） |
