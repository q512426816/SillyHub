---
id: task-02
title: backend incremental trigger scoped reparse zero-delete + change-session binding
title_zh: backend 增量触发 + scoped reparse 零删除 + 变更-会话绑定
author: qinyi
created_at: 2026-08-14 15:46:49
priority: P0
depends_on: [task-01]
blocks: [task-04]
requirement_ids: [FR-01b, FR-01c, FR-01d, FR-02]
decision_ids: [D-005@v1, D-007@v1]
allowed_paths:
  - backend/app/modules/spec_workspace/schema.py
  - backend/app/modules/spec_workspace/service.py
  - backend/app/modules/change/service.py
  - backend/app/modules/change/parser.py
  - backend/app/modules/change/model.py
  - backend/alembic/versions/20260814_add_change_session_links.py
  - backend/app/modules/spec_workspace/tests/test_incremental_reparse_trigger.py
  - backend/app/modules/change/tests/test_reparse_scoped_zero_delete.py
  - backend/app/modules/change/tests/test_change_session_binding.py
provides:
  SpecIncrementalSyncRequest.change_dirs:
    fields: [change_dirs]
  ChangeService.reparse:
    fields: [scope]
  ChangeSessionLink:
    fields: [id, change_id, session_id, created_at]
goal: >
  命门全链（P1）：增量同步落盘后触发 scoped reparse（零删除守卫），使 agent 会话新建的变更自动
  出现；reparse 发现新变更时自动绑定最近活跃会话（change_session_links 新表）。蓝图拆三步执行
  （02a schema+apply_ops 触发+兜底；02b parser 过滤+reparse 零删除守卫；02c ChangeSessionLink
  模型+migration+绑定查询）。
implementation:
  # 02a 接收标注 + apply_ops 触发（含兜底/归档走全量）
  - spec_workspace/schema.py：SpecIncrementalSyncRequest（:104-107，现仅 ops）加 `change_dirs: list[str] = []`
  - spec_workspace/service.py：apply_ops（:914）落盘后（事务外 best-effort）触发 change reparse：
    a) 有 change_dirs 标注 → scoped reparse（scope=change_dirs 中非归档的 name；其中含 `changes/archive/`
    前缀的 name 并入全量重扫集）；b) 无标注（旧 daemon）→ 扫本次 ops 路径中 `changes/` 前缀者取 name
    兜底；c) 本次 ops 含 `changes/archive/` 路径 → 全量 reparse（归档=目录跨根移动，scoped 零删除
    语义处理不了）。reparse 失败仅告警，不阻断同步主流程。注意同步失败不重复触发（幂等）。
  # 02b scoped reparse 零删除守卫
  - change/parser.py：parse_workspace 支持按 key 集合过滤（或 service 层对解析结果过滤，二选一，
    以改动最小为准）。parse_workspace 现仅支持全量扫描（parser.py:74-124），需支持 scope 参数。
  - change/service.py：ChangeService.reparse 加 `scope: list[str] | None = None` 参数。scope=None 全量
    （含 delete，现状语义不变，:1139-1143）；scope=[...] 时只做 create/update，**零 delete**（scope 外
    变更不进 parsed 集合也不判删除；scope 内 key 磁盘确认消失也不删，留全量/手动重扫描收敛）。
  # 02c ChangeSessionLink 模型 + migration + 绑定
  - change/model.py：新增 ChangeSessionLink 模型（id UUID PK / change_id FK changes ON DELETE CASCADE /
    session_id FK agent_sessions ON DELETE CASCADE / created_at timestamptz），unique(change_id, session_id)。
  - alembic 迁移：建表（upgrade create_table / downgrade drop，对称可逆）。revision 时间戳命名，
    down_revision 执行前 alembic heads 确认（多 head 先 merge，478e8976 惯例）。
  - change/service.py：reparse 发现新变更（created）时，按绑定查询取该 workspace 最近活跃会话：
    `SELECT s.id FROM agent_sessions s WHERE s.workspace_id=:wid AND s.deleted_at IS NULL
    ORDER BY coalesce(s.last_active_at, s.created_at) DESC LIMIT 1`，写 change_session_links。
    绑定写入失败不阻断 reparse 主流程。
acceptance:
  - 增量同步（含 change_dirs 标注或兜底前缀检测）后，agent 新建的变更自动出现在 ux_changes 列表
  - scoped reparse 零删除：范围外变更/范围内磁盘消失的变更均不删行；删除仅全量/手动重扫描
  - 归档路径（changes/archive/）同步触发全量 reparse（非 scoped）
  - 新变更自动绑定最近活跃会话（change_session_links 有行）；绑定失败不阻断 reparse
  - 无标注旧 daemon 走兜底路径，行为等价
  - 迁移 upgrade/downgrade 可逆；ruff/mypy/pytest 通过
verify:
  - cd backend && uv run alembic upgrade head && cd backend && uv run alembic downgrade -1 && uv run alembic upgrade head
  - cd backend && uv run pytest app/modules/spec_workspace app/modules/change -q --no-cov
  - cd backend && uv run ruff format --check app/modules/spec_workspace app/modules/change && uv run ruff check app/modules/spec_workspace app/modules/change && uv run mypy app/modules/spec_workspace app/modules/change
constraints:
  - scoped 零删除是红线（Grill P0 R-08），必须测试覆盖（范围外/范围内消失均不删）
  - reparse 在 apply_ops 事务外 best-effort（R-04），失败仅告警不阻断同步
  - 归档路径命中走全量（R/D-3），scoped 只增不删处理不了跨根移动
  - 绑定查询语义固定（§8 SQL：deleted_at IS NULL、coalesce desc、跨成员、不限 status）
  - 与在途 spec-sync-visibility 在 spec_workspace/service.py 改点重叠：功能共存不回退
---
