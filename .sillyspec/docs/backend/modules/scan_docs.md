---
schema_version: 1
doc_type: module-card
module_id: scan_docs
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 扫描文档入库（scan_docs）

## 定位
`.sillyspec/docs/` 扫描文档的解析与 DB 化层 + 被覆盖版本的冲突历史归档。reparse 把文档树读进 `ScanDocument` 表供列表/详情查询（读走 DB、只有 reparse 碰文件系统）；`ScanDocConflictHistory` 提供归档原语，由 spec_workspace 在覆盖文件时调用留审计痕迹——模块名里的「冲突」指这份历史归档，不是在线冲突检测。

## 契约摘要
- `GET /api/workspaces/{workspace_id}/scan-docs` → 文档列表（读 DB；带每文档冲突计数，`_count_conflicts_batch` IN 预取避免 N+1）。
- `GET .../scan-docs/{doc_id}` → 单文档详情（含 content）。
- `GET .../scan-docs/stats` → `ScanDocsStatsOut` 运营指标（2026-09-21-scan-docs-ops-panel）：四指标——覆盖率两级（七件套 std_have/std_expected + 模块文档 module_have/module_expected，前端合并算综合百分比，带近 8 周趋势 trend）/ 陈旧清单 stale_docs（mtime 为空或超 90 天，最旧在前、上限 200）/ 密度 density.per_project_avg / 新鲜 freshness.recent_updated·total（近 30 天）；双榜——recent_board（mtime 非空降序 Top 10）+ injection（近 30 天 docs-inject 注入频次：total_30d/docs_hit_30d/board Top 10，旧 CLI 无遥测返回全零值前端空态）。单表 `scan_documents` 轻列查询（排除 content）后全内存聚合；路由注册序上字面量 stats 必须保持在 `{doc_id}` 通配之前（design R-03）。
- `GET .../scan-docs/{doc_id}/conflicts` → 该文档 path 的冲突历史，新→旧，limit/offset 分页（默认 50）。
- `POST .../scan-docs/reparse` → 重扫文件系统，返回 `({parsed, created, updated, deleted}, ScanDocsResult)`。
- 解析范围：docs 树递归 `.md` / `.yaml` / `.yml`；yaml 的 doc_type 取文件名 stem，md 按 `_doc_type_from_filename` 推断；`ScanDocsResult` 带告警（如 `DOCS_DIR_MISSING`）。父工作区（component_key 空）扫全树，子组件工作区只扫该组件子树（`parse_component`）。

## 关键逻辑
```
reparse:
  root = spec_ws.spec_root（有镜像就读，兜底 workspace.root_path）
  result = asyncio.to_thread(parser.parse_docs_tree | parse_component)  # FS 重 IO 不进事件循环
  按 path 对账 existing 行:
    新 path → _build_row + session.add（created）
    已有 → _apply_parsed（updated）
    文件消失 → exists=False + content=None（软删，deleted）
  单 session commit + structlog 统计
archive_conflict: 只构造 ScanDocConflictHistory 行（默认不入 session，add_to_session 开关）；
  list_history: workspace_id + path 精确查，created_at desc
```

## 注意事项
- **reparse 是全量对账 + 软删除**：文件从树里消失不删行（`exists=False` + 清 content）——冲突历史按 path 关联，物理删行断审计链。
- 解析根优先 `spec_ws.spec_root`（任意 strategy 有镜像就读：platform-managed / repo-native / repo-mirrored）；旧逻辑只认 platform-managed 曾导致 repo-native 工作区 `DOCS_DIR_MISSING`、扫描文档空白——改判定前回看 service.reparse 注释。
- parser 的 FS 性能约束（Windows Docker bind mount 上 stat 极慢的现实）：单文件 stat 收敛为 1 次（task-06，is_file/resolve/stat 合并）、后缀预筛在 stat 之前、递归与对账的同步重 IO 全包 `asyncio.to_thread`（task-01）。动 parser 保持这三条。
- `archive_conflict` 的 `add_to_session=False`（ql-20260817-005）供调用方在长 FS 循环外批量 `session.add`：循环内逐条 add 会 autobegin 把事务横跨后续 FS 段，撞 PG `idle_in_transaction_session_timeout` 被杀连接。
- 冲突历史行存 source id（member/runtime）为**平铺列、故意不加 FK**：删用户或 runtime 不得级联删审计记录。
- 归档写入方是 spec_workspace（apply_ops 覆盖文件时），本模块只提供原语与查询端点；conflict 计数与列表消费在前端文档详情页。
- **stats 口径四要点**（service.stats，动聚合前先对齐）：① 覆盖率两级——七件套按项目去重（`scan/` 下同 doc_type 异常多副本只计一次），模块层分母读各项目 `_module-map.yaml` 的 `modules:` 字典条目数，无 map / yaml 损坏 / 字段缺失的项目**退化为实有数**（不虚摊分母、不抛 500）；② 陈旧口径**含 mtime 空值**（未知时间视为最陈旧、排清单最前）；③ 注入频次读 `knowledge_hits` 的 `type='docs-inject'` 遥测行（跨模块只读引用，对齐 spec_workspace 引 ScanDocument 先例）——knowledge 侧 `USAGE_TYPES` 白名单不含该 type，知识库 stats 口径天然不被污染（design R-07）；④ 项目分组以 `_strip_docs_prefix` 剥前缀后第一段为准，根级文件只进全局口径不建项目。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
