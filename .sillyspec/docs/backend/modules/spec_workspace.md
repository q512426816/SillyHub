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
- `SpecWorkspaceService.create/get/get_by_id/update/import_from_repo/sync/update_sync_status/build_bundle/apply_sync` + `apply_ops`（增量 ops 落盘；2026-08-14 起支持 `change_dirs` 标注，落盘后事务外触发 change reparse）
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
- **ql-20260813-004**：`_write_spec_root` per-file merge 的 `read_bytes` 遇 staging 成员缺失（tar name 被旧打包方截断等）→ 跳过 + warn 不崩（纵深防御；daemon 侧 LongLink + 排除 runtime(无点) 已根治）
- **ql-20260813-007（P0）**：`_write_spec_root` 跳过 `.runtime/`（任意深度）不入 scan_documents + 两处 decode 后 `.replace('\x00','')` 兜底——根治 sillyspec.db NUL 字节触发 asyncpg 0x00 整批回滚 500。
- **ql-20260813-spec-sync-visibility（P1）**：`sync_manual_get_pending` 返回加 `files_total/files_processed/error/completed_at`（FR-05/FR-06，前端轮询展示「已同步 N 个文件」+ syncing N/M 进度条 + 失败原因 latest.error 透传）。计数列由 daemon `report_change_write_progress` 端点写（D-004 单一写者，complete_change_write 不碰计数列）。
- **apply_ops 触发 scoped reparse（2026-08-14-change-center-conversation-driven / D-005）**：落盘提交成功后（事务外 best-effort，R-04）据 `change_dirs` 标注触发 `ChangeService.reparse`——有标注→scoped（非归档 name）；无标注→扫 ops 路径 `changes/` 前缀兜底；含 `changes/archive/` 路径→全量 reparse（归档=目录跨根移动，scoped 零 delete 语义处理不了）；无 changes 相关路径→零触发（R-01）。reparse 失败仅告警不阻断同步主流程。

## 人工备注
<!-- MANUAL_NOTES_START -->
- **2026-08-14-change-center-conversation-driven**（D-005 / task-02）：`apply_ops` 加 `change_dirs: list[str] | None` 参数（daemon 增量同步标注本次涉及变更目录名）；落盘 commit 后事务外 `_trigger_change_reparse`（独立 session，对齐 `_bump_files_processed` 范式）→ `_compute_reparse_scope`（标注 / ops 路径兜底 / archive_hit 三态）→ `ChangeService.reparse(scope)`。`SpecIncrementalSyncRequest`（schema.py）加 `change_dirs: list[str] = []`（旧 daemon 缺省兼容）。
<!-- MANUAL_NOTES_END -->
