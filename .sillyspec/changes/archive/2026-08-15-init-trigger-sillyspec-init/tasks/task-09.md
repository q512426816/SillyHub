---
id: task-09
title: backend apply_ops 同 hash no-op
title_zh: 增量同步冲突分支加同内容豁免：op.hash == row.content_hash → 跳过不 conflict，new_versions 回 row.version
author: qinyi
created_at: 2026-08-15 16:06:52
priority: P0
depends_on: []
blocks: [task-10]
requirement_ids: [FR-05]
decision_ids: [D-008@v2]
allowed_paths:
  - backend/app/modules/spec_workspace/service.py
  - backend/app/modules/spec_workspace/tests/test_apply_ops_same_hash_noop.py
goal: >
  apply_ops（service.py:1105-1111 冲突分支）在 row.version != op.base_version 时增加豁免：op.hash 非空且 sha256 hex 且 == row.content_hash → 视为同内容 no-op——跳过落盘、不置 conflict、new_versions[op.path] = row.version（daemon manifest 对齐，buildManifestFromLocal 据此回写缓存）。op.hash 缺失（旧 daemon）或与 content_hash 不符 → 维持现状 conflict。
implementation:
  - 冲突分支前置判断：`if row is not None and row.version != op.base_version:` 内先查 `op.hash and op.hash == row.content_hash` 命中 → new_versions[path]=row.version; continue（不算 conflict、不落盘）
  - docstring（~:1037 语义段）同步补 no-op 豁免描述
  - 注释标注决策来源 D-008@v2 与场景（init 骨架第二成员 add）
acceptance:
  - 版本不匹配 + hash 相同 → conflict=False，new_versions 回服务器版本，清单行不变
  - 版本不匹配 + hash 不同 → 仍 conflict=True
  - 不传 hash（旧 daemon 契约）→ 行为与现状一致（conflict）
  - 既有 apply_ops 用例全绿（无回归）
verify:
  - cd backend && uv run pytest app/modules/spec_workspace -q --no-cov
constraints:
  - FileOp schema 不变（hash 字段已存在 schema.py:98）；请求/响应契约零变更
  - no-op 仅内容相同场景，hash 是 sha256 不可伪造内容（R-07）
---
