---
author: qinyi
created_at: 2026-07-22T14:05:00
scale: large
---

# 设计文档（Design）— 平台级文件中心（MinIO + 通用上传/预览 + PPM 接入）

## 背景

项目目前**完全没有文件管理这一层**（后端无文件表、无对象存储、无上传接口、无 StaticFiles；前端只有一个"粘贴链接"组件 `ppm-file-urls.tsx`，无图片预览）。

但 PPM 的 task / plan / problem / kanban 四张表都**已预留 `file_urls: list[str]` JSON 字段**，schema/service/router 全链路能读写——只是当前只用来存网址字符串，且约 10 处该有附件的场景只有 2 处勉强接入（问题新建/编辑、看板任务详情只读），其余（问题详情、任务计划、任务详情/跨天填报、任务执行交付物+验证、看板创建/编辑、里程碑明细）全空着。

业务上 PPM 多处需要"上传附件 + 查阅附件 + 区分文件/图片 + 回显"。当前能力缺口大，且粘贴链接方式体验差、无法托管真实文件。

本变更建立**平台级通用文件中心**：一套全平台共用的文件服务（后端 `/api/file` + 前端通用上传/预览组件），MinIO 做 S3 兼容存储，PPM 各处附件接入。

> 本变更**覆盖** `2026-06-20-ppm-frontend-alignment` 的决策 **D-010@v1**（answer："纯前端 URL 管理，保持 D-007，不建文件服务"）——本次明确建立文件服务。

## 设计目标

- 建立**平台级文件管理能力**：上传、存储、下载/预览、元数据、软删除，所有模块共用。
- 存储用 **MinIO（S3 兼容）**，后端做**存储抽象层**，未来切换阿里云 OSS 等更强存储时**代码零改动**（仅改配置）。
- 前端提供**通用上传组件**（FileUpload，替换粘贴链接）和**通用预览组件**（FileViewer，图片缩略图+点击放大、文件图标+下载）。
- PPM 约 10 处附件场景**全部接入**，复用已有 `file_urls` 字段（语义从"网址"改为"文件 ID"）。
- 区分**图片/文件**：按 MIME 类型前端判定，图片可预览回显、文件提供下载，**不引入服务端图像处理**。

## 非目标

- **不做**服务端图片压缩/裁剪/缩略图生成（本期纯前端预览，不引入 Pillow 等图像库；未来需要再加）。
- **不做**预签名直传（方案 B，对 PPM 附件场景过度设计；保留后端代理链路）。
- **不新建** PPM 附件关联表（方案 C，改动面过大；复用 `file_urls` 存文件 ID）。
- **不做**文件配额管理、版本管理、全文检索（YAGNI，未来按需）。
- 本期**不做**按工作区/成员的强权限隔离（沿用 JWT 登录可见；后续可按 owner 加可见性）。
- 本期**不做**孤儿文件主动 GC（file_urls 删除时同步软删对应 File 即可；基于 owner 的孤儿扫描/回收列为未来增强，见 D-008）。
- 不改 PPM 的 `file_urls` 字段定义与前后端类型（`string[]` 不变，仅存的值语义从 URL → 文件 ID）。

## 拆分判断

- **单 change 整体推进**（不拆多 change）：存储后端、文件 API、前端组件、PPM 接入四者**功能内聚、共享 File 元数据表**，拆成多 change 会割裂共享模型、增加协调成本。
- **不走批量模式**：不是"同类页面重复改造"，而是新建一个中心 + 接入，分层交付。
- **plan 阶段按 4 波次拆分**（Wave1 存储基础设施 → Wave2 后端文件服务 → Wave3 前端组件 → Wave4 PPM 接入），波次间有依赖链但可顺序交付。

## 决策/方案选择

### D-001: 存储后端 —— MinIO 自建对象存储（用户确认）

**决策**：用 MinIO（S3 兼容协议）作为文件存储后端，docker-compose 新增 minio 服务。

**备选**：① 阿里云 OSS 直连（专业但需密钥/费用，且用户倾向先自建可控）；② 本地磁盘目录（简单但占服务器小盘、迁移/备份麻烦）。

**理由**：用户选择；MinIO 自建可控、无额外费用；**S3 兼容协议**是关键——未来切 OSS/其它 S3 存储只需改配置（endpoint/key/bucket）。

### D-002: 后端存储抽象层 StorageBackend（可扩展核心）

**决策**：后端建 `StorageBackend` 抽象接口（put/get/delete/head 对象），MinIO 是首个实现，通过工厂按配置选择。未来加 OSS 实现即可切换。

**理由**：这是"方便未来切更强文件系统"的真正保障（用户关注点）。切换点单一、边界清晰，不渗透到业务/前端。

### D-003: 上传链路 —— 后端代理上传（用户确认方案 A）

**决策**：前端 → `POST /api/file/upload`(multipart) → 后端接收 → 存 MinIO → 落 File 元数据表 → 返回 file_id。

**备选**：方案 B 预签名直传（前端直传 MinIO）。

**理由**：鉴权/校验集中在后端；链路最简、符合现有 Excel 导入（`UploadFile`）先例；**前端只认 `/api/file/*`，换存储前端完全无感**——反观预签名直传会把 MinIO 的 URL 格式/CORS 渗透到前端，换存储更脆弱。覆盖 D-010。

### D-004: 文件归属 —— 独立 File 元数据表 + owner 关联（用户确认）

**决策**：新建 `file` 表记录每个文件的元数据与归属（owner_type/owner_id/uploaded_by）。PPM 的 `file_urls` 字段改存**文件 ID**（不再存网址）。PPM 各处附件区**直接集成真上传**（非粘贴链接）。

**备选**：就地挂载（file_urls 继续存 URL，方案 B 思路）。

**理由**：用户选择独立文件库；统一文件库可按归属查阅、可清理孤儿文件、是真正的平台级文件中心。覆盖 D-010。

### D-005: 图片处理 —— 纯前端 MIME 预览（用户确认）

**决策**：图片/文件按 MIME 类型在前端判定，图片显示缩略图 + 点击放大（antd Image），非图片显示类型图标 + 下载。**不引入服务端图像处理**。

**备选**：服务端生成缩略图/压缩（引入 Pillow）。

**理由**：满足"区分文件/图片、回显"需求；复杂度低；PPM 附件量级下前端预览足够。

### D-006: PPM 归属存储 —— 复用 file_urls 存文件 ID（不新建关联表）

**决策**：PPM 各业务表的 `file_urls: list[str]` 字段**复用**，存的值从 URL 字符串改为文件 ID 字符串。字段定义、schema、前后端类型**全部不变**。

**备选**：新建 `file_relation` 关联表（file_id + owner_type + owner_id），废弃 file_urls。

**理由**：file_urls 已贯通 PPM 前后端全链路（task/plan/problem/kanban 的 model/schema/router/前端类型都有），复用改动面最小；关联表要改五子域 schema/service/router 全链路，改动过大。归属关系同时由 File 表的 owner_type/owner_id 记录（双写无害，便于文件中心查阅）。

### D-007: 组织方式 —— 单 change + 波次（不走批量）

**决策**：作为单个变更 `2026-07-22-platform-file-center`，plan 阶段分 4 波次。

**理由**：见「拆分判断」。

### D-008: owner_id 归属与"按归属查阅"（Design Grill blocker）

**决策**：`owner_id` 尽力填充——编辑/详情已有对象时上传必传 `owner_type`+`owner_id`；新建对象场景 `owner_id` 暂空（对象尚未创建），File 记录 `uploaded_by`。本期"文件中心查阅"以 `uploaded_by`（我的文件）+ `owner_type`（按业务类型）维度为主；"按具体业务对象归属精确查阅 / 孤儿回收"列为**未来增强**（需 temp_owner_key + PPM create 内回填 owner_id 的 bind 机制，会侵入 PPM 五子域 create 链路，本期不做以控制改动面）。

**备选**：新建场景用 temp_owner_key + PPM create 事务内回填 owner_id——归属精确但侵入 PPM create，改动面大。

**理由**：控制本期改动面；`file_urls` 已体现"文件属于哪个业务对象"（通过存在哪条记录的 file_urls 里），`owner_id` 为辅助索引；`uploaded_by` 提供最常用的"我的文件"查阅。

### D-009: 预览/下载安全契约（Design Grill blocker）

**决策**：`GET /api/file/{id}` 按 MIME 区分响应——**图片白名单**（`image/jpeg|png|gif|webp`）设 `Content-Disposition: inline` 浏览器内联预览；**其余所有类型**（含 `image/svg+xml`、`text/html`）强制 `Content-Disposition: attachment` 触发下载；上传类型白名单默认**排除** `text/html`、`image/svg+xml` 等可渲染危险类型。

**理由**：防止 SVG/HTML 在站点域内 inline 渲染导致 XSS；非图片一律下载，缩小攻击面（本期不做强权限隔离，安全契约更需明确）。

## 总体方案（4 Wave）

### Wave 1 — 存储基础设施（MinIO + 抽象层）

- `deploy/docker-compose.yml` 新增 `minio` 服务（`minio/minio` 镜像，9000 API + 9001 控制台，命名卷 `minio-data` 持久化，env `MINIO_ROOT_USER/PASSWORD`）；`deploy/docker-compose.dev.yml` 同步加（本地开发可用）。
- `backend/pyproject.toml` 加依赖 `aiobotocore`（异步 S3 客户端，匹配现有 asyncpg/httpx 异步栈）。
- `backend/app/core/config.py` 加配置：`storage_backend`(默认 minio)、`s3_endpoint`、`s3_access_key`、`s3_secret_key`、`s3_bucket`、`s3_region`、`file_max_size_mb`(默认 50)、`file_allowed_types`。`.env.example` 同步。

### Wave 2 — 后端文件服务（`app/modules/file/` + storage 抽象）

- 新建 `backend/app/modules/storage/`：`base.py`(StorageBackend ABC)、`minio_backend.py`(MinioStorage 实现)、`factory.py`(按配置选实现)。
- 新建 `backend/app/modules/file/`：`model.py`(File 表)、`schema.py`、`router.py`、`service.py`、`tests/`。
- `backend/migrations/versions/<rev>_create_file.py`：建 `file` 表。
- `backend/app/main.py` 挂载 `file_router` prefix=`/api/file`。
- 上传校验：大小（≤ `file_max_size_mb`，超限 413）、类型白名单（不符 415）。
- 鉴权：沿用现有 JWT deps，记录 `uploaded_by`。

### Wave 3 — 前端通用组件

- `frontend/src/components/file-upload.tsx`：FileUpload（受控 value=fileIds[]/onChange，antd Upload.customRequest 调 `/api/file/upload`，支持 accept 区分图片/文件、进度、删除；已上传项调 batch-meta 回显文件名/类型/大小）。
- `frontend/src/components/file-viewer.tsx`：FileViewer（只读，图片缩略图 + antd Image 放大、文件图标 + 下载链接）。
- `frontend/src/lib/file/api.ts`：uploadFile / fetchFileMetaBatch / getFileDownloadUrl（带 401 refresh 的 apiFetch）。

### Wave 4 — PPM 全场景接入（约 10 处）

替换 PpmFileUrls 为 FileUpload（编辑/创建）/ FileViewer（只读/详情）：
1. `ppm/problem-list/_forms.tsx`（已有 PpmFileUrls → FileUpload）
2. `ppm/_components/problem-detail-modal.tsx`（加 FileViewer）
3. `ppm/task-plans/page.tsx`（创建/编辑加 FileUpload）
4. `ppm/_components/task-detail-modal.tsx`（详情 FileViewer + 跨天填报可挂附件）
5. `ppm/task-execute/page.tsx`（attach_group_id / check_attach_group_id 接 FileUpload/FileViewer）
6. `ppm/kanban/_components/kanban-create-task-dialog.tsx`（FileUpload）
7. `ppm/kanban/_components/kanban-edit-task-dialog.tsx`（FileUpload，表单暴露 file_urls）
8. `ppm/kanban/_components/kanban-task-detail-drawer.tsx`（已有 PpmFileUrls 只读 → FileViewer）
9. `ppm/milestone-details/page.tsx`（PsPlanNodeDetail 附件）
10. `ppm/project-plans/page.tsx`（明细附件，按需）

`ppm-file-urls.tsx` 标记废弃（保留过渡或删除，plan 阶段定）。

## 数据模型

`file` 表（`backend/app/modules/file/model.py`，继承 `BaseModel(SQLModel)`，审计钩子自动记录）：

| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID | 主键 |
| owner_type | str(64) | 归属对象类型（如 `ppm_problem`/`ppm_task`/`ppm_plan`/`ppm_kanban_task`/`ppm_milestone`） |
| owner_id | UUID \| None | 归属对象 ID（允许空：先上传后绑定） |
| original_name | str(255) | 原始文件名 |
| stored_key | str(255) | MinIO 对象 key（如 `2026/07/<uuid>.<ext>`） |
| mime_type | str(128) | MIME 类型 |
| size | int | 字节数 |
| uploaded_by | UUID | 上传人 user_id |
| created_at | datetime | 上传时间 |
| deleted_at | datetime \| None | 软删除标记 |

> `file_urls` 语义变更：PPM 各表该字段从存 URL 字符串改为存 `file.id`（UUID 字符串）。字段/类型不变。

## API 设计（`/api/file`）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/file/upload` | multipart 上传，query `owner_type?`/`owner_id?`，返回 `{id, name, mime_type, size}` |
| GET | `/api/file/{id}` | 下载/预览，`StreamingResponse` + `Content-Type` 按 MIME（inline，鉴权） |
| GET | `/api/file/{id}/meta` | 单个元数据 |
| POST | `/api/file/batch-meta` | body `{ids:[]}` 批量取元数据（前端回显用） |
| DELETE | `/api/file/{id}` | 软删除（置 deleted_at，可选同步删 MinIO 对象） |

## 存储抽象层

```
StorageBackend(ABC)            # base.py: put_object/get_object_stream/delete_object/head_object
  └─ MinioStorage              # minio_backend.py: aiobotocore S3 客户端
  └─ (未来) OssStorage          # 加实现即可，factory 按配置选择
get_storage_backend()          # factory.py: 读 config.storage_backend 返回实现
```

**生命周期与可测试性**：MinioStorage 的 aiobotocore 客户端在 **FastAPI app lifespan 创建单例**（避免 per-request 开销），通过 **`Depends(get_storage_backend)` 注入** file service；测试用 `app.dependency_overrides` 注入 mock StorageBackend（不 monkeypatch factory）。aiobotocore 版本与现有 httpx/aiohttp 栈对齐在 plan task-02 锁定。

> 放置位置：`storage` 无 router/model/tests，本质是基础设施。本期放 `app/modules/storage/`（与 file 模块就近），plan 阶段若审查倾向 `core/storage/` 可调整，不影响契约。

## 前端组件

- **FileUpload**（受控）：`{value: string[], onChange, accept?: 'image'|'file'|'all', owner_type?, owner_id?, disabled?}`。antd Upload + **customRequest（基于 XHR，天然支持上传进度 onProgress）**；上传成功 onChange 追加 file id；已上传列表用 batch-meta 回显；图片项显示缩略图、文件项显示图标；每项可删除。**401 处理在 customRequest 内单独实现**（XHR 拦截 401 → refresh token → 重试），不走 `apiFetch`（fetch 无原生上传进度，与进度需求冲突）。编辑场景传 owner_type+owner_id，新建场景仅传 owner_type（owner_id 按 D-008 处理）。
- **FileViewer**（只读）：`{fileIds: string[]}`。batch-meta 取列表；图片 → 缩略图网格 + antd Image 预览；文件 → 图标 + 下载链接。

## PPM 接入策略

- `file_urls` 存值语义：URL → 文件 ID（`string[]` 类型不变，零类型改动）。
- 编辑/创建场景用 FileUpload，详情/只读场景用 FileViewer。
- 后端 PPM 各子域 model/schema/service/router **无需改**（file_urls 透传不变，只是存的是 ID）；前端各处把 PpmFileUrls 换成 FileUpload/FileViewer。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 改 | deploy/docker-compose.yml | 新增 minio 服务 |
| 改 | deploy/docker-compose.dev.yml | 新增 minio（本地开发） |
| 改 | backend/pyproject.toml | 加 aiobotocore 依赖 |
| 改 | backend/app/core/config.py | 加 storage 配置项 |
| 改 | backend/.env.example | 加 storage 环境变量 |
| 加 | backend/app/modules/storage/ | StorageBackend 抽象 + MinioStorage + factory |
| 加 | backend/app/modules/file/ | model/schema/router/service/tests |
| 加 | backend/migrations/versions/202607221500_create_file.py | 建 file 表（与 task-03 allowed_paths 一致；execute 时以 alembic 实际生成为准，若 hash 不同则同步更新 design+task） |
| 改 | backend/app/main.py | 挂载 file_router |
| 加 | frontend/src/components/file-upload.tsx | 通用上传组件 |
| 加 | frontend/src/components/file-viewer.tsx | 通用预览组件 |
| 加 | frontend/src/lib/file/api.ts | 文件 API 封装（XHR 上传 + 401 刷新 + batch-meta） |
| 加 | frontend/src/lib/file/utils.tsx | isImageMime / FileTypeIcon / formatFileSize |
| 加 | frontend/src/components/file-upload.tsx | 通用上传组件（受控，customRequest） |
| 加 | frontend/src/components/file-upload.test.tsx | 上传组件单测 |
| 加 | frontend/src/components/file-viewer.tsx | 通用预览组件（只读） |
| 加 | frontend/src/components/file-viewer.test.tsx | 预览组件单测 |
| 删 | frontend/src/components/ppm-file-urls.tsx | 废弃（被 FileUpload/FileViewer 取代） |
| 改 | frontend/src/app/(dashboard)/ppm/problem-list/_forms.tsx | PpmFileUrls → FileUpload（owner=ppm_problem） |
| 改 | frontend/src/app/(dashboard)/ppm/_components/problem-detail-modal.tsx | 加 FileViewer |
| 改 | frontend/src/app/(dashboard)/ppm/_components/task-detail-modal.tsx | 加 FileViewer |
| 改 | frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx | PpmFileUrls → FileUpload（owner=ppm_ps_plan_node_detail） |
| 改 | frontend/src/app/(dashboard)/ppm/kanban/_components/kanban-task-detail-drawer.tsx | PpmFileUrls(只读) → FileViewer |
| 改 | backend/conftest.py | db_engine fixture 注册 file 模型 |
| 改 | backend/uv.lock | aiobotocore 锁定 |
| 加 | .sillyspec/docs/backend/modules/storage.md | storage 模块卡 |
| 加 | .sillyspec/docs/backend/modules/file.md | file 模块卡 |
| 改 | .sillyspec/docs/backend/modules/_module-map.yaml | 注册 storage/file 模块 |
| 改 | .sillyspec/docs/frontend/modules/components-shared.md | 登记 FileUpload/FileViewer 新组件 |
| 加 | .sillyspec/changes/2026-07-22-platform-file-center/prototype-platform-file-center.html | 原型（已建） |

## 风险与回滚

- **MinIO 新增 docker 服务**：生产/开发部署都要同步起 minio；docker-compose 改动需重新 `up`。回滚：移除 minio 服务 + 删 file 模块。
- **file_urls 语义变更**：旧数据（URL 字符串）会显示异常。项目未上线（规则 11 允许重置数据），上线前清空历史 file_urls 或迁移。
- **aiobotocore 异步集成**：需正确处理 async S3 客户端生命周期（与 FastAPI 依赖注入对齐）；测试用 mock StorageBackend 避免依赖真实 MinIO。
- **大小/类型校验**：默认 50MB 上限、类型白名单（排除 html/svg 等危险类型，见 D-009），超限 413/415（对齐现有 Excel 导入 `_validate_upload` 模式）。50MB 整文件读入内存在 PPM 附件并发量级下可接受；未来大文件可改分片（aiobotocore multipart），本期不做。
- **XSS**：inline 预览仅限图片白名单，非图片强制 attachment（D-009 已缓解）。
- **回滚**：单 change，git revert（含移除 minio 服务、删 file 模块、file_urls 回 URL 语义）。

## 测试策略

- **后端**：file 模块 router/service 测试（MinIO 用 mock StorageBackend 注入，不依赖真实 MinIO）；StorageBackend 抽象层单测；上传大小/类型校验（413/415）；软删除。
- **前端**：FileUpload/FileViewer 组件测试（mock api，参考 `frontend-markdown-text-jsdom-null` 经验处理 antd 动态组件）。
- **migration**：file 表创建迁移（注意 migration chain，避免多 head，参照 `migration-chain-fragmentation-pattern`）。
- **集成**：上传 → 落库 → 下载 → 预览 → 删除 全链路（本地起 minio）。

## 自审

- **章节齐全**：背景/目标/非目标/拆分判断/决策 D-001~D-007/总体方案4Wave/数据模型/API/抽象层/前端/PPM接入/文件清单/风险/测试/自审。
- **方案自洽**：MinIO + 抽象层 + 后端代理 + 独立 File 表 + file_urls 存 ID + 前端 MIME 预览，逻辑闭环；可扩展性（切 OSS）由抽象层保障。
- **边界清晰**：非目标明确（不做服务端图像处理/预签名直传/关联表/配额/强权限隔离）。
- **覆盖旧决策**：明确覆盖 D-010@v1（不建文件服务）。
- **复用最大化**：file_urls 字段复用（类型不变）；FastAPI UploadFile/python-multipart 先例；JWT 鉴权；BaseModel 审计钩子。
- **依据充分**：现状调研两份 Explore 报告（后端无文件管理、前端仅 ppm-file-urls）；scan 文档（架构/约定/模块）。
