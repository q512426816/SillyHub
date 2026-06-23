---
schema_version: 1
doc_type: module-card
module_id: spec_workspace
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:09:00
---
# spec_workspace

## 定位
每个 workspace 对应 spec 空间的管理中枢。提供 SpecWorkspace CRUD、导入/同步、异步 bootstrap（经 AgentRun + ClaudeCodeAdapter 后台跑 sillyspec init/scan）、以及 spec conflict 列表与解决。是 spec 体系的核心协调层。

## 契约摘要
- `GET /api/workspaces/{wid}/spec-workspace` — 详情
- `GET .../spec-workspace/bundle` — 下载 spec bundle（流式）
- `POST .../spec-workspace/import` — 从仓库导入（stub，仅更新 sync_status）
- `POST .../spec-workspace/sync` — 同步（stub）
- `PATCH .../spec-workspace` — 更新配置
- `POST .../spec-bootstrap` — 异步 bootstrap（立即返回 agent_run_id + stream_url）
- `GET .../spec-conflicts` — 列冲突；`POST .../spec-conflicts/{id}/resolve` — 解决冲突
- `SpecWorkspaceService.create/get/get_by_id/update/import_from_repo/sync/update_sync_status/build_bundle/apply_sync`
- `SpecBootstrapService.bootstrap`；`SpecValidator.validate`（目录结构/YAML schema/引用完整性）

## 关键逻辑
```
bootstrap(workspace_id, user_id):
  spec_ws, ws = load(...)
  mkdir spec_root
  AuditLog("spec_bootstrap.start")
  run = AgentRun(status=pending, agent_type="claude_code")
  AgentRunWorkspace(run, workspace); run.status = running
  return {agent_run_id, stream_url, status, spec_root}   # 立即返回
  # [后台] build AgentSpecBundle → ClaudeCodeAdapter.run_with_bundle
  #        → SpecValidator.validate(spec_root) → 据结果更新 run/sync_status/SpecConflict
```

## 注意事项
- workspace 与 SpecWorkspace 为 1:1（workspace_id 唯一索引）
- 三种 strategy：`platform-managed` / `repo-mirrored` / `repo-native`；runtime 模块据此定位 `.runtime/` 目录
- sync_status：`clean` / `dirty` / `conflicted`；import/sync 当前是 stub，只把状态置 clean + 更新时间
- bootstrap 是异步的：创建 AgentRun 后立即返回，前端连 SSE stream 取进度；后台异常时 finally 保证 run 置 failed
- AgentRunLog 分段写入（4000 字符/段，硬编码）防 DB 列溢出；`on_log` 回调每条立即 commit 保证 SSE 回放
- SpecConflict 模型定义在 spec_profile 模块，本模块只提供 CRUD 端点（resolve 直接在 router 操作 session）
- SpecValidator 检查 `.sillyspec/projects/` 目录、YAML 可解析 + 最小 schema、relations.target 引用存在

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
