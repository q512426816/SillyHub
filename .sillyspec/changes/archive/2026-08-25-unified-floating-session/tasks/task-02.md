---
id: task-02
title: 'inject page preamble into create path with tests'
title_zh: 'create 路径注入页面前导与后端测试'
author: 'qinyi'
created_at: 2026-08-25 03:14:30
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-5]
decision_ids: [D-005]
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/tests/test_page_context_preamble.py
goal: >
  把页面上下文前导接进既有 create 轮前导链（变更前导 → 页面前导 → 团队简报），
  保持展示层干净契约。
implementation:
  - router.py create 端点透传 page_context 给 service
  - service.create_session 签名 += page_context，_prefix_parts 插入页面前导
  - 新增测试：构建器 3 用例 + create 拼接 2 用例（AgentRunLog user_input 干净断言）
acceptance:
  - 前导链顺序 [变更前导, 页面前导, 团队简报] 过滤 None 拼接
  - AgentRunLog(user_input) 与 SESSION_INJECT 展示 payload 仍为用户原文
  - daemon 模块既有测试零回归
verify:
  - cd backend && python -m pytest app/modules/daemon/tests -x -q
constraints:
  - 不改 dispatch_prompt 既有拼接语义
  - 不动 inject 路径（v2 范围）
---
# task-02 create 路径注入

复用既有 X-02 纯后端机制。
