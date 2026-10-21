---
id: task-15
title: 'Clear R-12 exemption and run full regression closure (incl. FR-23 rerun)'
title_zh: 'R-12 豁免清理 + 全量回归收口（含 FR-23 四例复跑）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-21 14:49:18
priority: P0
depends_on: [task-11, task-12, task-13, task-14]
blocks: []
requirement_ids: [FR-23]
decision_ids: [D-021@v1]
allowed_paths:
  - .sillyspec/local.yaml
  - frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
  - backend/app/modules/daemon/tests/test_session_model_usage.py
target_files:
  - .sillyspec/local.yaml
goal: >
  收口前必须拆掉两个「看起来绿」的遮蔽：①仓根 `.sillyspec/local.yaml` 的 `known_failures` 里为本变更在途 WIP 登记的
  `turn-segment-views.test.tsx` 临时豁免（R-12，2026-10-21 由并行的 mobile-scan-birth-cleanup 会话登记）；②FR-23 的
  backend 4 例自落盘以来未复跑。本卡移除豁免、复跑全量面，并把实测数字回写 tasks.md。
implementation:
  - '读仓根 `.sillyspec/local.yaml:72`（`known_failures:` 列表）并删除 `:84` 的 `- ''turn-segment-views.test.tsx''` 整行（含其行尾注释）；删后确认 YAML 仍合法（`python -c "import yaml,sys;yaml.safe_load(open(r''.sillyspec/local.yaml'',encoding=''utf-8''))"`）'
  - '复跑 `frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx`（期望 93/93 绿）——不再有豁免兜底，红就是真红'
  - '复跑 FR-23：`cd backend && uv run pytest -q --no-cov app/modules/daemon/tests/test_session_model_usage.py`（期望 4 例绿），结果写回 tasks.md task-04 证据'
  - '全量回归：①`cd frontend && node node_modules/typescript/bin/tsc --noEmit` ②`cd frontend && pnpm lint` ③本变更前端测试面（file-changes 新增两套 + 卡片 8 例 + 轨迹 56 例 + 线 A 191 例）④`cd sillyhub-daemon && node node_modules/vitest/vitest.mjs run tests/interactive/` ⑤`cd backend && uv run pytest -q --no-cov app/modules/daemon/tests/` ⑥`cd backend && uv run ruff check app && uv run mypy app`'
  - '把各项实测数字（例数 / 退出码）写回 tasks.md 对应任务证据行；与 SC-08 基线（208 例 / 9 文件）对账，只许多不许少'
acceptance:
  - '`.sillyspec/local.yaml` 的 `known_failures` 不再含 `turn-segment-views.test.tsx`（`Select-String` 零命中），且 YAML 可解析'
  - '`turn-segment-views.test.tsx` 93/93 绿（无豁免口径）'
  - 'FR-23 backend 4 例全绿'
  - 'tsc / next lint / ruff / mypy 退出码 0；daemon `tests/interactive/` 与 backend daemon 域测试全绿'
  - '实测数字已回写 tasks.md，SC-08 基线对账无缺口'
verify:
  - Select-String -Path .sillyspec/local.yaml -Pattern "turn-segment-views" -SimpleMatch
  - cd frontend && node node_modules/vitest/vitest.mjs run src/components/daemon/__tests__/turn-segment-views.test.tsx
  - cd backend && uv run pytest -q --no-cov app/modules/daemon/tests/test_session_model_usage.py
constraints:
  - 只删自己这一条豁免，不动 `known_failures` 里其它条目（多为他变更/工具缺陷 workaround）
  - 不修改任何源码或测试来「让全量绿」；红了就回对应任务修（CLAUDE.md：修逻辑不修测试）
  - 全量跑批输出重定向到 `.sillyspec/.runtime/logs/` 只取摘要（长输出不进上下文）
related_tests:
  - path: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
    reason: 本卡移除该文件的临时豁免，是「真实失败可见」的唯一开关
  - path: backend/app/modules/daemon/tests/test_session_model_usage.py
    reason: FR-23 的 4 例自落盘未复跑，本卡必须实测并回写
---
