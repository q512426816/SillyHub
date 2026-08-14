---
id: task-12
title: module docs sync + in-flight change baseline reconciliation
title_zh: 模块文档同步 + 在途变更基线核对
author: qinyi
created_at: 2026-08-14 15:46:49
priority: P1
depends_on: [task-11]
blocks: []
requirement_ids: [FR-06b]
decision_ids: [D-001@v1, D-005@v1, D-006@v2]
allowed_paths:
  - .sillyspec/docs/backend/modules/change.md
  - .sillyspec/docs/backend/modules/spec_workspace.md
  - .sillyspec/docs/backend/modules/agent.md
  - .sillyspec/docs/backend/modules/mcp_gateway.md
  - .sillyspec/docs/backend/modules/change_writer.md
  - .sillyspec/docs/backend/modules/daemon.md
  - .sillyspec/docs/backend/modules/_module-map.yaml
goal: >
  文档收尾：模块文档同步本次变更语义（审批不派发/投影收敛/scoped reparse 零删除/change_session_links
  绑定/change_dirs 标注/会话页/端点删除）+ 核对在途 spec-sync-visibility 改动零回退。
implementation:
  - 更新 backend 模块文档：change.md（reparse scoped/审批不派发/投影收敛/change_session_links 绑定）、
    spec_workspace.md（apply_ops 触发 scoped reparse + change_dirs 接收）、agent.md（agent-sessions
    include_ended）、mcp_gateway.md（submit_stage_review 契约）、change_writer.md（端点删除）、
    daemon.md（spec-sync change_dirs 标注，daemon 模块文档在 backend 侧或 sillyhub-daemon 侧按现状）
  - _module-map.yaml：如相关模块符号变更（reparse 签名/新模型 ChangeSessionLink），按增量更新惯例
    补登/更新（参照 last_change 段历史做法）
  - 核对 git status：spec_workspace/service.py + spec-sync.ts 与在途 2026-08-13-spec-sync-visibility
    未提交改动是否零回退（其 W4 进行中）；本变更 commit 用 pathspec 隔离，不裹挟其改动
  - 文档头部保留 author/created_at（精确到秒）
acceptance:
  - 各模块文档同步本次变更语义，与 design/代码一致
  - _module-map.yaml 增量更新（如有符号变更）
  - 在途 spec-sync-visibility 已 commit 改动零回退（git diff 核对）
verify:
  - git diff --stat 核对 spec_workspace/service.py + spec-sync.ts 仅含本变更（或含其 W4 未提交部分，两者共存）
  - 文档 markdown 结构完整（无语法损坏）
constraints:
  - 文档与代码一致性（execute 验收标准）
  - 不回退在途变更改动（design §1 基线声明）
  - 文档头部规范（author/created_at）
---
