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
- **截断/坏编码内容不得成为写侧基底**（ql-20260918-001 / ql-20260919-001）：读侧 `_read_file_safe` 为防 OOM 对 >1MB 文件只回前 1/4 字节、对非 UTF-8 字节 `errors="replace"` 成 U+FFFD——writer 的 `update_entry` 对磁盘超限文件 422（`KnowledgeFileTooLarge`）、对磁盘非严格 UTF-8 文件 422（`KnowledgeFileEncodingInvalid`，update 不进 spec-backups，整文件替换会静默丢内容/毁坏原字节且不可恢复）；`merge`/`preview_merge` 候选正文走 `_read_raw` 原样读（合并后随即删候选，截断即永久丢失），回写路径统一经 `_decode_knowledge_strict` 严格解码。新增写侧入口必须沿用这三条口径。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->

## 增量（ql-20260918-001：写侧防截断守卫——大文件编辑 422 + 合并原样读）

- **背景**：读侧防 OOM 截断（>1MB 只回前 250KB）的内容此前直接成为写侧基底——网页编辑 >1MB 知识文件保存即被静默截断且 update 无备份不可恢复（合并同理：截断体并入目标后随即删候选，原件仅 30 天 spec-backups 兜底）。
- **update_entry 守卫**（writer.py）：磁盘文件 > `MAX_CONTENT_BYTES` → `KnowledgeFileTooLarge` 422（中文文案提示本地编辑后同步），文件不动；新增 `_knowledge_path` helper 与 `_read_raw` 共用路径构造。
- **merge / preview_merge 原样读**：候选正文从 `entry.content`（parser 截断路径）改 `_read_raw(workspace_id, filename)`，截断边界外内容完整并入目标/预览；zone 校验仍走 reader。
- **前端配套**（entry-editor.tsx）：保存成功提示去掉「旧内容已备份」——apply_ops 的 update 不进 spec-backups（仅 delete 备份），原文案与实际语义不符。
- **验证**：test_writer 新增 3 用例（超限编辑 422 + 磁盘原文未动、merge/preview 合并内容含 >250KB 处尾部标记、候选删除断言）；test_writer 14 + test_router 24 + queue/inject 相邻面全绿；ruff/mypy（scoped）0。

## 增量（ql-20260918-005：merge 两处健壮性——非 UTF-8 字节严格解码拒写 + INDEX.md 缺失自动建首段）

- **背景（24h 审查 M3/M6）**：①`_read_raw` 用 `errors="replace"` 解码后 merge 段一整文件回写——目标文件的非 UTF-8 字节（Windows GBK 手工编辑残留）被永久替换为 U+FFFD 且 update 无备份；②merge/preview 前置 `_read_raw("INDEX.md")` 对缺失文件抛 WorkspaceNotFound（404），`_insert_route_line` 本身支持 EOF 追加但前置读失败使合并整体不可用、无自动初始化路径。
- **修法**（writer.py）：①`_read_raw` 改严格 UTF-8 解码，`UnicodeDecodeError` 抛新增 `KnowledgeFileEncodingInvalid` 422（details 带 byte_offset，文件不动，提示本机转码后再操作）——所有回写路径（目标/INDEX/候选）统一收口；②新增 `_read_index_raw`（缺失返回空串），merge 对空 INDEX 特判首段格式 `## <分类>\n<路由行>\n`（`_insert_route_line` 空输入会留两个空行前导），update op 无 manifest 行按新建落 version 1。
- **验证**：test_writer 22（新增 4：merge/preview 坏编码 422+原字节未动+候选保留、INDEX 删除后 merge 自动建首段/preview 不 404）+ test_router/test_parser 39 全绿；ruff/mypy（scoped）0。

## 增量（ql-20260918-006：distill quick ref 白名单校验 + fresh 失败分支附件回收）

- **背景（24h 审查 M4/M5）**：①quick 蒸馏 `source_ref` 仅 strip 空白即做存在性检查 `(quicklog_dir / f"{ref}.md").is_file()`（对 `..` 不设防），ref 又原样拼进给 agent 的读取路径（`build_distill_prompt`）——`../..` 形态可把读取路径指到 quicklog 目录外（仅 .md，需 KNOWLEDGE_WRITE 权限，定级中）；②fresh 会话蒸馏上传先于 create_session（洞一取数通道），引擎不支持/离线两失败分支不清理已上传附件——草稿 GC 48h 只删行不删对象（D-5 accepted risk），此变更加了高频孤儿生产者（单份至 19MB）。
- **修法**（distill.py）：①quick 分支 ref 白名单校验先于存在性检查——`[A-Za-z0-9][A-Za-z0-9._-]*`（字母数字开头，仅含 字母数字/./_/-），拒 `..`/绝对路径/盘符/反斜杠/子目录形态（422）；②新增 `_cleanup_distill_attachment`（best-effort）挂进两失败分支：session_id 仍 NULL 的草稿行即时删除（对齐附件删除端点「只删行」语义；已绑定会话的行属审计轨迹不动，失败仅记日志不改失败分支语义）。
- **验证**：test_distill 30（新增 2：非法 ref 六形态 422 且 quicklog 外文件不可命中、offline/unsupported 两失败分支参数化断言草稿行已回收）+ test_router 27 全绿；ruff/mypy（scoped）0——顺手清偿 3 处既有 mypy 债（`_upload_distill_source` 返回注解 AttachmentRead、test_distill `calls["inject"]` object 索引收窄）。对象本体的 GC 仍是 D-5 accepted risk，本增量只回收行。

## 增量（ql-20260919-001：update_entry 坏编码守卫——编辑路径补齐严格解码拒写）

- **背景（24h 审查 M1 残余缺口）**：ql-20260918-005 把 `_read_raw` 收口为严格 UTF-8 解码，但只覆盖 merge/preview 回写路径——网页编辑链路 GET 经 parser `_read_file_safe`（`errors="replace"`）回传的基底对非 UTF-8 文件（Windows GBK 手工编辑残留）已是 U+FFFD 版，`update_entry` 整文件替换保存会把原始字节永久毁坏且 update 不进 spec-backups（仅 delete 备份）。<1MB 的坏编码文件此前两条守卫（大小 422 / merge 严格解码）都不拦。
- **修法**（writer.py）：新增模块级 `_decode_knowledge_strict(raw, filename)` 共享 helper（`_read_raw` 原内联 try/except 收敛进来，错误形态单一来源）；`update_entry` 在大小守卫后对磁盘原文做严格解码探测（≤1MB，结果弃用只探测），坏编码抛既有 `KnowledgeFileEncodingInvalid` 422（details 带 byte_offset，文件与 manifest 版本不动，提示本机转 UTF-8 后再操作）。
- **验证**：test_writer 27（新增 2：坏编码编辑 422+前置自检 GET 基底确含 U+FFFD+磁盘原字节与 manifest 版本未动；合法 UTF-8 中文编辑不受误伤的对照组）+ test_router/test_parser/test_distill 相邻面 72 全绿；ruff format/check + mypy（scoped writer）0。附带：workspace/router.py probe_workspaces docstring 勘误——原「只读无状态变化」与 ql-20260918-012 repo_url 回填写副作用自相矛盾（CLAUDE.md 规则 18），改为「不改生命周期状态（唯一写例外 repo_url 回填）」。
