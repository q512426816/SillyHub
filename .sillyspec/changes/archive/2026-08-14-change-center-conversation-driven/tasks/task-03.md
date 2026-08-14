---
id: task-03
title: backend review methods remove auto-dispatch + projection convergence
title_zh: 审批四方法删派发 + 投影收敛
author: qinyi
created_at: 2026-08-14 15:46:49
priority: P0
depends_on: []
blocks: [task-04]
requirement_ids: [FR-05c]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/schema.py
  - backend/app/modules/change/tests/test_review_dispatch_removal.py
provides:
  ReviewResponse:
    fields: [change, agent_dispatch]
goal: >
  让审批通过/打回只落审批记录 + 阶段状态，不再自动派发 agent（D-004）；并在审批推进阶段时
  upsert platform_change_progress 使读时投影立即收敛（消除回显旧阶段/重复审批窗口）。不动注入
  （task-04 做），只做「不派发 + 投影收敛」两件事。
implementation:
  - backend/app/modules/change/service.py：review 四方法（proposal_review/plan_review/human_test/
    archive_confirm，service.py:1512 附近 proposal_review 现经 transition_with_dispatch 派发）删除
    审批通过后的自动派发调用。decision=approve/通过类时：只推进阶段（落 ux_changes.current_stage +
    pending_review）不调 dispatch；decision=打回类（revise/replan/back_to_propose/back_to_brainstorm/
    bug/doc_mismatch）：只回退阶段/打回状态不派发。返回结果中 agent_dispatch 相关字段置 null/空。
  - 审批推进阶段时同步 upsert platform_change_progress（source=platform，stage=新阶段，change_name=
    change 的 key，workspace 隔离字段按现有 PlatformChangeProgress 模型）。参考 platform_sync/service.py
    现有 upsert 语义（change/service.py enrich 投影读 latest_progress 的逻辑在 :1259-1271）。
  - 保持兼容：打回类 decision 回退逻辑与现状一致（只删派发，不改回退目标）。
acceptance:
  - 四个审批端点通过后不再触发任何 dispatch（无新 AgentRun/无 mission）
  - 审批通过推进阶段后，读侧 current_stage 立即为新阶段（latest_progress 已 upsert 收敛）
  - 打回类 decision 仍正确回退阶段，且不派发
  - 新增测试覆盖：审批通过不派发、投影收敛（latest_progress 更新）、打回不派发
  - ruff format + ruff check + mypy 通过；相关既有测试修复不删断言
verify:
  - cd backend && uv run pytest app/modules/change -q --no-cov
  - cd backend && uv run ruff format --check app/modules/change && uv run ruff check app/modules/change && uv run mypy app/modules/change
constraints:
  - 只动 change/service.py + schema（如有）+ 新测试；不碰 agent 派发机制（task-04 才做注入）
  - 不删现有 decision 合法值；打回映射保持既有语义
  - 投影收敛 upsert 失败不阻断审批主流程（best-effort 或按现有 platform_sync 容错）
  - 未上线，无需历史数据回填
---
