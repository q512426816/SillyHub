---
author: qinyi
created_at: 2026-10-03
plan_level: full
---

# 实现计划（Plan）

## 来源
用户裁决（2026-10-03）：「方案 2」——本地用量按水位差分片段归属（跨变更连续工作归属被覆盖缺陷）。brainstorm 四件套 + decisions D-001/002@v2/003@v2/004 为唯一直接来源。

## Wave 1 — 存储层（无依赖）
- task-01

## Wave 2 — 上报链路与聚合改造（依赖 task-01；文件正交并行）
- task-02
- task-03

## Wave 3 — 回归收口与文档（依赖全链路）
- task-04

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | target_files | 说明 |
|---|---|---|---|---|---|---|---|
| task-01 | 存储层水位表 | W1 | P0 | — | FR-01, D-001 | NEW:backend/migrations/versions/20261003020000_add_agent_log_usage_marks.py; backend/app/modules/platform_sync/model.py | 水位表 + UsageMarkORM（change_key String(200)/quick_id String(128) 对齐、seq 单调、复合唯一键 (workspace_id,log_path,seq)、change_key/quick_id 索引） |
| task-02 | 上报链路插水位 | W2 | P0 | task-01 | FR-01, D-002@v2, D-003@v2 | backend/app/modules/platform_sync/service.py; backend/app/modules/platform_sync/tests/test_agent_log_push.py | upsert 循环内行覆盖前读旧行五值插水位（无旧值按 0）+ MAX(seq)+1 + 修剪（>200 删中段、豁免首末 min/max seq）+ 用例：插水位/同 ctx 连续/ctx 双空/首末豁免/存量基线重推（FR-04b 断言） |
| task-03 | 聚合双路径 | W2 | P0 | task-01 | FR-02, FR-03, FR-04a, D-004 | backend/app/modules/change/usage_service.py; backend/app/modules/change/tests/test_usage_stats.py | 本地段改：水位差分（SQL 自引用 next by seq，首水位起点 0 隐式、末水位接 entry 当前快照、max(0,·)、NOT EXISTS agent_runs 谓词沿用）∪ 存量整行（无水位 entry）互斥；用例：跨变更切换守恒/摄取滞后反例（FR-04a）/存量兼容/quicklog/NULL ctx |
| task-04 | 回归收口与文档 | W3 | P0 | task-02, task-03 | FR-01, FR-02, FR-03, FR-04, FR-04a, FR-04b | .sillyspec/docs/backend/modules/platform_sync.md; .sillyspec/docs/backend/modules/change.md | 聚焦 pytest 全绿 + ruff/mypy + 两模块文档归属协议段更新（水位协议/两卡分叉声明 R-08） |

## 关键路径
task-01 → task-02 ∥ task-03 → task-04（execution_mode 缺省 main 直写）

## 全局验收标准
1. 水位：上报必插（含 ctx 双空）；同 ctx 连续多次插多行；>200 修剪且首末水位恒在（201 次上报断言）。
2. 差分：跨变更切换 A→B→C 各得各时段量、Σ=文件累计（守恒，含摄取滞后反例形态——按 D-002@v2 边界）；首水位锚定使存量带基线重推数字连续（FR-04b）；quicklog 同构；NULL ctx 片段不计。
3. 互斥：有水位 entry 不走整行路径；两路径共用 NOT EXISTS agent_runs 防双计谓词。
4. 兼容：无水位存量 entry 数字与改造前一致；downgrade 回退等价改造前；API/DTO 零变化（前端不动）。
5. 聚焦测试全绿（platform_sync + change）；ruff/mypy 过。

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01/02/03 | AC-1/AC-2（协议本体） |
| D-002@v2 | task-02, task-03 | AC-2（滞后反例守恒断言） |
| D-003@v2 | task-02 | AC-1（首末豁免断言） |
| D-004@v1 | task-03 | AC-2（存量重推连续断言） |

## 全局硬约束（绑定所有 task）
- 水位插入与 upsert 同事务（不引入队列/锁/异步）。
- CLI/daemon 协议零改动；agent_runs 链路与二选一防双计不动。
- 聚合批量单查询零 N+1；DTO 字段集零变化。
- 平台 MUST NOT 基于 provisional 事件内容做流程判定（既有红线）。
