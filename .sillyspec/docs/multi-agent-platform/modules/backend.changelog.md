# backend 变更索引

> 自动生成。正文历史已迁出，详见 backend.md。

- ql-20260826-007-8666 | workspace slug 创建后锁定不可变：errors.py 新增 `WorkspaceSlugImmutable`(400 HTTP_400_WORKSPACE_SLUG_IMMUTABLE)；service.update 删 slug 唯一性预检改为「显式传不同值即 400，同值幂等放行」（slug 是 mirror 目录名/lease 元数据稳定键），R14 并发注释收紧为仅 root_path（uq_workspaces_slug 不再可能触发）；WorkspaceUpdate docstring 同步。test_router 旧 409 冲突用例改写为不可变 400（占用/未占用双断言）+ 新增同值 no-op 200；gen:types 同步 openapi.json/api-types.ts（仅描述透传，形状零变化）。
- ql-20260825-009-ca4d | 团队任务简报注入 workspace root_path——collect_single_workspace_status/render_scope_brief/render_session_orchestrator_briefing 渲染行加 path= 字段 + ScopeWorkspaceStatus DTO 加 root_path，主控 agent 可只读调研定位；简报 token 预算 1500→1600。
