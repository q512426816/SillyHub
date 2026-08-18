---
schema_version: 1
doc_type: module-card
module_id: scan_docs
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 文档扫描索引层（scan_docs）

## 定位
SillySpec「文档扫描」域的解析与落库服务：把工作区 spec 目录下的模块卡片、知识、组件文档等 markdown 解析成 `ScanDocument` 行，作为纯只读索引层（不写文件，只读 + 解析 + upsert 对账）。与 task.parser、knowledge.parser 并列三大 spec 解析器，reparse 入口由 workspace.reparse 统一编排；另承载多端同步覆盖时的冲突历史归档。

## 契约摘要
- 路由（prefix=/workspaces/{wid}，tag=scan-docs）：
  - `GET /scan-docs?q=` 列表（`SCAN_DOCS_READ`；q 对 path/title/content 大小写不敏感搜索；每项带 `conflict_count` 徽章数）
  - `GET /scan-docs/{doc_id}` 详情（含完整 content + conflict_count）
  - `GET /scan-docs/{doc_id}/conflicts` 该路径历史冲突归档（created_at 倒序分页）
  - `POST /scan-docs/reparse` 全量重解析（`WORKSPACE_WRITE`；返回 stats + warnings）
- 数据模型：
  - `ScanDocument`（`scan_documents`）：unique `(workspace_id, path)`；`exists` 软删标志；`content` / `content_hash`；doc_type / title / last_modified_at
  - 来源追踪列（2026-07-01-collaborative-workspace）：`source_member_id` / `source_runtime_id` / `source_synced_at` / `source_mtime`
  - `ScanDocConflictHistory`（`conflict_model.py`）：被覆盖旧版本的归档行（old_content + 新旧来源/mtime），**故意不建 FK**——删用户/运行时不级联丢审计记录
- 解析产物（parser.py）：`ParsedDoc` / `ParseWarning` / `ScanDocsResult`；递归扫 docs 树，按文件名规则推 doc_type、取首个 `#` 标题行作 title（缺失回退文件名）
- 关联服务：`ScanDocConflictService`（conflict_service.py）归档 + 查询冲突历史

## 关键逻辑
```
reparse:
  root = spec_ws.spec_root（任意 strategy 有镜像即读）否则 workspace.root_path
  → component_key? parser.parse_component : parse_docs_tree（均 to_thread）
  → 按 path 对账: 已有→_apply_parsed(updated)、新→_build_row(created)
  → 文件消失→ exists=False + content=None（软删）→ 单事务 commit → stats
list_(q):
  有 q → func.lower()+like+escape 跨方言（PG/SQLite）搜索，转义 %/_/\
  无 q → load_only 排除 content 大列（session 仍 attach，访问 content 懒加载补取）
  conflict_count → 一次 group by 批量算（防列表 N+1）
```

## 注意事项
- 冲突归档 `archive_conflict` 由 spec_workspace 的 apply_sync / reparse 覆盖路径调用（last-write-wins 覆盖前存旧版）；设计 do-not-block——归档失败只告警不阻断主流程；方法本身不 commit，事务边界归调用方
- `add_to_session=False` 变体（ql-20260817-005）：长 FS 循环内逐条 `session.add` 会 autobegin 拉长事务，撞 PG `idle_in_transaction_session_timeout` 被杀连接——须循环外批量 add
- 文件是 source of truth，DB 只是查询索引；reparse 把磁盘状态同步回 DB
- stats 口径：`parsed` 只计 exists=True 行，`deleted` 计本次软删行，二者与 created/updated 互斥
- parser 纯同步纯读、无共享可变状态，`asyncio.to_thread` 线程安全（perf-remediation S1/task-01）
- 旧逻辑只 platform-managed 读 spec_root 会导致 repo-native/repo-mirrored 读 root_path 客户端路径不可达 → DOCS_DIR_MISSING → 文档不显示；现已改为有镜像就读（源码注释留有该背景）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
