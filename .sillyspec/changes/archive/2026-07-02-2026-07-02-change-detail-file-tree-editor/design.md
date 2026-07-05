---
author: qinyi
created_at: 2026-07-02 10:26:32
change: 2026-07-02-change-detail-file-tree-editor
---

# design — 变更详情文件树 + 手动编辑

## 1. 背景

变更中心 / 变更详情页当前存在三处问题：

1. **变更中心列表页**（`frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx:341-361`）展示了一条「变更生命周期」流程图（扫描→需求分析→规划→执行→验证→归档）。该流程图把「扫描」混进了变更生命周期（扫描属于工作区初始化，不属于单个变更的生命周期），且整条流程图对用户无实际操作价值。
2. **变更详情页**（`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx:828-914`）展示「变更文档完整性」面板（必需/可选文档徽标）。文档完整性本应由 SillySpec CLI 在流程内自行把控，UI 重复展示属于越权且维护成本高。
3. **变更详情页无法查看/编辑变更目录下的真实文件**。现有 DOC_TABS 只覆盖预定义类型（proposal/design/plan/tasks 等），且 `ChangeService.get_document_content`（`backend/app/modules/change/service.py:211-265`）用 `workspace.root_path` 读文件——对 daemon-client 工作区，`root_path` 是宿主路径（如 `C:\Users\qinyi\...`），后端容器不可达，导致文档内容读取对 daemon-client **实际是失效的**（异常分支返回 `exists=False`，UI 显示「文档尚未创建」）。

用户需求：变更详情用「文件树」展示该变更目录下的**全部文件**（含 `tasks/`、`references/`、`prototype-*.html` 等），并支持**手动修改文档内容**后保存。工作区 `fb5008c1-...` 为 daemon-client 类型，真实文件在客户端本机，后端只能读写平台镜像 `/data/spec-workspaces/.../changes/<key>/`。

## 2. 设计目标

- G1：变更中心移除「变更生命周期」流程图。
- G2：变更详情移除「变更文档完整性」面板，替换为「文件树 + 编辑器」。
- G3：文件树递归展示变更目录下全部文件，按目录分组。
- G4：支持编辑现有文本文件内容并保存，保存经 `path_source` 分流写回真实文件（server-local 直写 / daemon-client 经 outbox 队列写回本机）。
- G5：daemon-client 保存支持**离线续传**（daemon 离线时入队 pending，重连后回写）。
- G6：保存成功后自动刷新该变更的 DB 文档矩阵（`ChangeDocument` 行 + title），变更中心列表同步反映。
- G7：前端展示保存状态（保存中 / 已保存 / 排队中 / 失败）与镜像同步时间。

## 3. 非目标

- N1：不支持新建文件、重命名、删除文件（仅编辑现有文件内容）。
- N2：不支持 diff 增量保存（全量 `{path, content}` 写回；单编辑者场景，免三方合并）。
- N3：不做全工作区 reparse（仅 per-change 文档 resync）。
- N4：不做 server-local 与 daemon-client 之外的其它 path_source。
- N5：不改动 SillySpec CLI 自身的文档完整性校验逻辑。
- N6：不做多端并发编辑冲突解决（last-write-wins，见 D-002）。

## 4. 拆分判断

单个内聚变更，不拆分、不走批量。依据：无 3+ 独立交付模块、单角色、单页面无跨页流转、后端读取/写回/状态查询与前端文件树/编辑器强耦合。预估 plan 8-12 task。

## 5. 总体方案

### Phase 1 — 后端：读取与列目录（镜像 spec_root 解析）

新增 `ChangeService` 方法 + router 端点，统一用 `SpecWorkspaceService.get(workspace_id).spec_root` 解析变更目录（对齐 `reparse` 的 `service.py:696-708`），不再用 `workspace.root_path`：

- 变更目录绝对路径：
  - daemon-client（扁平布局）：`{spec_root}/changes/{change_key}/`
  - server-local（包裹布局）：`{root_path}/.sillyspec/changes/{change_key}/`
  - 用 `is_daemon_client_path_source(workspace.path_source)` 分流（对齐 `reparse` `service.py:714`）。
- `GET /changes/{cid}/files`：`Path.rglob` 遍历变更目录，返回扁平清单 `[{path, name, size, last_modified_at, is_text}]`（path 相对变更目录，如 `tasks/task-01.md`）。排除隐藏文件（`.` 开头）。
- `GET /changes/{cid}/files/content?path=<rel>`：按相对 path 读单文件，路径穿越守卫（resolve 后必须落在变更目录内），1MB 截断（复用 `MAX_CONTENT_BYTES`）。

### Phase 2 — 后端：写回（path_source 分流）

`POST /changes/{cid}/files/content` body `{path, content}`：

- **路径守卫**（D-004）：`path` resolve 后必须落在变更目录内，否则 400。
- **content ≤ 1MB**，超限 400。
- **server-local 分支**：`write_text` 到 `{root_path}/.sillyspec/changes/{key}/{path}`（复用 `sync_documents` `service.py:320-368` 的守卫 + 落盘模式），写成功后调用 `_resync_change_docs`，同步返 `{status:"done"}`。
- **daemon-client 分支**（双写：镜像即时 + 队列回写本机）：
  1. **后端直写平台镜像** `{spec_root}/changes/{key}/{path}`（`/data/spec-workspaces/.../`，容器内可写卷）——让 DB resync 立即可用，避免 complete-时竞态（daemon `runChangeWrite` 先 complete 后 sync，complete 时镜像尚未刷新，见 `task-runner.ts:1585-1598`）。
  2. **建/合并一条 `DaemonChangeWrite` 行**（D-002：同 `change_key + path` 的 pending 行→更新 content，无则新建），`kind="edit"`，**不调用 `_await_change_write_receipt`**（区别于 `proxy_create_change` 的 60s 阻塞 await `proxy.py:128-165`）。
  3. **立即 `_resync_change_docs`**（镜像已新鲜）。
  4. 返 `{status:"pending", task_id}`——pending 表示「客户端本机尚未回写」（用户关心的源文件同步），镜像+DB 已新鲜（导航返回即见改动）。
  - pending 行由 daemon 轮询 claim→写本机→complete（现有 `change_write_router.py`）+ daemon 自带 sync 回灌镜像（内容一致，幂等）。超时**不翻 failed**（无 await，pending 天然留存等重连）→ 离线续传。

> 关键澄清（修正 brainstorm 草稿 D-001）：**不改 `_await_change_write_receipt` 的 60s 超时行为**。该函数只服务 `proxy_create_change`（创建新变更，用户同步等待）。编辑保存走独立路径，根本不 await，pending 行天然留存。避免动正在工作的创建流程。
>
> 镜像直写的意义：daemon-client 的平台镜像是 backend 视角的 spec 副本（reparse 已在读），backend 直写它是给 DB 即时刷新用的；客户端本机（真实源）仍由 daemon 队列异步回写。两端内容一致（同一次编辑的 content），daemon 后续 sync 幂等。

### Phase 3 — 后端：状态查询（resync 已在 POST 时完成）

- `GET /changes/{cid}/files/pending`：返回该变更下所有 pending/claimed 的 `DaemonChangeWrite` 行（按 `change_key` 过滤，建议带 `kind="edit"` 过滤避免误纳 create 行）`[{path, status, created_at}]`，供前端展示「排队中」+ 轮询。
- 新增 `_resync_change_docs(workspace_id, change_id)`：复用 `ChangeParser._parse_change` 单目录解析 + `_sync_docs`（`service.py:840-877`）刷 `ChangeDocument` 行 + 重提取 title。轻量，只处理该变更目录。
- **resync 时机**：在 POST files/content 写完镜像后立即调用（server-local 写盘后 / daemon-client 镜像直写后）。**不钩在 `complete_change_write`**——因为 daemon `runChangeWrite` 先 complete 后 sync，complete 时平台镜像尚未刷新，钩 complete 会读到旧内容（竞态）。镜像直写让 resync 在 POST 时即可读到最新。
- daemon 回执 complete 后自带 `syncSpecTreeIfNeeded`（`task-runner.ts:1595`）回灌镜像，内容一致（幂等），无需 backend 再动。

### Phase 4 — 前端：文件树 + 编辑器 + 状态机

- 新组件 `frontend/src/components/change-file-tree.tsx`：双栏（左树 280px + 右内容），复用 scan-docs 的 `TreeView` 结构（`scan-docs/page.tsx:39-92`）。
- 新 lib `frontend/src/lib/change-files.ts`：`listChangeFiles` / `getChangeFileContent` / `saveChangeFileContent` / `listPendingChangeFiles` 封装 + `buildChangeFileTree`（适配 `buildTree` `scan-docs-tree.ts`，输入扁平 path 清单）。
- 右侧：文本文件 → 可编辑 `<textarea>` + 保存按钮 + 放弃修改；二进制（`is_text=false`）→ 只读提示。
- 保存状态机：`idle → saving → done | pending | failed`。daemon-client 保存返 pending 后，轮询 `GET /files/pending` 直到该 path 行消失（done）或翻 failed；轮询间隔 2s，上限 5min 后停止并提示「仍在排队，可离开页面」。
- 文件树给 pending 文件加「排队中」徽标；顶部展示 `last_synced_at`（取 `spec_workspaces.last_synced_at`），daemon 离线时显示警告条（D-003）。
- **删除**（D-008@v1：文件树替换 A+B）：
  - `[cid]/page.tsx`「变更文档完整性」section（828-914）。
  - `[cid]/page.tsx` DOC_TABS 只读内容查看器（916-993）+ 关联死代码（`DOC_TABS`/`DOC_LABELS`/`REQUIRED_DOCS`/`OPTIONAL_DOCS`/`COMPONENT_EMOJI`/`getComponentEmoji`/`handleDocSelect`/`activeDoc`/`docContent`/`loadingDoc`/`docExistsMap`/matrix 自动刷新 effect）——文件树是其超集，保留即冗余。
  - `frontend/src/lib/changes.ts` 的 `getChangeDocumentContent`（无人调用后删）；`getChangeDocuments` 视剩余调用方决定（若仅本页用则一并删 wrapper，后端 endpoint 保留以免越界）。
  - `backend/app/modules/change/service.py:get_document_content`（211-265）+ `router.py` 的 `GET /changes/{cid}/documents/{doc_type}`（130-151）——B 移除后成死代码，连带删除（原"修 spec_root"改为直接删，更干净）。**保留** `get_documents`/`ChangeDocMatrix`（`check_archive_gate` service 内部仍用 `get_documents`，service.py:675）。
  - `changes/page.tsx` 生命周期 SectionCard（341-361）。

### Phase 5 — 安全 + 测试

- 后端：路径穿越 pytest（`../`、绝对路径、符号链接拒）；list/read/write/pending 两分支（server-local/daemon-client）单测；edit-kind `complete_change_write` → resync 集成测；migration 可回滚。
- 前端：`change-file-tree` 渲染 + 状态机 + 排队徽标；编辑器保存调用；jsdom 下 MarkdownText `vi.mock`（CONVENTIONS 已知坑）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/change/router.py` | 新增 4 端点：`GET /changes/{cid}/files`、`GET /changes/{cid}/files/content`、`POST /changes/{cid}/files/content`、`GET /changes/{cid}/files/pending`；**删除** `GET /changes/{cid}/documents/{doc_type}`（死代码） |
| 修改 | `backend/app/modules/change/service.py` | 新增 `list_files` / `read_file` / `write_file` / `list_pending_files` / `_resync_change_docs` / `_resolve_change_dir`（spec_root 解析）；**删除** `get_document_content`（死代码，改删不修） |
| 修改 | `backend/app/modules/daemon/model.py` | `DaemonChangeWrite` 加 `kind: str = "create"` 字段（仅用于 pending 列表过滤区分 edit/create） |
| 修改 | `backend/app/modules/daemon/schema.py` | `ChangeWritePendingItem` 加 `kind` 字段透传 |
| 新增 | `backend/migrations/versions/20260702xxxx_add_kind_to_daemon_change_writes.py` | 加 `kind` 列（down_revision 接当前真实 head，唯一 revision id） |
| 新增 | `frontend/src/components/change-file-tree.tsx` | 文件树 + 编辑器 + 状态机组件 |
| 新增 | `frontend/src/lib/change-files.ts` | API 封装 + `buildChangeFileTree` |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` | 删文档完整性 section（828-914），接入 `<ChangeFileTree>`；移除死代码常量 |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx` | 删生命周期 SectionCard（341-361） |
| 新增 | `backend/app/modules/change/tests/test_files_router.py` | list/read/write/pending + 路径穿越 + 两分支 |
| 新增 | `backend/app/modules/daemon/tests/test_change_write_edit.py` | edit-kind complete→resync 集成测 |
| 新增 | `frontend/src/components/__tests__/change-file-tree.test.tsx` | 渲染 + 状态机 + 排队徽标 |

## 7. 接口定义

### `GET /api/workspaces/{wid}/changes/{cid}/files`
响应 `ChangeFileList`：
```python
class ChangeFileEntry(BaseModel):
    path: str          # 相对变更目录，如 "tasks/task-01.md"
    name: str          # 文件名
    size: int
    last_modified_at: datetime | None
    is_text: bool      # 扩展名判定（.md/.html/.yaml/.json/.txt/.mdx → True）
class ChangeFileList(BaseModel):
    change_id: uuid.UUID
    items: list[ChangeFileEntry]
```

### `GET /api/workspaces/{wid}/changes/{cid}/files/content?path=<rel>`
响应 `ChangeFileContent`：
```python
class ChangeFileContent(BaseModel):
    path: str
    content: str | None
    exists: bool
```

### `POST /api/workspaces/{wid}/changes/{cid}/files/content`
请求 `ChangeFileWriteRequest`，响应 `ChangeFileWriteResponse`：
```python
class ChangeFileWriteRequest(BaseModel):
    path: str
    content: str
class ChangeFileWriteResponse(BaseModel):
    status: Literal["done", "pending"]
    task_id: uuid.UUID | None = None  # daemon-client pending 时返 DaemonChangeWrite.id
```

### `GET /api/workspaces/{wid}/changes/{cid}/files/pending`
响应 `PendingFileList`：
```python
class PendingFileEntry(BaseModel):
    path: str
    status: Literal["pending", "claimed"]
    created_at: datetime
class PendingFileList(BaseModel):
    items: list[PendingFileEntry]
```

## 7.5 生命周期契约表（DaemonChangeWrite edit-kind）

涉及 daemon/claim/lease/complete 关键词，必填。

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| enqueue edit-write | backend (POST files/content) | DB daemon_change_writes + 平台镜像 | change_key, runtime_id, files=[{path,content}], kind="edit"；镜像写 changes/<key>/<file> | → pending；镜像即时新鲜 |
| resync docs | backend (POST 内，镜像写后) | DB change_documents | change_id | ChangeDocument 行 + title 即时刷新（不依赖 complete） |
| poll pending | daemon | backend (GET pending-change-writes) | runtime_id | pending 行返回（含 kind） |
| claim | daemon | backend (POST claim) | change_write_id | pending → claimed（claim_token 生成） |
| write file | daemon | 本机文件系统 | files[].path, files[].content | 本机 changes/<key>/<file> 覆盖（通用，无 create 副作用） |
| complete + sync | daemon | backend (POST complete) + 平台镜像 (syncSpecTreeIfNeeded) | change_write_id, claim_token, ok | claimed → done；daemon 自带 sync 回灌镜像（幂等） |

必需字段落点：`kind` 加到 `DaemonChangeWrite` model + `ChangeWritePendingItem` schema；`files` 项复用现有 `{path, content, doc_type}` 结构（edit 用 `doc_type="edit"`）。**resync 不钩 complete**（避免 daemon 先-complete-后-sync 的竞态），改在 POST 镜像写后立即执行。

## 8. 数据模型

`daemon_change_writes` 加一列：
- `kind VARCHAR DEFAULT 'create' NOT NULL`（取值 `create` / `edit`）。现有 `proxy_create_change` 创建的行默认 `create`，行为不变。

无其它表/字段变更。`ChangeDocument` 行由 `_sync_docs` 复用现有结构刷新（无 schema 变更）。

## 9. 兼容策略（brownfield）

- 未升级 daemon 的客户端：旧 daemon 不识别 `kind` 字段不影响——`files` 写回逻辑不变（daemon 只读 `files` 列表写盘），`kind` 仅 backend 侧用于 complete 后分流。旧 daemon claim/complete edit-kind 行为与 create 一致（写 files → done），backend 在 complete 时按 kind 触发 resync。**向前兼容**。
- 旧 `proxy_create_change` 创建路径：`kind` 默认 `create`，`_await_change_write_receipt` 60s 行为不变。
- `get_document_content` 删除（D-008）：原对 daemon-client 读失效（用 root_path），随 DOC_TABS 查看器移除一并清理，无回归（唯一调用方 router 端点同步删）。`get_documents`（service）保留供 archive gate 用。
- 未配置文件树前端的旧前端版本：新端点不影响旧页面。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | migration 链断裂（多 head）致 backend crash-loop | P0 | revision id 唯一 + down_revision 接 execute 时真实 head；execute 前查 `alembic_version` 表核实；本地 PG `down -v` 可重置（项目未上线） |
| R-02 | 路径穿越写穿出变更目录 | P0 | 写/读 path 均 resolve 后校验落在变更目录内；pytest 覆盖 `../`、绝对路径、符号链接 |
| R-03 | daemon-client 读失效修复影响范围 | P1 | `get_document_content` 改 spec_root 后补测；现有 DOC_TABS 若依赖旧失效行为需排查（应无） |
| R-04 | daemon 离线时用户反复保存致队列膨胀 | P1 | D-002 同 change_key+path 合并单条 pending；前端轮询上限 5min 后停止 |
| R-05 | daemon-client 平台镜像卷不可写（`/data/spec-workspaces/...`） | P1 | execute 先验容器内该卷可写；不可写则降级——纯 outbox（不直写镜像），resync 推迟到 daemon complete+sync 之后由前端轮询触发 `POST /changes/{cid}/resync`（兜底端点） |
| R-06 | 前端轮询 `/files/pending` 频率 | P2 | 2s 间隔 + 页面不可见时停止（visibilitychange） |
| R-07 | 镜像直写 + daemon sync 双写内容不一致（用户在 daemon 离线期又本地改了同一文件） | P2 | last-write-wins（D-002/006），单编辑者场景可接受；文档注明 |

## 11. 决策追踪

当前版本决策见 `decisions.md`：D-001@v1（outbox 不 await 离线续传，已修正：不动 60s 逻辑）、D-002@v1（同文件 pending 合并）、D-003@v1（读前展示 synced_at 不硬阻）、D-004@v1（路径守卫）、D-005@v1（POST 时 per-change resync，已修正：不钩 complete 避竞态）、D-006@v1（path_source 分流）、D-007@v1（仅编辑现有文件）、D-008@v1（文件树替换 A+B + 死代码清理）。

覆盖映射：D-001@v1→Phase2/§7.5；D-002@v1→Phase2；D-003@v1→Phase4；D-004@v1→Phase1/Phase2/R-02；D-005@v1→Phase3/§7.5；D-006@v1→Phase1/Phase2；D-007@v1→N1/Phase4；D-008@v1→Phase4/§6/§9。

未解决：无（所有决策已落到设计章节）。

## 12. 自审

- ✅ 需求覆盖：G1-G7 全部有对应 Phase/章节。
- ✅ Grill 覆盖：D-001..D-007 全部在 §5/§11 引用。
- ✅ 约束一致：AppError 异常、SQLModel+BaseModel、apiFetch、MarkdownText vi.mock、ruff 行宽100、样式参考 frontend-style-system——均对齐 CONVENTIONS。
- ✅ 真实性：所有文件路径/行号/方法名来自实读代码；`DaemonChangeWrite`/`change_write_router`/`proxy._await_change_write_receipt`/`_sync_docs`/`SpecWorkspaceService` 均真实存在。
- ✅ YAGNI：砍掉新建/删除/diff/全量 reparse（N1-N6）。
- ✅ 验收标准：每个端点有响应 schema；路径穿越/两分支/resync 有测试任务。
- ✅ 非目标清晰：N1-N6。
- ✅ 兼容策略：§9 三条回退路径。
- ✅ 生命周期契约表：§7.5 完整，6 事件，必需字段落点已标注；resync 时机经核实改为 POST 时（避免 daemon 先-complete-后-sync 竞态）。
- ✅ 自审存疑已解决：核实 daemon 侧 `runChangeWrite`（`task-runner.ts:1558-1606`）通用写 `files[]`，**无 create 专属副作用**（不强制建 MASTER、不依赖 change 是否已存在），edit-kind 行直接复用，daemon 端零改动。
