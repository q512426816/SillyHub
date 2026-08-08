---
id: task-08
title: 新增 test_dispatch_worker_caller_worktree.py（路径A：worktree_path 短路自建 + 不写 worktree_branch + worker_prompt 覆写 + 入口透传）
title_zh: dispatch_worker caller-worktree 路径A 单测
author: qinyi
created_at: 2026-08-08 17:39:23
priority: P0
depends_on: [task-02, task-04]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-10]
decision_ids: [D-001@v1, D-008@v1, D-009@v1]
allowed_paths:
  - C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\agent\tests\test_dispatch_worker_caller_worktree.py
provides:
  - contract: caller-worktree 路径A 分支契约（worktree_path→root_path 短路 + 不写 worktree_branch + worker_prompt 覆写 + 入口透传）
expects_from:
  - task: task-02
    contract: dispatch_worker 加 worktree_path/branch/worker_prompt 三可选参 + :190 自建 if 加 `and not worktree_path` + 路径A 不写 run.worktree_branch + :245 prompt=worker_prompt or render_worker_prompt
  - task: task-04
    contract: mcp_gateway/tools.py dispatch_worker 加三参透传（链路B）
goal: >
  固化路径A 分支：caller 传 worktree_path → 不调 git_worktree_add + root_path=worktree_path + 不写 run.worktree_branch（P0-1 防御②）+ worker_prompt 替代 render（AC-01）；
  mcp_gateway tools.dispatch_worker 三参透传 execution（AC-03）。
implementation:
  - 直接复刻 test_dispatch_worker_worktree.py 的 _make_workspace/_make_worker/_make_delegate_mock（HostFsDelegate MagicMock，git_worktree_add AsyncMock）+ MissionExecutionService(db_session, placement=fake_placement, host_fs_delegate=delegate)。
  - "AC-01：svc.dispatch_worker(run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False, worktree_path=\"/tmp/repo/.sillyspec/.runtime/worktrees/abc12345\", branch=\"sillyspec/2026-08-08-x\", worker_prompt=\"绝不 commit 不越界\") → delegate.git_worktree_add.assert_not_awaited()；dispatch_to_daemon kwargs[\"root_path\"]==该 worktree_path（≠ ws.root_path）；kwargs[\"prompt\"]==worker_prompt（完全替代 render）；refresh 后 run.worktree_branch is None（D-008）；spy kwargs 能观测 caller branch（字段名依 task-02 实现，勿绑死）。"
  - "AC-01 回归对照：不传 worktree_path（None）+ 注入 delegate → 仍 git_worktree_add assert_awaited_once + worktree_branch 填值（对齐 test_dispatch_worker_worktree AC-01，确认短路是分叉）。"
  - "AC-03 mcp_gateway 入口（复刻 test_tools_new.py _make_ctx/_make_token，scope=[MCP_SCOPE_DISPATCH]）：monkeypatch.setattr MissionExecutionService, \"dispatch_worker\" 为 AsyncMock(return_value=uuid.uuid4()) spy；await tools.dispatch_worker(mission_id=mission.id, objective=\"o\", worktree_path=\"/tmp/wt\", branch=\"sillyspec/x\", worker_prompt=\"不 commit\", ctx=ctx)；spy.assert_awaited_once() 且 kwargs 含 worktree_path/branch/worker_prompt 三键原值。替换后不走真 daemon/worktree。"
acceptance:
  - 传 worktree_path → git_worktree_add 不调 + root_path=worktree_path + run.worktree_branch=None + worker_prompt 进 prompt（AC-01，R-01 防御②③）。
  - 不传三参（None）+ 注入 delegate → 原自建 worktree 路径不变（零回归）。
  - mcp_gateway tools.dispatch_worker 三参原样透传 execution.dispatch_worker（AC-03）。
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_dispatch_worker_caller_worktree.py -q --no-cov
  - cd backend && uv run pytest app/modules/agent -q --no-cov --deselect app/modules/agent/tests/test_dispatch_metadata.py::test_build_claim_payload_propagates_bundle_fields --deselect app/modules/agent/tests/test_execution_context.py::test_get_execution_context_task_run
constraints:
  - 只新增测试不改 src（task-02/04 已落实现）；红 = 实现缺陷回 src（规则 11）。
  - AC-03 用 monkeypatch 替 dispatch_worker spy 验透传，勿真起 daemon；branch 断言不绑死 kwarg 名。
---
