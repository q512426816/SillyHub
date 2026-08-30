---
author: WhaleFall
created_at: 2026-08-28 15:38:20
plan_level: full
---

# 实现计划（Plan）

## Spike 前置验证

无 Spike——技术方案已逐条对照现有代码核实（预检函数签名/钉定原语/daemon 认领段结构/既有 notifyRunResult 回传模式均有 file:line 依据，Design Grill 两轮通过），无未经验证的技术集成点。

## Wave 1（并行，无依赖）
- task-01
- task-02
- task-05

## Wave 2（依赖 Wave 1）
- task-03
- task-06

## Wave 3（依赖 Wave 2）
- task-04

## Wave 4（依赖 Wave 3）
- task-07

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 双源同序全序：queries.py 两函数补 ORDER BY | W1 | P0 | — | FR-03, D-005@v1 | resolve_representative_binding 四 SQL 变体 + resolve_daemon_instance_for_workspace（加 daemon_instances 心跳 join，注释明示 stale 绑定静默丢弃）统一 `实例心跳 DESC, daemon_id ASC` |
| task-02 | placement.py allowed_roots 预检 helper | W1 | P0 | — | FR-04, D-003@v2 | fetch_daemon_allowed_roots（instance ∪ 名下全部 runtimes）+ path_definitively_outside_roots 纯函数（仅可判定越界才 True） |
| task-03 | mcp_tools 选机唯一钉定 + 预检接线 | W2 | P0 | task-01,02 | FR-01, FR-02, FR-04, D-001@v1, D-002@v1 | ws 取行前移；预检两段式 provider；删 own_rt 分支恒 binding 钉定；钉定后建行前 A3 预检（可判定越界 400） |
| task-04 | backend 测试：重写+新增+回归 | W3 | P0 | task-03 | FR-01~FR-06 | :736 重写绑定钉定（夹具解耦）；test_representative_binding.py:124 按全序新语义更新（task-01 涟漪，plan 审查补入）；A3 三形态+FR-04 边界包含子句（`/ws/root`∈`/ws` 放行、`/ws-other/x` 拒）/A1 两段式/test_placement_member_binding 双源同序新用例；:283/:684 回归 |
| task-05 | daemon 守卫纯函数 + 单测 | W1 | P0 | — | FR-05, NFR-01 | interactive-cwd-guard.ts checkWorkspaceBoundCwd + vitest 三形态×双 OS |
| task-06 | daemon.ts 认领段接线 | W2 | P0 | task-05 | FR-05, D-004@v1 | truthy 分支（''/undefined/null 同兜底）；firstRunId 守卫后插入**白名单终检先行**+stat 存在性（双违反白名单优先）；拒绝 notifyRunResult 后 return 不 mkdir；空 rootPath 保留 gap-8 mkdir |
| task-07 | 全链路回归 | W4 | P0 | task-04,06 | FR-06, NFR-01/02 | backend 相关测试子集（含 member_runtimes 测试）+ ruff；daemon typecheck + vitest；存量行为回归确认 |

## 关键路径

task-01 → task-03 → task-04 → task-07（backend 主链；daemon 侧 task-05 → task-06 与其并行汇于 task-07）

## 全局验收标准

1. 所有新增/修改相关单元测试通过（backend：test_worker_subsession_dispatch + test_placement_member_binding；daemon：interactive-cwd-guard.test.ts）。
2. 存量行为回归：owner 机器即绑定机器的常态用例（:283/:317）与跨区代表钉定用例（:684）不改动通过。
3. （brownfield）未涉及路径零变化：batch 派发、普通 create_session、host_fs 方法测试不受影响。
4. daemon typecheck 通过（tsc --noEmit）。
5. 拒绝路径均有可诊断中文错误信息（422 既有 / 400 新增 / cwd_forbidden / cwd_not_found）。

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（绑定机器唯一钉定） | task-03 | task-04 重写用例：owner 在线未绑定目标区 → lease 落第三方绑定机器 |
| D-002@v1（provider 两段式） | task-03 | task-04：严格命中无回退日志 / 仅 codex 可回退解析 |
| D-003@v2（仅可判定越界才拒） | task-02, task-03 | task-04：绝对根越界 400 / 全 `~` 放行 / 空并集放行 |
| D-004@v1（拒建+truthy+插入点） | task-05, task-06 | task-05 单测三形态；daemon.ts 接线不 mkdir |
| D-005@v1（双源同序） | task-01 | task-04：多机绑定两解析收敛同机 |
| FR-01/02/03/04 | task-01,02,03 | 同上对应行 |
| FR-05 | task-05,06 | 守卫单测 + typecheck |
| FR-06 | task-04, task-07 | 存量用例回归通过 |
| NFR-01（跨平台） | task-02, task-05 | 纯函数 Win/Linux 双形态用例 |
| NFR-02（fail-loud） | task-03, task-06 | 400/守卫拒绝文案断言 |
