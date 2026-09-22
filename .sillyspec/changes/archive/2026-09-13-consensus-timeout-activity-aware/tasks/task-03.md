---
id: task-03
title: 'new test_group_consensus_activity.py covering extension/cap/no-activity/dedup/reason'
title_zh: '新增 test_group_consensus_activity.py（续期/硬上限/无活动/去重/文案 6 用例）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-13 20:06:00
priority: P1
depends_on: [task-01, task-02]
blocks: []
requirement_ids: [FR-1, FR-2, FR-3, FR-4, FR-5]
decision_ids: [D-2, D-3]
allowed_paths:
  - backend/app/modules/daemon/tests/test_group_consensus_activity.py
target_files:
  - NEW:backend/app/modules/daemon/tests/test_group_consensus_activity.py
goal: >
  六用例覆盖 AC-1~5：续期触发/硬上限两分支/无活动立即收口/快照去重/同名确定性
  与卡面区分/终态卡逐成员结局（含汇总人）。
implementation:
  - 测试基线照 test_group_consensus.py 现有 fixture/env 造数范式（_make_group_env 同源）
  - 用例①：造 open 任务 deadline 过期 + pending 成员影子最新 run status=running → consensus_sweep_once 后任务仍 open、deadline 顺延、卡面含「仍在工作，已延长等待」
  - 用例②：续期后 deadline 已超 hard_cap（created_at+timeout+600s）→ 不再顺延，有 delivered 走 timeout 收口注入 / 零 delivered 走 aborted 两断言
  - 用例③：全员 run 终态 + 时间线最后行 timestamp=now-3min → 立即原路径收口（无续期调用痕迹，可 monkeypatch is_active 计数）
  - 用例④：create_consensus_task 入参 collaborators 含重复 id → 快照去重
  - 用例⑤：同名成员多行 @ 解析命中 joined_at 最早；卡面 content 名字含 id 前 6 位区分
  - 用例⑥：aborted/timeout 终态卡 content 含逐成员结局（含汇总人自身）与截断
verify:
  - cd backend && uv run pytest -q --no-cov app/modules/daemon/tests/test_group_consensus_activity.py
acceptance:
  - 6 用例全绿且断言到行为（非仅不抛异常）
  - ruff/mypy 新文件零告警
constraints:
  - 不改被测源码迁就测试（发现 bug 修源码）
  - 时间相关用例用可控时间注入（不依赖真实 sleep）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。 -->
