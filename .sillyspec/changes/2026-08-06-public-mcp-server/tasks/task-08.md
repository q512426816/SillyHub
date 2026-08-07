---
id: task-08
title: 据 spike-B 结果修 execution.py:14-23 docstring + 补通传递链/拆 tool_config 二义 key
title_zh: read_only 物制传递链厘清与 docstring 修正
author: qinyi
created_at: 2026-08-06 14:03:02
priority: P0
depends_on: [task-07]
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-005@v2]
allowed_paths:
  - backend/app/modules/agent/execution.py
  - sillyhub-daemon/src/adapters/stream-json.ts
  - backend/app/modules/daemon/lease/context.py
provides: []
expect_from: []
related_tests:
  - path: sillyhub-daemon/tests/
    reason: 改 stream-json.ts 与 backend→daemon 传递链可能影响现有 worker 工具治理/lease 测试（跨子项目，不在 allowed_paths，execute 时一并跑）
goal: >
  据 task-07 spike-B 端到端实测结论厘清 read_only 物制传递链：链已通则仅修 execution.py:14-23 过时 docstring；链断则补通 backend→daemon metadata 下发并在必要时拆 tool_config 二义 key，使 read_only worker 真被 daemon SDK --allowedTools 限成 Read/Glob/Grep（D-005@v2 单腿物制）。
implementation:
  - 读 task-07 spike-B 实测记录判定传递链通断，据此二选一定本 task 实际范围，不臆测扩大
  - 分支A 链已通 只改 execution.py:14-23 docstring，删除「v1 工具治理=不强制 daemon does NOT apply it」过时表述，改写为 daemon stream-json.ts 已消费 toolConfig.allowed_tools 经 --allowedTools 物制（对齐 R-02 单腿现状）
  - 分支B 链未通 补通 backend 写入 metadata 的 tool_config 到 daemon 消费链（经 daemon/lease/context.py 解析 + stream-json.ts buildArgs 落 --allowedTools），必要时拆 tool_config 为 tool_governance 结构体（mode/allowed_tools/max_turns 给 buildArgs）与 credential_config env map（types.ts:186 凭据注入）两键消除同 key 两处消费冲突
  - 回归确认 worker_tool_config(read_only) 的 allowed_tools 端到端落到 claude --allowedTools
acceptance:
  - 链已通路径 execution.py:14-23 docstring 不再含「不强制」表述，与 stream-json.ts:333-337 实际消费一致
  - 链未通路径 补通/拆键后 read_only worker 实测仅能用 Read/Glob/Grep 写工具被 SDK 拒绝（复跑 task-07 用例通过）
  - tool_config 若拆键 后端写结构体与 daemon env map 两路消费互不冲突，types.ts:186 与 buildArgs 各取所需
verify:
  - cd backend && uv run pytest app/modules/agent -q --no-cov
  - cd sillyhub-daemon && pnpm test
constraints:
  - 范围由 task-07 spike-B 结论二选一定，链通仅修 docstring，链断才补通+拆键
  - 不改 dispatch_worker 业务逻辑（read_only 落记录归 task-09，绑 profile 归 task-10）
  - 不动 tool_gateway ToolPolicy（CC-02 证实与 claude worker 物制正交）
  - daemon 测试在 sillyhub-daemon/tests 跨子项目不在 allowed_paths 在此声明 execute 时跑
---
