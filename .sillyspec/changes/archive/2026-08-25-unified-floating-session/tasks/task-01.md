---
id: task-01
title: 'backend page-context schema and preamble builder'
title_zh: '后端 page_context schema 与页面上下文前导构建器'
author: 'qinyi'
created_at: 2026-08-25 03:14:30
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-5]
decision_ids: [D-005]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/session/context.py
goal: >
  为创建会话提供服务端可信的页面上下文通道：page_key 枚举 + 实体 id，
  前导数据全部来自 DB 回查，防客户端伪造注入。
implementation:
  - schema.py 新增 PageContextCreateBlock（page_key Literal["ppm_project"]、project_id UUID）
  - SessionCreateRequest 增可选字段 page_context（缺省 None 零回归）
  - context.py 新增 build_page_context_preamble：回查 ProjectMaintenance，产出【页面上下文】多行文本；单值 120 截断；查无/无入参返回 None
acceptance:
  - 非法 page_key 请求 422
  - page_context=None 或查无项目 → 前导 None（不注入）
  - 命中产出含项目名/编码/状态的【页面上下文】文本
verify:
  - cd backend && python -m pytest app/modules/daemon/tests/test_page_context_preamble.py -x
constraints:
  - 不改 daemon 协议与 lease 生命周期
  - 前导无客户端自由文本字段
---
# task-01 后端 page_context schema 与前导构建器

照 build_change_context_preamble 先例模式实现（design §4）。
