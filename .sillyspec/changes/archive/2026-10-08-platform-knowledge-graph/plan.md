---
plan_level: full
change: 2026-10-08-platform-knowledge-graph
created_at: 2026-10-08 17:40:00
author: qinyi
---

# 实现计划（Plan）— 2026-10-08-platform-knowledge-graph

> 承接 brainstorm 四件套（design.md 为权威蓝图，任务卡 tasks/task-01~10.md 含每卡 goal/implementation/
> acceptance/verify/constraints 与 allowed_paths）；跨仓前置已交付（sillyspec 仓
> 2026-10-08-graph-summary-nodes：summary[--clusters]/nodes 两子命令，真图实测 5789 节点/10338 边/883 簇）。

## Waves（依赖拓扑分层）

## Wave 1（并行，无依赖）
- task-01

## Wave 2（依赖前序 Wave）
- task-02
- task-04

## Wave 3（依赖前序 Wave）
- task-03

## Wave 4（依赖前序 Wave）
- task-05

## Wave 5（依赖前序 Wave）
- task-06
- task-08

## Wave 6（依赖前序 Wave）
- task-07

## Wave 7（依赖前序 Wave）
- task-09

## Wave 8（依赖前序 Wave）
- task-10

## Wave 语义与依赖说明

- W1 daemon RPC 基座（task-01）→ W2 backend 三端点（task-02，dep task-01）+ daemon 测试（task-04，dep task-01）→ W3 backend 测试（task-03，dep task-02）→ W4 前端数据链 gen:types（task-05，dep task-03）→ W5 画布组件（task-06）+ 页签/图卡（task-08）（均 dep task-05）→ W6 图谱页（task-07，dep task-06）→ W7 前端测试（task-09，dep task-07·task-08）→ W8 端到端验收（task-10，dep task-09）。
- 相邻波间均有 depends_on 依赖边（01→02/04、02→03、03→05、05→06/08、06→07、07→09、09→10），无伪并行；同波内（W2 的 02+04、W5 的 06+08）文件面零交集可并行。

## 测试策略

聚焦面：daemon knowledge handler 用例（task-04）+ backend tests/test_graph.py（task-03）+ frontend graph 相关 __tests__（task-09）；回归面=knowledge 既有六族端点用例 + ops-dashboard 既有用例；lint=三段式（ruff/mypy + eslint+tsc + daemon typecheck）；禁止全量测试（规则 0，CI 的事）。

## 风险与缓解（承接 design R-01~R-07）

R-01 注入面：W1 消毒+task-04 用例先行；R-03 跨仓：CLI 已交付（探测降级保底）；R-05 gen:types 并行守卫：W4 单独提交；R-02 WS 大帧：裁剪后 task-10 复测。

## FR/决策覆盖对照

FR-01（task-02/03/10）、FR-02（task-02/03/05）、FR-03（task-02/03/05）、FR-04（task-01/04）、FR-05（task-07/08/09/10）、FR-06（task-06/09）、FR-07（task-08/09/10）、FR-08（task-02/03/10）。D-001@v2（task-01/02/03/04/10）、D-002@v1（task-07/08）、D-003@v1（task-06/09）、D-004@v1（task-08）、D-005@v1（task-01/02/10）、D-006@v1（task-07/10）、D-007@v1（task-02/05）、D-008@v2（task-07/10）。

## 全局硬约束

执行期子代理只读自己的任务卡与本段（design.md 全文不保证注入）：
1. 路由注册序铁律：所有 /knowledge/graph* 字面量端点必须注册在 GET /knowledge/{filename:path} 通配之前（router.py 文件首注释）。
2. 消毒面：anchor/anchor2/search 三自由串共用同一黑名单 sanitize，锚点位置参数引号包裹拼串，白名单外一律 validation_rejected（R-01）。
3. reason 六稳定键（unbound/offline/timeout/upgrade_required/invalid_input/rpc_error）与 daemon 回码六态（method_unregistered/cli_subcommand_missing/cli_feature_missing:<sub>/validation_rejected/timeout/internal）字面量锁死（D-001@v2）。
4. 前端三主题零硬编码 hex（themes.ts token + CSS 变量注入）；全中文文案。
5. 禁止跑全量测试（规则 0）；聚焦面见各卡 verify。
6. gen:types 生成物（openapi.json/api-types.ts）单独提交（R-05 并行会话守卫）。
7. 既有 knowledge 六族端点/HitsService.stats()/ops-dashboard 既有四卡零回归。
