---
schema_version: 1
doc_type: module-card
module_id: scan_docs
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:36
---
# scan_docs

## 定位
SillySpec「文档扫描」功能域的文档解析与落库服务。把工作区 `.sillyspec/docs/` 下的模块卡片、知识、组件文档等 markdown 解析成结构化 `ScanDocument` 行，供前端展示、模块影响分析、归档蒸馏使用。是 spec 文档管理链路的「只读索引层」：不写文件，只读 + 解析 + 持久化 + 对账。

产品视角：扫描文档是 SillySpec「文档驱动开发」的可视化基础。用户在工作区详情页看到的文档树、模块影响分析时用到的模块清单、归档时蒸馏知识的素材，都源自本模块解析落库的 ScanDocument 行。它与 task.parser、knowledge.parser 共同构成 spec 三大解析器，由 workspace.reparse 统一编排，保证 DB 索引与磁盘文件始终一致。

## 契约摘要
- 路由：`APIRouter prefix=/workspaces/{workspace_id} tag=scan-docs`
  - `GET /scan-docs` 列表（返回 `ScanDocList`，含 summary 聚合）
  - `GET /scan-docs/{doc_id}` 详情（返回 `ScanDocRead`，含完整 content）
  - `POST /scan-docs/reparse` 全量重解析（返回 `ScanDocReparseResponse`，含 stats + warnings）
- 依赖：`workspace`（取 root_path / component_key / platform-managed 的 spec_root）、`core`（auth_deps/ db / errors / logging）、`models`
- 数据模型：`ScanDocument` 行，字段含 workspace_id / path / doc_type / title / content / exists（软删标志）/ last_modified；唯一约束 (workspace_id, path)
- 解析产物：`ParsedDoc`（单文档）、`ParseWarning`（解析告警）、`ScanDocsResult`（docs 列表 + warnings 聚合）
- 跨组件协作：
  - 被 `workspace.reparse` 统一编排（父工作区重解析时联动调用）
  - 被 `archive` 归档蒸馏读取（作为知识提取的文档源之一）
  - 前端 `lib/scan-docs.ts` 客户端 + 工作区详情页文档树展示
- 权限：所有端点需认证 + `require_permission`

## 关键逻辑
重解析核心（`ScanDocsService.reparse`）：
```
root = workspace.root_path
if spec_ws.strategy == "platform-managed" and spec_ws.spec_root:
    root = spec_ws.spec_root          # 平台托管走 spec_root
result = parser.parse_docs_tree(root) if not component_key
       else parser.parse_component(root, component_key)
按 path 对账：已有→update，新增→add，消失→exists=False
commit → 返回 {parsed, created, updated, deleted}
```
- 父工作区（无 component_key）递归解析整棵 docs 树；子组件工作区只解析单个 component_key 子树
- `_doc_type_from_filename` 按文件名规则推断文档类型（module-card / knowledge / component 等）
- `_extract_title` 从 markdown 内容提取标题（首个标题行），缺失时回退文件名
- 文件消失走软删（exists=False、content=None），保留历史行不物理删，维护审计连续性
- `_build_row` 构造新行、`_apply_parsed` 把解析字段刷到已有行，二者共同保证 upsert 幂等
- reparse 全程在一个事务内 commit，stats 原子返回

### 文档类型与解析规则
`ScanDocsParser` 按文件系统层级递归解析：
- `parse_docs_tree(root)`：从 spec_root 递归遍历 `.sillyspec/docs/` 全树，对每个 `.md` 调 `parse_component` 子流程
- `parse_component(root, component_key)`：限定到单个组件子目录，产出该组件下的全部文档
- 文档类型由 `_doc_type_from_filename` 推断：模块卡片（module-card）、知识文档（knowledge）、组件文档（component）等，文件名规则与 sillyspec skills 约定一致
- 标题提取 `_extract_title` 优先取首个 `#` 标题行，缺失回退文件名（去扩展名）
- 解析告警 `ParseWarning` 记录无法解析的文件/字段问题，随 `ScanDocsResult.warnings` 返回前端展示

## 注意事项
- `reparse` 内部 try/except 包裹 spec_workspace 读取：非平台托管工作区降级用 root_path，避免硬依赖 spec_workspace 表存在
- 解析器对单文件读取失败容错（`_read_file_safe` 返回 `(content, ok)`），不因一个坏文件中断整次扫描，坏文件计入 warnings
- stats 中 `parsed` 只计 exists=True 的文档，与 created/updated 不重叠，前端展示时注意区分
- 文件是 source of truth，数据库仅作快速查询索引；reparse 用于把磁盘状态同步回 DB
- parser 内置 path traversal guard，防止 `../` 越权读取工作区外文件
- 超大 markdown 文件会截断，防止撑满数据库
- 与 `task.parser`、`knowledge.parser` 是并列三个 spec 解析器，各自管各自目录，reparse 入口由 `workspace.reparse` 统一编排，避免重复扫描
- doc_type 由文件名自动推断，新增文档类型需同步 `_doc_type_from_filename` 映射规则
- `list_` 返回 (rows, total) 元组，total 含软删行供前端分页决策
- `get` 按 doc_id 单查，content 字段可能因软删为 None，调用方需判空
- ScanDocument 的 last_modified 取文件 mtime，reparse 时同步刷新
- 唯一约束 (workspace_id, path) 保证同路径不重复，reparse 按此对账
- 与 archive 蒸馏联动：归档时读 ScanDocument 作为知识提取源之一
- 前端 `lib/scan-docs.ts` 三函数 listScanDocs/getScanDoc/reparseScanDocs 与后端一一对应
- ScanDocument 行软删后 exists=False，list 默认是否含软删由查询决定
- reparse 统计 deleted 计的是本次软删行数，与 parsed/created/updated 互斥
- doc_type 推断规则与 sillyspec skills 文档命名约定绑定，改命名需同步
- 解析不修改磁盘文件，纯只读，安全可重入
- content 字段存 markdown 全文，大文件截断阈值需关注避免 DB 膨胀
- reparse 入口由 workspace.reparse 统一编排，避免与 task/knowledge 重复扫
- ScanDocument 的 workspace_id 外键关联 workspaces 表
- parser 对编码异常容错，坏文件计入 warnings 不中断

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
