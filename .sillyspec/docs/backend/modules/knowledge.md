---
schema_version: 1
doc_type: module-card
module_id: knowledge
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 知识库浏览（knowledge）

## 定位
工作区知识库与快速日志的读侧 + 平台写侧：解析 spec 树下 `knowledge/` 与 `quicklog/` 目录的 Markdown 文件并按条目返回；2026-09-17-knowledge-precipitation 起知识面获得平台写能力（手工录入 / 条目编辑 / 审核合并 / 拒绝 / 蒸馏派发），写入口全部经 spec_workspace 的 `apply_ops` 单写者落盘（D-005@v1）。quicklog 面仍是纯读（由 SillySpec CLI 在仓库侧维护）。

## 契约摘要
- `GET /api/workspaces/{workspace_id}/knowledge` → `KnowledgeList`（items 不含 content，total 计数；2026-09-17-knowledge-precipitation 起 items 增 `zone`，`filename` 扩展为 knowledge/ 下相对路径可含子目录段如 `decisions/daemon.md`，顶层条目值不变）。
- `GET .../knowledge/{filename:path}` → `KnowledgeEntry`（含 content；filename 现可为子目录路径，路由改 `:path` 通配；找不到抛 `WorkspaceNotFound` 语义错误「知识库文件不存在，请刷新文件列表后重试」，details 带 workspace_id/filename）。
- `GET .../quicklog` → `QuicklogList`；`GET .../quicklog/{filename}` → `QuicklogEntry`，行为与错误语义同上（quicklog 面零改动）。
- 读端点统一 `require_permission(Permission.KNOWLEDGE_READ)`。
- `ParsedEntry`：filename（knowledge 下相对正斜杠路径，可含子目录段）/ path（相对根的正斜杠路径，保留 `.sillyspec/knowledge/` 前缀）/ title（正文第一个 `#` 行）/ content / last_modified_at / zone（`top|decisions|generated|proposed`，由 filename 首段派生；quicklog 恒 top、DTO 不透出）。
- 写侧与蒸馏端点（2026-09-17-knowledge-precipitation task-04/07；**全部字面量路由必须注册在 `GET /knowledge/{filename:path}` 通配之前**——FastAPI 按声明序匹配，通配在前会吞掉同形字面量路径）：
  - `POST /knowledge/propose`（KNOWLEDGE_WRITE）— 手工录入候选，落 `knowledge/proposed/<slug>.md`（slug=kebab(title) 冲突 -2/-3 唯一化；frontmatter：author/created_at/proposed_at/source=manual，tags 可选）。
  - `PATCH /knowledge/entries/{filename:path}`（KNOWLEDGE_WRITE）— 编辑条目正文（整文件内容替换）；zone ∈ {top,generated,proposed} 可编辑，decisions → 422 `HTTP_422_KNOWLEDGE_EDIT_FORBIDDEN`（由归档流程维护，D-006@v1）。
  - `POST /knowledge/proposed/{filename:path}/preview-merge`（KNOWLEDGE_WRITE）— 合并预览 dry-run 不落盘：返回将追加的段落文本（section_text）与 INDEX 路由行（index_line），前端零拼接直接渲染。
  - `POST /knowledge/proposed/{filename:path}/merge`（KNOWLEDGE_WRITE）— **两段式合并**：段一 `[update(目标文件), update(INDEX.md)]` 确认无 conflict 才执行段二 `[delete(proposed/<slug>.md)]`（规避 apply_ops 逐 op 冲突跳过导致的「候选已删但 INDEX 缺行」半态；段间失败=候选残留、幂等可重试）；目标白名单限三类 INDEX 映射文件 known-issues.md / patterns.md / conventions.md；dupRe 幂等守卫——目标已含同名 `##` 小节 / INDEX 已含同锚点路由行时跳过对应动作（防段一已生效的重试重复追加）。
  - `POST /knowledge/proposed/{filename:path}/reject`（204，KNOWLEDGE_WRITE）— 拒绝候选（单段 `[delete]`，入 spec-backups 30 天备份区）。
  - `POST /knowledge/distill`（KNOWLEDGE_WRITE）— 派发蒸馏任务（源校验：会话存在且有记录 / 变更已归档；创建 AgentRun，`metadata_` 写 `{kind: knowledge-distill, source_type, source_ref, focus}` 四键；daemon 离线立即 failed/no_online_daemon）。
  - `GET /knowledge/distill/tasks`（KNOWLEDGE_READ）— 蒸馏任务列表（按 AgentRunWorkspace 关联 + metadata_.kind 过滤，created_at 倒序；无独立状态机，状态以 AgentRun 为准）。
  - **409 契约（R-01）**：写端点内嵌 apply_ops 检测到 conflict 时统一翻译 `HTTP_409_KNOWLEDGE_WRITE_CONFLICT` + `{message: "文件在别处被修改，请刷新后重试", conflict: true, server_versions: {...}}`。
- 服务：`KnowledgeWriterService`（writer.py）— 知识写侧唯一服务，构造 FileOp（op ∈ add/update/delete，path 限 `knowledge/` 前缀，content base64，base_version 取 manifest 当前行版本）调 `SpecWorkspaceService.apply_ops`；`DistillDispatchService`（distill.py）— 源校验 + AgentRun 创建（prompt 模板指示 agent 跑 `sillyspec knowledge propose`）+ 任务列表查询。

## 关键逻辑
```
root = spec_ws.spec_root（SpecWorkspaceService 优先；失败兜底 Path(workspace.root_path)/".sillyspec"）
entries = parser.parse_knowledge(root) 或 parse_quicklog(root)
  # knowledge rglob 递归扫子目录（zone 化，2026-09-17-knowledge-precipitation）
  # quicklog 顶层 glob 不动（recursive=False 默认）
  # 单文件 >1MB（MAX_CONTENT_BYTES）跳过；读失败容错（_read_file_safe 返 ok 标志，不抛）
get: 全量 parse 后内存按 filename 精确匹配（filename 含子目录段后值天然唯一，无索引）
写侧: writer/distill 构造 FileOp → spec_workspace.apply_ops 落盘（单写者语义见 spec_workspace 卡）
```

## 注意事项
- 与 platform_sync 的 `QuicklogEntryORM` 是**两个数据面**：本模块读仓库文件（CLI 落盘的 QUICKLOG md），platform_sync 存 CLI 主动上行的条目快照（DB 行），互不替代；前端消费点不同。
- `_spec_content_root` 的兜底分支只服务 spec_workspace 无数据的过渡场景；单一 daemon-client 架构下正常路径恒是 platform-managed 扁平布局的 `spec_root`（knowledge/ 直接在其下）。
- 每次请求都重新扫目录（无缓存、无 DB 化），list 与 get 都走全量 parse 后内存过滤——目录条目量大时这里是潜在热点，加索引/缓存前先量。
- `change` 模块复用本模块解析知识条目（map used_by: change），动 parser 输出结构前先查 change 侧消费点。
- get 的错误类型沿用了 `WorkspaceNotFound`（带中文文案区分文件级缺失），不是 404 裸抛——改错误类型会影响前端提示分支。
- **decisions/ 只读由归档流程维护**（D-006@v1）：决策库条目由 archive 蒸馏幂等写入，网页编辑入口不渲染、`update_entry` 兜底返回 422；merge/reject 仅限 proposed 候选（zone 校验 `HTTP_422_KNOWLEDGE_ZONE_NOT_ALLOWED`）。
- **INDEX.md 路由行格式与 CLI classify 逐字同源（R-03）**：`- 关键词|关键词 → [标题](文件.md#锚点)`（writer `build_route_line` ↔ CLI knowledge-classify.js 同一 f-string 形态），分类段落点 = CATEGORY_SECTIONS 三类映射。格式漂移会让 CLI `knowledge search`/`validate` 检索失效——改路由行生成逻辑前必须跑 CLI 交叉验证（task-09 evidence 已建 validate+search 同源验证基线）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
