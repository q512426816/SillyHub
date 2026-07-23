---
id: task-04
title: execution.render_worker_prompt 加约束（只写代码不跑 test/build、必 git add+commit、按文件分工）+ 单测
title_zh: worker prompt 加 worktree 协作约束 + 单测
author: qinyi
created_at: 2026-07-13 00:32:41
priority: P0
depends_on: []
blocks: [task-08]
requirement_ids: [FR-02]
decision_ids: [D-002@v1, D-003@v1]
allowed_paths:
  - backend/app/modules/agent/execution.py
  - backend/app/modules/agent/tests/test_render_worker_prompt.py
goal: >
  render_worker_prompt 加三条约束（只写代码不跑 test/build、完成后必 git add -A && git commit、按文件分工减冲突），引导 worker 在副本内产出可合并的 commit。
implementation:
  - 读 execution.py render_worker_prompt(:65)
  - 在 prompt 末尾追加约束段（中文）：① 只写代码不跑测试/构建（验证留主 agent 合并后统一跑）② 完成后必须 git add -A && git commit（为分支合并）③ 按文件分工减少 converge 冲突
  - 单测断言 prompt 含三约束关键词（"不跑测试"/"git add"/"git commit"/"分工"）
acceptance:
  - worker prompt 含三条约束文案
  - 既有 prompt 内容（objective/role 渲染）不丢
  - 单测绿
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_render_worker_prompt.py -q
  - cd backend && uv run ruff check app/modules/agent/execution.py
constraints:
  - 仅改 prompt 渲染，不改 dispatch_worker 调度逻辑
  - 约束用中文（CLAUDE.md 中文优先）
  - 不引入新依赖
---
