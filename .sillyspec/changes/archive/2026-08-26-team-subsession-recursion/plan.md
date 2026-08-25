---
author: qinyi
created_at: 2026-08-26 03:00:00
plan_level: full
---

# 实现计划（Plan）— 团队分身递归开闸 P2

## Spike 前置验证

无——P1 已验证全部基础设施（受限注入链/收口链/判据函数），P2 是其上的
参数化扩展；Grill 两轮已核验假设。

## Wave 1（数据模型，无依赖）

- task-01

## Wave 2（判据原语 + 透传链，依赖 Wave 1）

- task-03
- task-04

## Wave 3（端点全量 + daemon 工具集 + 失败收口，依赖 Wave 2）

- task-02
- task-05
- task-06

## Wave 4（预算强收 + 全树换点其余，依赖 Wave 3）

- task-07
- task-08

## Wave 5（回归收尾，依赖 Wave 1-4）

- task-09

> 拓扑与文件所有权（P1 postcheck 教训前置）：同 Wave 零依赖零共享文件。
> mcp_tools.py 唯一 owner=task-02；mission.py=task-03；session-manager.ts=
> task-04；patrol.py=task-07。task-02←01,03；task-05←04；task-06 独立后端；
> task-07←03；task-08←01,03。

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | tree_depth 列+全树 CTE | W1 | P0 | — | FR-01, D-003@v2 | 迁移 NOT NULL DEFAULT 0+全表回填；UNION 去重+深度截断 |
| task-02 | mcp_tools 全量 | W3 | P0 | task-01,03 | FR-02, FR-03, FR-07 | 五端点解析/递归派发/深度门/层0收口/worker_done+busy 全树 |
| task-03 | mission.py 映射增补+全树集合 | W2 | P0 | task-01 | FR-05, FR-07, D-005@v1 | budget_force_ended 映射规则；分身集合换全树 |
| task-04 | worker_depth 透传链+会话闸 | W2 | P0 | task-01 | FR-04, FR-06, D-003@v2 | placement→context→daemon.ts→types→persistence→session-manager；闸 env 默认 20 |
| task-05 | daemon 分层工具集 | W3 | P0 | task-04 | FR-04, D-002@v1 | 非叶 5 件/叶 1 件硬编码；旧 lease 叶档兜底 |
| task-06 | run_sync 失败即收口 | W3 | P0 | — | FR-06, D-006@v1 | 首 run failed+从未 ready+parent 非空→failed 终态 |
| task-07 | patrol 预算强收 | W4 | P0 | task-03 | FR-05, D-005@v1 | 标记+批量收口+计数键；枚举换全树 |
| task-08 | 全树换点其余+简报 | W4 | P0 | task-01,03 | FR-07 | control/finalizer/mission_context/router；非叶简报 |
| task-09 | 测试补全+三端全量 | W5 | P0 | task-01..08 | 全部 FR | 六类新测试+回归+既有断言更新 |

## 关键路径

task-01 → task-03 → task-02 → task-09 与 task-01 → task-04 → task-05 两条并行链
（数据模型→判据→端点→回归 ∥ 透传链→工具集），汇于 task-09 回归。

## 全局验收标准

1. 三端全量测试全绿（backend/frontend/daemon）；
2. 集成冒烟：分身派孙（parent/depth 落库）→ 孙 worker_done 可用 → 全树
   收敛；孙调 dispatch 400；分身调 converge 403；预算触顶强收后 mission
   可收敛 degraded；会话闸拒绝后子会话 failed 且 mission 不卡死；
3. brownfield 零回归：无孙存量 mission 行为零变化（全树与一层枚举等价）；
4. 递归双保险：backend 深度门 + daemon 叶档单工具。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02 | FR-01/02 验收（3 层深常量+门） |
| D-002@v1 | task-05 | FR-04 验收（两档工具集断言） |
| D-003@v2 | task-01, task-04 | FR-01/04 验收（双源+保档） |
| D-004@v1 | task-02 | FR-02 验收（五端点解析） |
| D-005@v1 | task-03, task-07 | FR-05 验收（标记+映射+强收） |
| D-006@v1 | task-06 | FR-06 验收（failed+从未 ready） |
| D-007@v1 | task-02 | FR-03 验收（通道嗅探守卫） |
