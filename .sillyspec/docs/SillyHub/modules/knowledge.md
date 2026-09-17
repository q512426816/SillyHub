---
schema_version: 1
doc_type: module-card
module_id: knowledge
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 知识与 Quicklog 读取（knowledge）

## 定位
后端「知识与 quicklog」只读消费侧：解析工作区 spec 树下 knowledge/ 与 quicklog/ 两套 markdown 目录并对外提供列表/单条正文。纯文件系统读取（无 DB 持久化、不落任何写）；知识生成在 archive 蒸馏环节，quicklog 由 SillySpec CLI 写入，本模块只管读。

## 契约摘要
- 端点（prefix=/workspaces/{workspace_id}，tag=knowledge，全部 `require_permission(Permission.KNOWLEDGE_READ)`）：
  - `GET /knowledge` — 条目列表（不含正文）
  - `GET /knowledge/{filename}` — 单条（含 content）
  - `GET /quicklog` / `GET /quicklog/{filename}` — 同构两端点
- `KnowledgeService`：`list_knowledge` / `get_knowledge` / `list_quicklog` / `get_quicklog`；构造可注入 WorkspaceService 与 KnowledgeParser（测试替身）。
- `KnowledgeParser`（parser.py）：`parse_knowledge` / `parse_quicklog` → `parse_md_directory` 批量解析；`_extract_title` 取首个 `#` 行；`_read_file_safe` 容错读取。
- 单条未命中抛 WorkspaceNotFound（文案「知识库/快速日志文件不存在」）。

## 关键逻辑
```
list(ws) → WorkspaceService.get(ws) → _spec_content_root(workspace):
    SpecWorkspaceService.get(ws).spec_root 优先（platform-managed 扁平布局，
    knowledge/ 直接在 spec_root 下）
    → 异常/无数据兜底 Path(root_path)/".sillyspec"
  → parser.parse_md_directory(root/<dir>)
    每文件: resolve() 前缀校验不出 sillyspec_root（防符号链接逃逸）
    → 超大文件(>1MB)只读前 1/4 → title=首个#行 → mtime
get(ws, filename) → 同上全量解析后按 filename 匹配（include_content=True）
```

## 注意事项
- **单条读取是全目录解析后线性匹配**（parser 无按文件名直达路径）：目录文件多时 get_* 成本随条目数增长，优化需加索引或直达读，当前量级可接受。
- 路径解析安全：parse 层对每个文件 resolve 后强制 sillyspec_root 前缀校验，OSError/ValueError 跳过该文件不炸整个列表。
- 内容根的优先级（spec_workspace.spec_root → root_path/.sillyspec 兜底）对应「单一 daemon-client 后全部 workspace 走 platform-managed spec_root」的架构迁移，勿颠倒。
- 文件名即知识 key，重命名文件会令前端旧链接 404。
- 本模块永不写盘；写入口在 archive（distill_knowledge）与 CLI（quicklog）。
- knowledge 与 quicklog 是两套平行目录、共用一套解析逻辑，新增第三种目录只需在 parser 加别名。
- **截断内容不得成为写侧基底**（ql-20260918-001）：读侧 `_read_file_safe` 为防 OOM 对 >1MB 文件只回前 1/4 字节——writer 的 `update_entry` 对磁盘超限文件直接 422（`KnowledgeFileTooLarge`，update 不进 spec-backups，整文件替换会静默丢截断后内容且不可恢复）；`merge`/`preview_merge` 候选正文走 `_read_raw` 原样读（合并后随即删候选，截断即永久丢失）。新增写侧入口必须沿用这两条口径。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->

## 增量（ql-20260918-001：写侧防截断守卫——大文件编辑 422 + 合并原样读）

- **背景**：读侧防 OOM 截断（>1MB 只回前 250KB）的内容此前直接成为写侧基底——网页编辑 >1MB 知识文件保存即被静默截断且 update 无备份不可恢复（合并同理：截断体并入目标后随即删候选，原件仅 30 天 spec-backups 兜底）。
- **update_entry 守卫**（writer.py）：磁盘文件 > `MAX_CONTENT_BYTES` → `KnowledgeFileTooLarge` 422（中文文案提示本地编辑后同步），文件不动；新增 `_knowledge_path` helper 与 `_read_raw` 共用路径构造。
- **merge / preview_merge 原样读**：候选正文从 `entry.content`（parser 截断路径）改 `_read_raw(workspace_id, filename)`，截断边界外内容完整并入目标/预览；zone 校验仍走 reader。
- **前端配套**（entry-editor.tsx）：保存成功提示去掉「旧内容已备份」——apply_ops 的 update 不进 spec-backups（仅 delete 备份），原文案与实际语义不符。
- **验证**：test_writer 新增 3 用例（超限编辑 422 + 磁盘原文未动、merge/preview 合并内容含 >250KB 处尾部标记、候选删除断言）；test_writer 14 + test_router 24 + queue/inject 相邻面全绿；ruff/mypy（scoped）0。
