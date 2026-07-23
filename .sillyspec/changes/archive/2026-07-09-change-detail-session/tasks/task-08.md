---
id: task-08
title: create_session 注入前导（dispatch prompt=前导+用户消息；AgentRunLog 存干净 prompt）
title_zh: 创建会话时注入变更上下文前导
author: qinyi
created_at: 2026-07-09 18:13:10
priority: P0
depends_on: [task-04, task-07]
blocks: [task-10]
requirement_ids: [FR-03]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
expects_from:
  task-07:
    - contract: build_change_context_preamble
      needs: [returns_str]
goal: >
  create_session 在 change_id 非空时，dispatch prompt = 前导+用户消息（X-02 纯后端）；AgentRunLog(user_input) 仍写干净用户 prompt（列表标题/回放干净，X-04）。
implementation:
  - 在 create_session 写 AgentRunLog(user_input) 之前/之后：dispatch_prompt = preamble + "\n\n---\n\n" + prompt if preamble else prompt
  - 调 prepare_interactive_dispatch 传 dispatch_prompt（而非 prompt）
  - AgentRunLog(channel=user_input, content_redacted=prompt[:5000]) 保持写干净 prompt（不变）
  - 首个 AgentRun 的 change_id 也写入（与 session.change_id 一致），保证 run 维度统计可按变更聚合
acceptance:
  - 带 change_id 会话：daemon 收到 dispatch prompt 含前导；user_input 日志为干净用户消息
  - 未带 change_id：dispatch prompt = 用户消息（零回归）
verify:
  - cd backend && uv run mypy app/modules/daemon/session/service.py
  - cd backend && uv run pytest backend/app/modules/daemon/session/ -q
constraints:
  - 零 daemon 改动（前导经 prompt 通道，非 system_prompt 字段）
  - 不污染 user_input 日志与列表标题
---

## 验收标准
- 带 change_id 会话：daemon 收到 dispatch prompt 含前导；user_input 日志为干净用户消息
- 未带 change_id：dispatch prompt = 用户消息（零回归）
- 首个 AgentRun 的 change_id 与 session 一致

## 验证步骤
- cd backend && uv run mypy app/modules/daemon/session/service.py
- cd backend && uv run pytest backend/app/modules/daemon/session/ -q
