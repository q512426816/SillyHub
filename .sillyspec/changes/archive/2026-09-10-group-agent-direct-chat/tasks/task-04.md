---
id: task-04
title: 'trigger primitive role_prompt and turn_overrides extension'
title_zh: '触发原语扩展（_trigger_group_member 参数化）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-11 22:17:10
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-1.3]
decision_ids: [D-007@v1]
allowed_paths:
  - backend/app/modules/daemon/group/service/shadow.py
  - backend/app/modules/daemon/group/service/__init__.py
target_files:
  - backend/app/modules/daemon/group/service/shadow.py
  - backend/app/modules/daemon/group/service/__init__.py
provides: "_trigger_group_member(role_prompt=None, turn_overrides=None) 扩展签名，懒建/复用双分支一致写 metadata"
goal: >
  让群成员触发原语支持协作角色：role_prompt 注入 prompt 头部角色段，turn_overrides 附加写入影子 user_input 的 turn_metadata（懒建/复用两分支一致）。
implementation:
  - "shadow.py _trigger_group_member 签名加 role_prompt/turn_overrides 两参数（默认 None 零行为变化）"
  - "懒建分支：_build_group_prompt 头部插入 role_prompt 段（存在时）；turn_metadata 合并 turn_overrides（显式键覆盖）"
  - "复用分支：同上双写（两分支一致，防 metadata 缺失导致投影拦截失效——D-007 硬约束）"
  - "role_prompt 段与现有群 prompt 上下文分隔清晰（空行+独立标记）"
acceptance:
  - "传 role_prompt 后影子 user_input prompt 含角色段文本；不传时与现状逐字节一致"
  - "turn_overrides 键合并进 turn_metadata（不覆盖 source_group_id/source_carrier_run_id 等既有键）"
  - "懒建与复用两分支行为一致（metadata 均含新键）"
verify:
  - "cd backend && uv run ruff check app/modules/daemon/group/service/shadow.py && uv run pytest -q --no-cov app/modules/daemon/tests/test_group_project.py app/modules/daemon/tests/test_group_direct.py"
constraints:
  - "不消费常量（task-02 定义，task-03/06 消费）"
  - "默认参数路径零行为变化"
---

<!-- task-04: 触发原语扩展（_trigger_group_member 参数化）（骨架由 taskcard CLI 预生成，主代理降级直填——环境无子代理） -->
