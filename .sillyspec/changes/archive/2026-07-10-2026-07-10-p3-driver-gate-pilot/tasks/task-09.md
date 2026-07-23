---
id: task-09
title: change.stages last_dispatch 加 gate_retry_count（exit 1 +1，>=3 升级 exit 2）+ gate_last_errors（exit 1 写摘要，跨 run 持久）
title_zh: gate 重试计数与跨 run 错误
author: qinyi
created_at: 2026-07-10 14:49:30
priority: P0
depends_on: [task-08]
blocks: [task-12, task-13]
requirement_ids: [FR-3, FR-10]
decision_ids: []
allowed_paths:
  - backend/app/modules/change/dispatch.py
provides:
  - contract: change.stages gate fields
    fields: [gate_retry_count, gate_last_errors]
expects_from:
  task-08:
    - contract: auto_dispatch gate decision
      needs: [exit_1_kickback_point]
---

# task-09 gate_retry_count / gate_last_errors

## 目标
exit 1 打回时在 `change.stages last_dispatch` 落 `gate_retry_count`（+1，>=3 升级 exit 2）+ `gate_last_errors`（本 run errors 摘要，跨 run 持久），给 task-08 决策点接线、给 task-12 前端展示读。design §5.4 / §8（第 166-171 行）/ §10 R12。

## 改动点（仅 dispatch.py，task-08 留下的 exit_1_kickback_point）

1. **打回点累加 retry_count**（task-08 exit 1 分支接线处）：
   ```python
   stages = dict(change.stages or {})                      # dict copy 防 in-place mutation
   last_dispatch = dict(stages.get("last_dispatch", {}))   # 同样 copy，:638-645 模式
   count = int(last_dispatch.get("gate_retry_count", 0)) + 1
   if count >= 3:
       # 升级 exit 2：不 complete_stage、不 dispatch 同 stage，返回 gate_blocked 报警人工
       # （R12 死循环防护）——此处只标 retry_count + last_errors，exit 2 的阻断行为走 task-08 exit 2 分支
       ...
   last_dispatch["gate_retry_count"] = count
   last_dispatch["gate_last_errors"] = _truncate(errors)   # 截断防超大
   stages["last_dispatch"] = last_dispatch
   change.stages = stages                                  # 整体赋值标记 dirty
   session.add(change); await session.commit()
   ```
   - `>=3` 判定后：task-08 决策应把本该 exit 1 的打回改判为 exit 2（卡住报警人工，不再 dispatch 同 stage）。task-09 负责计数与升级信号，task-08 消费信号切 exit 2 分支——两任务在打回点交接（depends_on: task-08）。
2. **gate_last_errors 写入**：exit 1 时取本 run `gate_result.errors`（task-07 写入），截断（如每条 ≤500 字符、总条数 ≤10）后写入；exit 0 / exit 2 不写（仅 exit 1 留修复参考）。
3. **跨 run 持久**：errors 落 `change.stages`（非 AgentRun）——exit 1 打回建新 AgentRun，旧 run gate_result 不便关联，新 run/前端读此字段做展示与修复参考（design §8 第 171 行）。

## 不动（零回归）
- exit 0 推进 / exit 2 卡住分支不碰 retry_count / last_errors。
- 不改 last_dispatch 其余字段（stage/user_id/at/config/run_id/status）。
- `_truncate` 内联即可（不抽公共工具，YAGNI）。

## 依赖
- task-08 exit 1 打回点（计数与升级在此接线）。
- task-04 `AgentRun.gate_result.errors`（读源，task-07 写入）。

## acceptance
- exit 1 → `gate_retry_count` 累加（首打回=1，二次=2），`gate_last_errors` 写入截断摘要。
- count >=3 → 升级 exit 2，不再 dispatch 同 stage（报警人工）。
- `gate_last_errors` 跨 run 可读（新 run 读 `change.stages last_dispatch` 见上一轮 errors）。
- dict copy 入库（grep 确认无 `stages["last_dispatch"][...] =` 原地改写；SQLAlchemy 标记 dirty 持久化，不卡丢失）。

## verify
```bash
cd backend && uv run pytest -k gate_retry && uv run ruff check && uv run mypy app
```

## constraints
- dict copy 防 in-place mutation（逐字对齐 dispatch.py:605-617 / :638-645 注释模式：`stages = dict(change.stages or {})` 后整体 `change.stages = stages`）。
- gate_last_errors 截断防超大 JSON（每条 + 总条数上限）。
- 仅 exit 1 写入（exit 0/exit 2 不动）。
- 升级 exit 2 后 retry_count 不再累加（已卡住，无新打回）。
