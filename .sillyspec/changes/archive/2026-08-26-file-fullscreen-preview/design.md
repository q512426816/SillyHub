---
author: qinyi
created_at: 2026-08-26 19:52:00
updated_at: 2026-08-26 19:52:00
scale: large
risk_level: unit-sufficient
modules: [backend, frontend, prototype]
---

# 设计文档（Design）— 文件全屏预览（统一预览弹窗升级 + 变更文件/explorer 接入）

> 原型：`prototype-file-fullscreen-preview.html`（可交互，全屏切换 + 图片缩放旋转示意）。
> 用户已在对话中确认四模块方案与覆盖范围（AskUserQuestion 三轮：图片后端一起做 / 覆盖统一弹窗+文件浏览器不含 git-log / 方案 A）。

## 1. 背景

平台的文件展示分散在多处，预览能力不一致：

- **统一预览弹窗 `FilePreviewModal`**（`frontend/src/components/files/file-preview-modal.tsx`）：会话附件、聊天文件卡、批任务产出文件、PPM 文件中心共用的预览壳，固定 `min(960px, 94vw)` 宽，**无全屏能力**——大图、宽表格、长文档在窄弹窗里看不全。
- **变更文件树**（`frontend/src/components/change-file-tree.tsx`）：非文本文件（含图片）只显示「暂不支持预览/编辑」一行提示（L377-380），变更目录里的原型图/截图完全看不了；文本预览区也无全屏。
- **工作区文件浏览器**（`frontend/src/components/explorer/file-preview.tsx`）：图片预览用原生 `<img>`（L223-227），**不能放大缩小**，也无全屏。

用户要求：变更文件（以及其他类似的展示功能）加全屏预览；图片支持放大缩小。

## 2. 设计目标

- FR-01 `FilePreviewModal` 支持全屏态：工具栏「全屏/退出全屏」切换，普通态样式不变，全屏态撑满视口、内容区占满可视高度。现有四类入口（会话附件/聊天文件卡/产出文件/文件中心）零改动自动获得该能力。
- FR-02 图片预览支持放大/缩小/旋转：复用 antd `Image` 内建 lightbox（`ImagePreviewer` 已在用），**零新增 npm 依赖**。
- FR-03 变更文件树接入统一预览：
  - FR-03a 非文本文件选中时，图片直接内联展示（antd Image 可缩放）；其他类型显示文件卡片 + 全屏入口。
  - FR-03b 预览工具栏新增「全屏预览」按钮，以 `defaultFullscreen` 打开 `FilePreviewModal`（文本/图片/PDF/HTML 原型均可全屏）。
- FR-04 后端新增变更文件二进制读取端点 `GET /api/workspaces/{wid}/changes/{cid}/files/raw`，供前端构造 Blob 预览。
- FR-05 explorer 文件浏览器：图片预览从原生 `<img>` 改 antd `Image`（可缩放）；预览头部新增「全屏预览」按钮走统一弹窗（PDF/Word 等窄区看不全时也可全屏）。

## 3. 非目标（Non-Goals）

- **git-log 提交文件列表**不加内容预览/全屏（用户确认排除；它是 diff 视图，语义不同）。
- 变更文件/explorer 入口**不接 OnlyOffice**：`officeSource` 仅支持 `session_attachment|file` 两类有平台 id 的来源，这两处无对应 id，本地渲染器（docx-preview/SheetJS）已够用。
- 不用浏览器原生 Fullscreen API（`requestFullscreen`）：iframe/弹窗嵌套场景兼容坑多（见 D-004）。
- 不做变更文件在线编辑二进制、不做 quicklog 文件清单可点击化、不改知识库/scan-docs 的 Markdown 渲染。
- 不改变现有普通态弹窗的尺寸与行为（零回归承诺）。

## 4. 拆分判断

单变更、前后端联动但目标单一（全屏预览能力贯通）。后端只加一个只读端点，无 schema/状态机变更，不值得拆两个 change；也不属 quick（跨 backend+frontend 两个模块、10+ 文件）。生命周期契约：**不涉及生命周期契约**（仅新增只读展示端点与前端展示逻辑，不触碰 daemon/session/lease/agent_run 状态机——变更目录由 daemon 同步属既有机制，本变更不改变其行为）。

## 5. 总体方案

方案 A（用户选定）：统一弹窗升级为预览中心，新入口全部接入 `FilePreviewTarget` 契约。

### Phase 1 — 后端 raw 端点（Wave 1）

`ChangeService.read_file_raw(workspace_id, change_id, rel_path)`：
- 从 `read_file` 中提取共用路径解析 helper `_resolve_change_file`（get change → resolve change_dir → 拼路径 → `relative_to` 穿越守卫，违反抛 `ChangeDocNotFound` 404），`read_file` 与 `read_file_raw` 共用，行为零变更。
- `full_path.read_bytes()`；大小上限 `MAX_RAW_BYTES = 50MB`，超限抛 `HTTPException(413)`（变更目录内容为原型图/文档，50MB 足够；文本端点维持既有 `MAX_CONTENT_BYTES=1MB` 不动）。
- 路由 `GET .../files/raw?path=`：`mimetypes.guess_type` 定 Content-Type（未知回 `application/octet-stream`），`StreamingResponse(BytesIO(data))` + `Content-Disposition: inline; filename*=UTF-8''...`（RFC 5987，explorer `download_explorer_file` 同款写法但 disposition 用 inline）。权限 `CHANGE_READ`，与 `files/content` 一致。

### Phase 2 — FilePreviewModal 全屏态 + 渲染器适配（Wave 2）

- 组件新增内部 state `fullscreen: boolean` + prop `defaultFullscreen?: boolean`（open 时初始化，target 切换不重置）。
- 全屏态：Modal `width="100vw"`、content 撑满 `100vh`、圆角清零、body 高度 `flex-1`（普通态维持 `min(960px,94vw)` + `max-h-[calc(100vh-220px)]` 不变）。进入全屏时 `document.body.style.overflow = "hidden"`，退出还原（antd Modal 打开本已锁滚动，此处兜底 Modal 内二次弹层场景；参考 agent-log-viewer.tsx L836-842 先例）。
- 工具栏（下载按钮左侧）新增全屏切换按钮：`ExpandOutlined`/`CompressOutlined`（@ant-design/icons，与弹窗现有图标体系一致），aria-label「全屏/退出全屏」。
- **Esc 行为**：保持 antd 默认（直接关窗），不做「先退全屏再关」的拦截（见 D-008 取舍）。
- `PreviewerProps` 新增可选 `fill?: boolean`，弹窗按 `fill={fullscreen}` 透传：渲染器根容器在 fill 态用 `h-full` 系替换固定高（`ImagePreviewer` `max-h-[560px]`→`max-h-full`；`PdfPreviewer` `h-[70vh]`→`h-full`；`OnlyofficePreviewer` `h-[74vh]`→`h-full`；docx/xlsx/markdown 滚动容器 `min-h-[420px]`→fill 态 `h-full`）。非 fill 态类名完全不变。
- 新增 **HtmlPreviewer**：`iframe sandbox="allow-scripts allow-popups"` + `srcDoc=blob.text()`（与 change-file-tree 内联 HTML 预览 L68-80 同款安全策略：不设 allow-same-origin，脚本可跑但隔离 cookie/storage/DOM）；`preview-registry` 增 `text/html`→html、`html/htm` 扩展名→html。变更目录里的交互原型（`prototype-*.html`）由此获得全屏能力。

### Phase 3 — 变更文件树接入（Wave 3）

`change-file-tree.tsx`：
- 工具栏（路径行右侧、「编辑」按钮组之前）新增「全屏预览」按钮 → 打开 `FilePreviewModal defaultFullscreen`，target 构造（Design Grill C-04 修正）：**统一走 raw 端点**——`fetch = fetchChangeFileRaw(...)`（.md/.txt 等文本同样走 raw：既规避 content 端点 1MB 截断导致大文件全屏静默截断，也让 blob.type/扩展名统一经 matchRenderer 分发；`matchRenderer` 的 EXT_MAP 对 md/markdown 兜底，mime 猜不出也不误判）。`download` = raw blob + `a.download`。编辑仍走现有 content 端点，零改动。
- 非文本选中态从「暂不支持预览」占位改为：图片扩展名（png/jpg/jpeg/webp/gif）→ 内联 `antd Image`（鉴权 objectURL，点击放大）；其他非文本 → 文件卡片（名称/大小/类型 + 「全屏预览」引导按钮）。数据流复用 Phase 1 的 raw fetch，`useObjectUrl` hook 管理生命周期。
- 编辑态、pending 轮询、保存逻辑零改动。

### Phase 4 — explorer 接入（Wave 4）

`explorer/file-preview.tsx`：
- `ImagePreview` 原生 `<img>` 改 `antd Image`（鉴权 objectURL 数据流不变：`fetchDownload` → objectURL → 卸载 revoke）。
- 头部（下载按钮旁）新增「全屏预览」按钮 → `FilePreviewModal defaultFullscreen`，target：`fetch = fetchDownload(workspaceId, filePath)`（blob.type 多为 octet-stream，meta.mime 传 null，靠扩展名 matchRenderer 分发）；**不传 officeSource**（D-007）。二进制分支（元信息卡）同样提供全屏预览按钮（当前只能下载，改后 docx/xlsx/pdf 全屏可看）。

## 6. 文件变更清单（File Changes）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/change/service.py | 提取 `_resolve_change_file` 路径守卫 helper（read_file 重构复用，行为零变更）；新增 `read_file_raw` + `MAX_RAW_BYTES=50MB`。数据流：producer=镜像目录文件字节 → `read_file_raw` (bytes) → consumer=router StreamingResponse |
| 修改 | backend/app/modules/change/router.py | 新增 `GET /changes/{cid}/files/raw`（CHANGE_READ；StreamingResponse + inline disposition + RFC5987 filename*）。字段数据流：producer=service.read_file_raw(bytes, media_type=guess_type) → router 组 headers → consumer=前端 fetchChangeFileRaw 的 Response.blob()（blob.type=media_type，matchRenderer 的权威分发源） |
| 修改 | backend/app/modules/change/tests/test_files_router.py | raw 端点用例：正常图片 200+Content-Type / 路径穿越 404 / 不存在 404 / 超限 413 / 无权限 403（files/* 端点既有用例与 workspace_with_changes fixture 均在此文件） |
| 生成 | backend/openapi.json、frontend/src/lib/api-types.ts | `pnpm gen:types` 再生成（CLAUDE.md 规则 21：后端 schema 改动必须同步） |
| 修改 | frontend/src/components/files/file-preview-modal.tsx | `fullscreen` state + `defaultFullscreen` prop + 工具栏切换按钮 + 全屏样式 + body 锁滚动 + `fill={fullscreen}` 透传渲染器 |
| 修改 | frontend/src/components/files/preview-registry.ts | MIME_MAP 增 `text/html`；EXT_MAP 增 `html/htm` → 新 key `html`；IMAGE_MIMES/EXT_MAP 增 svg/bmp/ico（Grill C-05：explorer 内联图片含这三类，全屏需一致可看） |
| 新增 | frontend/src/components/files/previewers/html-previewer.tsx | iframe sandbox srcDoc 渲染器（消费 PreviewerProps.blob.text()） |
| 修改 | frontend/src/components/files/previewers/index.ts | 导出 HtmlPreviewer；`PreviewerProps` 增 `fill?: boolean` |
| 修改 | frontend/src/components/files/previewers/image-previewer.tsx | fill 态高度适配（max-h-[560px]→max-h-full；非 fill 类名不变） |
| 修改 | frontend/src/components/files/previewers/pdf-previewer.tsx | fill 态高度适配（h-[70vh]→h-full；非 fill 类名不变） |
| 修改 | frontend/src/components/files/previewers/onlyoffice-previewer.tsx | fill 态高度适配（h-[74vh]→h-full；非 fill 类名不变） |
| 修改 | frontend/src/components/files/previewers/docx-previewer.tsx | fill 态滚动容器适配（min-h-[420px]→fill h-full） |
| 修改 | frontend/src/components/files/previewers/xlsx-previewer.tsx | fill 态滚动容器适配（min-h-[420px]→fill h-full） |
| 修改 | frontend/src/components/files/previewers/markdown-previewer.tsx | fill 态容器适配（min-h-[420px]→fill h-full） |
| 修改 | frontend/src/lib/change-files.ts | 新增 `fetchChangeFileRaw(workspaceId, changeId, path): Promise<Blob>`（裸 fetch + Bearer，apiFetch 是 JSON 封装不适用 blob，范式对齐 explorer fetchDownload） |
| 修改 | frontend/src/components/change-file-tree.tsx | 工具栏「全屏预览」按钮 + FilePreviewTarget 构造（文本/二进制两分支）+ 非文本选中态改图片内联/文件卡片 |
| 修改 | frontend/src/components/explorer/file-preview.tsx | ImagePreview 改 antd Image；头部「全屏预览」按钮（含二进制分支）接 FilePreviewModal |
| 修改 | frontend/src/components/files/__tests__/file-preview-modal.test.tsx | 全屏切换用例（defaultFullscreen 初始态、按钮切换、fill 透传） |
| 修改 | frontend/src/components/files/__tests__/onlyoffice-preview.test.tsx | 执行期偏差（QA 验收发现的回归修复）：枚举式 vi.mock("../previewers") 工厂补 HtmlPreviewer 替身——桶文件新导出未同步 mock 致套件加载失败，主代理事后兜底一行修复 |
| 修改 | frontend/src/components/files/__tests__/preview-registry.test.ts | html mime/ext 分发用例 |
| 修改 | frontend/src/components/__tests__/change-file-tree.test.tsx | 全屏预览入口 + 非文本选中态（图片内联）用例 |
| 修改 | frontend/src/components/explorer/__tests__/file-preview.test.tsx | antd Image 渲染 + 全屏按钮用例 |

## 7. 接口定义

### 7.1 后端：`GET /api/workspaces/{workspace_id}/changes/{change_id}/files/raw?path=`

- 权限：`Permission.CHANGE_READ`（与 files/content 一致）
- 返回：`StreamingResponse`，`Content-Type: mimetypes.guess_type(path)`（未知 `application/octet-stream`），`Content-Disposition: inline; filename="<ascii回退>"; filename*=UTF-8''<quoted>`，`Content-Length` = 实际字节数
- 错误：路径穿越/不存在 → 404（`ChangeDocNotFound`）；>50MB → 413；无权限 → 403
- service 签名：

```python
async def read_file_raw(
    self, workspace_id: uuid.UUID, change_id: uuid.UUID, rel_path: str
) -> tuple[bytes, str]:
    """返回 (文件字节, media_type)；穿越/不存在抛 ChangeDocNotFound，超限抛 HTTPException(413)。"""
```

### 7.2 前端

```typescript
// lib/change-files.ts
export async function fetchChangeFileRaw(workspaceId: string, changeId: string, path: string): Promise<Blob>;

// components/files/file-preview-modal.tsx
export interface FilePreviewModalProps {
  target: FilePreviewTarget | null;
  open: boolean;
  onClose: () => void;
  defaultFullscreen?: boolean; // 新增：open 时初始全屏态（缺省 false = 现状）
}

// components/files/previewers/index.ts
export interface PreviewerProps {
  blob: Blob; url: string; meta: FileMeta; onDownload: () => void;
  fill?: boolean; // 新增：true=撑满全屏容器，false/缺省=现状固定高
}

// components/files/preview-registry.ts
export type RendererKey = "image" | "pdf" | "docx" | "xlsx" | "markdown" | "html" | "fallback";
```

## 7.5 生命周期契约表

不涉及生命周期契约（本变更为纯展示层 + 只读端点，无 session/lease/agent_run/daemon 事件与状态迁移）。

## 8. 数据模型

无表结构/迁移变更。

## 9. 兼容策略（Brownfield）

- `FilePreviewModal`：`defaultFullscreen` 缺省 false、`fill` 缺省 false——现有四类入口（attachment-chips/file-message-card/run-file-artifacts/file-viewer）不传新 prop，渲染类名与尺寸完全不变，零回归。
- 后端 `read_file`/`files/content`：仅内部提取 helper，对外契约（响应模型/截断行为）不变。
- `preview-registry` 新增 html key：仅新映射，既有 mime/ext 映射不动；此前 html 落 fallback，现走 html 渲染器——对存量入口（会话附件里的 html）属能力增强，符合本变更目标。
- 未部署新后端时：变更文件树图片预览 fetch 404 → useObjectUrl error 态（弹窗场景复用现有重试 UI；树内联图片的 error 态 UI 需新写简单提示 + 引导下载），不阻塞其他功能。

## 10. 风险登记（Risk）

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | antd `Image` 内建 lightbox 与全屏 Modal 层级冲突 | P2 | antd v6 useZIndex 自动叠层（Modal=container+100，ImagePreview=consumer 再 +1），预览层天然高于 Modal，冲突概率低；实测若仍冲突用 `preview={{ getContainer }}` 挂到弹窗内容节点 |
| R-02 | 全屏态在超长文档/大图下无滚动或双滚动条 | P2 | body 容器统一 `overflow-auto` + 渲染器 fill 态 `h-full`；测试用例覆盖 |
| R-03 | raw 端点被大文件滥用（内存峰值 = 文件大小） | P2 | 50MB 上限 + CHANGE_READ 权限 + `asyncio.to_thread` 读盘；变更目录非公网上传面 |
| R-04 | HtmlPreviewer 的 iframe sandbox 与 change-file-tree 内联版行为不一致（原型的交互脚本跑不了） | P2 | 同款 `allow-scripts allow-popups` 不设 allow-same-origin；用仓库自身 prototype html 实测 |
| R-05 | explorer 下载端点 blob.type=octet-stream 导致 matchRenderer 误判 | P2 | meta.mime 传 null + 扩展名兜底（EXT_MAP）；office 家族靠扩展名命中本地渲染器 |
| R-06 | gen:types 触发无关旧测试债误报 | P2 | CLAUDE.md 规则 21 惯例：顺手补 mock 字段，不为躲报错改回手写 |

## 11. 决策追踪

见 `decisions.md`。当前版本决策与覆盖：

- D-001@v1（变更文件图片连后端一起做）→ FR-03/FR-04、§5 Phase 1/3
- D-002@v1（覆盖范围不含 git-log）→ §3 Non-Goals
- D-003@v1（方案 A 统一弹窗升级）→ §5 总体方案
- D-004@v1（CSS 伪全屏而非 Fullscreen API）→ §5 Phase 2
- D-005@v1（新增 HtmlPreviewer）→ §5 Phase 2、FR-03b
- D-006@v1（raw 50MB + inline disposition）→ §5 Phase 1、§7.1
- D-007@v1（explorer/变更文件不接 OnlyOffice）→ §3、R-05
- D-008@v1（Esc 保持 antd 默认关窗）→ §5 Phase 2
- D-009@v1（变更文件全屏预览统一走 raw 端点）→ §5 Phase 3、C-04

未解决争议：无（Design Grill 2026-08-26 独立审查通过，0 个 Unresolved Blocker；C-04/C-05/C-06/C-11/C-02 建议已吸收进正文，见 `.sillyspec/.runtime/stage-reviews/brainstorm-review-2026-08-26-195027/review.json`）。

## 12. 自审（Self-Review）

- ✅ 章节齐全（背景/目标/非目标/拆分判断/总体方案/文件清单/接口/生命周期豁免/数据模型/兼容/风险/决策/自审）。
- ✅ 每个 FR 有对应文件与测试落点；文件清单 16 行均能在代码库定位到既有范式（Modal 全屏参考 agent-log-viewer、StreamingResponse 参考 explorer download、iframe sandbox 参考 change-file-tree）。
- ✅ 字段数据流：raw 端点 media_type → Response blob.type → matchRenderer（§6 已标注）；defaultFullscreen/fill 均有缺省值兜底，无 dormant 字段。
- ✅ 生命周期关键词（daemon）出现处已紧邻豁免短语「不涉及生命周期契约」。
- ✅ 原型已生成（prototype-file-fullscreen-preview.html），交互与设计一致；原型中 Esc 先退全屏再关窗为演示简化，实现取 D-008（antd 默认直接关窗），差异已记录。
- ⚠️ 自审存疑 1：antd v6 Modal 全屏样式的具体写法（width=100vw 是否留边）需 execute 阶段实测微调，不影响契约。
- ⚠️ 自审存疑 2：`ImagePreviewer` 的 `max-h-full` 在 antd Image 外层容器上的表现（antd Image 自身是 wrapper div）需实测，必要时用 `style={{ height }}` 兜底。
