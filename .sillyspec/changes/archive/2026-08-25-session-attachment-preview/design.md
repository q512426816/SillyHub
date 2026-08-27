---
author: qinyi
created_at: 2026-08-25 10:20:00
updated_at: 2026-08-25 10:20:00
scale: large
modules: [frontend_components, frontend_lib]
prototype: prototype-session-attachment-preview.html
---

# 设计文档（Design）— 会话附件与文件统一在线预览

## 1. 背景

用户在智能体会话（运行时会话面板）中上传文件发给智能体解析后，**无法回看文件内容**：

- 用户消息附件 chips（`frontend/src/components/daemon/attachment-chips.tsx`）：图片 chip 点击仅
  `<a target="_blank">` 新窗打开；非图片 chip（`attachment-chips.tsx:72-80`）是**只读标签，
  不可点击、无下载入口**——这是用户直接痛点；
- agent 回复文件卡片（`frontend/src/components/daemon/file-message-card.tsx`）：图片可 antd Image
  放大、通用卡片仅下载按钮，**无在线查看**；
- 平台文件中心查看器（`frontend/src/components/file-viewer.tsx`）：图片有缩略图放大，非图片
  仅图标 + 下载链接，**无在线查看**。

前端目前没有任何 Office 文档渲染依赖（`frontend/package.json` 无 docx/xlsx/pdf 相关库）。

后端能力已齐备，本次**零后端改动**：

- 会话附件内容流：`GET /api/daemon/session-attachments/{id}/content`
  （`backend/app/modules/session_attachment/router.py:107-146`，inline disposition、JWT/X-API-Key
  双通道鉴权、ETag 304）；
- 文件中心内容流：`GET /api/file/{file_id}`（`backend/app/modules/file/router.py:96`，图片白名单
  inline 其余 attachment）。

前端已有鉴权拉 blob → objectURL 的成熟模式（`frontend/src/components/file-image.tsx`）。

## 2. 设计目标

1. **三入口统一**：用户会话附件 chips、agent 文件卡片、平台文件中心查看器，点击文件都能在
   弹窗内在线查看，体验一致；
2. **格式覆盖**（用户确认的需求范围）：
   - 图片（png/jpeg/webp/gif）：antd Image 放大/缩放/旋转；
   - PDF：浏览器原生内嵌视图（iframe + objectURL，零新依赖）；
   - Word（docx）：docx-preview 库保真渲染；
   - Excel（xlsx）：SheetJS 读取渲染，多 sheet 切换；
   - Markdown（md）：经 `MarkdownText` 渲染（基于已有 @uiw 库 + rehype-sanitize 防线）；
   - 其余格式（pptx/zip/…）：fallback——明确提示"暂不支持在线预览" + 醒目下载按钮；
3. **纯前端渲染**（D-001）：不引入后端转换服务、不加部署负担；
4. **组件架构可扩展**（D-002）：格式 → 渲染器注册表，新增格式只加一个 renderer 文件；
5. **blob 生命周期统一管理**：拉取/缓存/释放收敛到一个 hook，杜绝 objectURL 泄漏；
6. 三主题（blue/ai-native/dark）适配，色值走 brand-* 语义阶 token。

## 3. 非目标

- **不做 pptx 在线渲染**：前端库保真度不足（D-001 取舍），fallback 下载引导；后续社区成熟可加 renderer；
- **不做旧格式 Word/PPT**（.doc/.ppt 二进制格式）：纯前端无保真渲染方案，预览走 fallback
  下载引导。**例外（ql-20260825-004）**：.xls（BIFF 旧格式）经 SheetJS 渲染——其 read
  天然兼容 BIFF5/7/8，registry 以扩展名 xls 与 MIME application/vnd.ms-excel 归一到
  xlsx 渲染器（实测 OLE2 头二进制解析通过）；
- **不做后端 Office→PDF 转换**：不装 LibreOffice，不改 Docker 镜像；
- **不做协作编辑**：预览只读；
- **不改后端任何 API / 表结构 / 鉴权**：仅消费既有只读内容端点；
- **不做移动端 `m/` 适配**：预览入口均在桌面 dashboard 会话面板与文件查看组件（后续移动端
  如需接入复用同一组件）。

## 4. 拆分判断

单变更、不批量：改动集中于前端一个新目录（`components/files/`）+ 三个既有组件的接入改造，
互相依赖（registry 被 Modal 与三入口共用），拆多个变更反而要跨变更对齐接口。无批量模式适用
场景（非多个相似任务簇）。

**与既有 `explorer/file-preview.tsx` 的关系**（Design Grill F-4）：工作区文件浏览器已有一个
按扩展名分发的面板内嵌预览组件（数据源为 explorer 专用 API、嵌在侧板内，md 渲染复用
MarkdownText）。本变更是 **Modal 弹窗 + 双数据源（session-attachments/file）+ 三入口**的统一
预览，容器与数据源均不同，不合并（强行统一会把 explorer 的 API 耦合进通用组件）；但其
md 经 MarkdownText 渲染的做法是本设计 F-1 修正的直接先例，保持一致。

## 5. 总体方案

### Phase 1 · 统一预览基建（新组件，`frontend/src/components/files/`）

```
frontend/src/components/files/
├── file-preview-modal.tsx    ← 统一预览弹窗壳（antd Modal）
├── preview-registry.ts       ← 格式 → 渲染器匹配（MIME 优先，扩展名兜底）
├── use-object-url.ts         ← blob 拉取 + objectURL 生命周期 hook
└── previewers/
    ├── image-previewer.tsx      ← antd Image（放大/缩放/旋转）
    ├── pdf-previewer.tsx        ← iframe src=objectURL（零依赖）
    ├── docx-previewer.tsx       ← docx-preview 渲染进容器
    ├── xlsx-previewer.tsx       ← SheetJS 读 workbook → HTML 表格 + sheet 切换
    ├── markdown-previewer.tsx   ← @uiw/react-markdown-preview（已有依赖）
    └── fallback-previewer.tsx   ← 不支持格式：说明文案 + 下载按钮
```

数据流（一次预览的完整链路）：

```
用户点击入口(chip/卡片/列表项)
  → 入口组件打开 <FilePreviewModal fetch={取 blob 回调} meta={name/mime/size} />
  → Modal 内部 useObjectUrl(fetch)：
      idle → loading(fetch 带 JWT 拉 blob → URL.createObjectURL) → ok(objectURL)
                                                          ↘ error(可重试)
  → previewRegistry.matchRenderer(blob.type ?? meta.mime, filename) 解析渲染器类型
    （优先级：后端权威 media_type——经 blob.type 透传 > 入口 meta.mime > 扩展名兜底；
    会话附件 marker 不携带 mime，meta.mime 恒空，blob.type 是该入口唯一可靠来源）
  → 渲染器组件消费 { blob, objectURL, meta } 呈现
  → Modal 关闭/文件切换 → hook cleanup 自动 URL.revokeObjectURL
```

- 两个既有 blob 获取器直接复用，不新建 API 封装：
  - 会话附件：`fetchAttachmentObjectUrl` 已有（`frontend/src/lib/api/session-attachments.ts:60`），
    但 Modal 需要同时拿 Blob（docx/xlsx 渲染要 ArrayBuffer），新增
    `fetchAttachmentBlob(id): Promise<Blob>`（同文件补一个导出，走同一端点）；
  - 文件中心：`fetchFileBlob(fileId)` 已有（`frontend/src/lib/file/api.ts`）。
- 下载按钮：objectURL 已在手，`a[download]` 触发保存（文件名用 meta.name）。

### Phase 2 · 三入口接入

| 入口 | 现状 | 改造后 |
|---|---|---|
| `attachment-chips.tsx` | 图片新窗打开；非图片只读 | 所有 chip 可点击 → 打开预览 Modal；图片缩略图视觉保留 |
| `file-message-card.tsx` | 通用卡片仅下载 | 卡片主体可点击 → 预览 Modal；下载按钮保留 |
| `file-viewer.tsx` | 非图片仅下载图标 | 列表项增加"预览"按钮 → 预览 Modal；图片已有放大保持 |

### Phase 3 · 格式渲染细节

- **image**：`<Image>` 居中展示，`max-h` 约束，点击全屏放大（复用 antd 能力，与 file-image.tsx 交互一致）；
- **pdf**：`<iframe src={objectURL}>` 撑满内容区；浏览器原生 PDF 视图器自带缩放/翻页；
- **docx**：`docx-preview` 的 `renderAsync(buffer, container)` 渲染；渲染异常 try/catch → 错误态 + 下载引导；
- **xlsx**：SheetJS `read(arrayBuffer)` → 每个 sheet `sheet_to_html`；sheet 名 tab 切换；**大表保护**：
  单 sheet 超 2000 行只渲染前 2000 行 + 截断提示（防止长表格卡死弹窗）；
- **md**：`objectURL → blob.text()` 取源码 → **经 `MarkdownText` 组件渲染**
  （`frontend/src/components/ui/markdown-text.tsx`，自带 rehype-sanitize + ssr:false）。安全
  必修项（Design Grill F-1）：预览的 .md 是用户上传的不可信内容，@uiw 默认 rehype-raw 直出
  内嵌 HTML 构成存储型 XSS，必须走仓库既有 sanitize 防线，禁止裸用
  `@uiw/react-markdown-preview`；
- **fallback**：FileTypeIcon + "该格式暂不支持在线预览" + 格式说明 + 下载按钮。

### 生命周期契约表

本变更**不引入、不改变任何生命周期事件**（无 lease/claim/heartbeat/状态机变更；"会话附件"仅
消费既有只读内容端点）。涉及的既有端点均为幂等 GET：

| 消费端点 | 发起方 | 接收方 | 用途 | 状态变化 |
|---|---|---|---|---|
| GET /api/daemon/session-attachments/{id}/content | 前端预览 Modal | backend session_attachment | 拉附件 blob 预览 | 无（只读） |
| GET /api/file/{file_id} | 前端预览 Modal | backend file | 拉文件 blob 预览 | 无（只读） |

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | frontend/src/components/files/file-preview-modal.tsx | 统一预览弹窗壳：antd Modal（`FRONTEND_PAGE_STYLE.md` §6 弹窗规范，不用 Drawer），标题栏 FileTypeIcon+文件名+大小+下载+关闭，body 按 registry 分发，内置 loading spinner / error 重试态 |
| 新增 | frontend/src/components/files/preview-registry.ts | `matchRenderer(mime, filename) → renderer key`；匹配输入优先级 **blob.type（后端 media_type 透传）> meta.mime > 扩展名兜底**（会话附件 marker 无 mime，blob.type 是唯一可靠来源，Design Grill F-2）；导出 renderer key 常量与映射表 |
| 新增 | frontend/src/components/files/use-object-url.ts | hook：`useObjectUrl(fetcher)` → `{ blob, url, status: 'idle'/'loading'/'ok'/'error', retry }`；卸载/切换 cleanup 自动 `revokeObjectURL`；竞态防护（stale 结果丢弃） |
| 新增 | frontend/src/components/files/previewers/image-previewer.tsx | antd Image 渲染器 |
| 新增 | frontend/src/components/files/previewers/pdf-previewer.tsx | iframe 内嵌渲染器 |
| 新增 | frontend/src/components/files/previewers/docx-previewer.tsx | docx-preview 渲染器（动态 import，异常降级错误态） |
| 新增 | frontend/src/components/files/previewers/xlsx-previewer.tsx | SheetJS 渲染器（多 sheet tab、2000 行截断保护） |
| 新增 | frontend/src/components/files/previewers/markdown-previewer.tsx | md 文本读取 → **复用 `ui/markdown-text.tsx`**（rehype-sanitize 防 XSS，Design Grill F-1 必修；禁止裸用 @uiw 组件渲染不可信内容） |
| 新增 | frontend/src/components/files/previewers/fallback-previewer.tsx | 不支持格式说明 + 下载引导 |
| 新增 | frontend/src/components/files/previewers/index.ts | previewers 统一导出（PreviewerProps 类型 + 六渲染器组件） |
| 新增 | frontend/src/components/files/index.ts | 目录导出（FilePreviewModal / registry / useObjectUrl） |
| 新增 | frontend/src/components/files/__tests__/*.test.tsx | registry 分发、useObjectUrl 生命周期（revoke/竞态）、各 renderer 冒烟、三入口点击交互（vitest + testing-library，对齐 frontend 现有测试约定） |
| 修改 | frontend/src/components/daemon/attachment-chips.tsx | 图片 chip 与文件 chip 均改为可点击打开预览 Modal；保留缩略图视觉；移除新窗 `<a>` 路径（预览 Modal 内可放大） |
| 修改 | frontend/src/components/daemon/file-message-card.tsx | 通用卡片主体 onClick 打开预览 Modal（下载按钮 stopPropagation 保留）；图片形态维持 antd Image 放大不变（交互已达目标） |
| 修改 | frontend/src/components/file-viewer.tsx | 非图片列表项增加"预览"按钮打开预览 Modal（下载图标保留）；图片网格 PreviewGroup 保持 |
| 修改 | frontend/src/lib/api/session-attachments.ts | 新增 `fetchAttachmentBlob(id): Promise<Blob>` 导出（复用既有鉴权 fetch 逻辑，同一端点；Modal docx/xlsx 渲染需 Blob 而非现成的 objectURL）。顺带对齐 401 刷新语义：现有 `fetchAttachmentObjectUrl` 无 401 单飞刷新重试，新增导出走 `apiFetch` 同款 ensureFreshAccessToken 重试一次（Design Grill F-5），与 `fetchFileBlob` 行为一致 |
| 修改 | frontend/package.json | 新增依赖：`docx-preview`（npm 正常源）；`xlsx` 固定官方源 tarball `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`（D-005：npm 0.18.5 有已知漏洞 CVE-2023-30533/CVE-2024-22363，官方修复版仅官方源发布） |
| 修改 | frontend/pnpm-lock.yaml | 上述依赖的 lock 条目（由 `pnpm add` 自动更新，手工不编） |

**数据流标注**（新增 `fetchAttachmentBlob`）：producer=backend `GET .../{id}/content`（Blob 响应，
既有）→ `fetchAttachmentBlob`（新增导出，鉴权头复用既有实现）→ consumer=FilePreviewModal 的
useObjectUrl → 各 renderer（image/pdf 用 objectURL；docx/xlsx/md 用 Blob 取 ArrayBuffer/text）。
无后端字段/DTO 变更，`pnpm gen:types` 无需重跑（OpenAPI 无改动）。

**探针 5 豁免声明（verify）**：verify-probes 的 API parity 全仓扫描报 145 条 missing
（admin/auth/ppm/daemon 等 lib 旧文件）——均为平台既有前端调用与 endpoints.json 收录范围的
错配（全仓旧扫描噪音），与本变更无关：本变更零后端端点改动（§9），仅消费 2 个既有只读
端点（session-attachments content、file content），二者主分支长期工作。豁免判定依据
verify-result.md 探针 5 节。

## 7. 接口定义

```ts
// file-preview-modal.tsx
export interface FilePreviewTarget {
  /** 拉取文件 blob 的回调（各入口注入自己的鉴权获取器）。 */
  fetch: () => Promise<Blob>;
  /** 文件元信息（标题栏展示 + registry 匹配）。 */
  meta: {
    name: string;        // 原始文件名（含扩展名，registry 兜底匹配用）
    mime?: string | null; // MIME（可空——上传时浏览器可能不报）
    size?: number | null; // 字节（展示用，可空）
  };
  /** 可选：不拉 blob 直接下载的回调（fallback 下载复用入口已有 downloadFile）。 */
  download?: () => void | Promise<void>;
}
export function FilePreviewModal({
  target, open, onClose,
}: { target: FilePreviewTarget | null; open: boolean; onClose: () => void }): JSX.Element;

// preview-registry.ts
export type RendererKey = 'image' | 'pdf' | 'docx' | 'xlsx' | 'markdown' | 'fallback';
/** mime 传 blob.type ?? meta.mime（后端权威 media_type 优先；会话附件 marker 无 mime） */
export function matchRenderer(mime: string | null | undefined, filename: string): RendererKey;

// use-object-url.ts
export type ObjectUrlStatus = 'idle' | 'loading' | 'ok' | 'error';
export function useObjectUrl(
  fetcher: (() => Promise<Blob>) | null,
): { blob: Blob | null; url: string | null; status: ObjectUrlStatus; retry: () => void };
```

组件层级：`FilePreviewModal` 内部 `useObjectUrl(target?.fetch)` → `matchRenderer(blob.type ?? target.meta.mime, target.meta.name)` →
对应 previewer 组件统一 props `{ blob, url, meta }`。

## 8. 数据模型

无表结构变更、无后端 schema 变更、无 OpenAPI 变更。

## 9. 兼容策略

- 纯增量前端变更：不点预览时一切行为与现状一致；
- 三入口的既有下载能力全部保留（chip 预览不替代下载）；
- `file-message-card.tsx` 图片形态与 `file-viewer.tsx` 图片网格的现有放大交互不动（已达目标，
  避免回归）；
- 旧数据无需迁移：历史会话消息中的 `[附件:id|kind|name]` 标记行解析逻辑（runtime-session-helpers）
  不变，chips 渲染数据源不变，仅 chips 变可点击。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | docx-preview 对复杂排版（艺术字/嵌套图表/超大文档）渲染异常或性能差 | P1 | renderer try/catch → 错误态 + 下载引导；动态 import 按需加载不拖累首屏 |
| R-02 | SheetJS 官方源 tarball（cdn.sheetjs.com）在受限网络环境不可达：`frontend/Dockerfile` 现状因国外源 ECONNRESET 已全面走 npmmirror，该 tarball 是唯一绕过镜像直连官方源的依赖；CI（frozen-lockfile）与 Docker 每次全新 deps 层在无缓存时都必须下载它 | P1 | 如实登记不视为已解决（Design Grill F-3）：execute 阶段在本机实测 `pnpm install` 与 Docker build 可复现性；失败退路按序：① tarball vendor 进仓库（SheetJS Apache-2.0 许可允许再分发）② 构建机代理 ③ 换 exceljs 重写 xlsx renderer（渲染需自拼表格，工作量增大） |
| R-03 | 大 xlsx（数万行）全量渲染卡死弹窗 | P1 | 2000 行/表截断 + 提示完整内容请下载（设计内建） |
| R-04 | objectURL 泄漏（预览频繁开关） | P1 | useObjectUrl 统一生命周期管理 + 卸载 revoke，单测覆盖 |
| R-05 | iframe PDF 在个别旧浏览器不渲染 | P2 | 桌面 Chrome/Edge/Firefox/Safari 均支持 blob URL PDF；不支持时引导下载（PDF renderer 错误态） |
| R-06 | 用户对 pptx 不能预览有预期落差 | P2 | fallback 文案明确说明原因与替代路径（下载后本地打开） |
| R-07 | 会话附件已删除（草稿 48h 清理/已删除）导致拉取 404 | P2 | useObjectUrl error 态给"文件已失效或被清理"文案 + 关闭引导 |
| R-08 | md 预览渲染不可信内容构成存储型 XSS（@uiw 默认 rehype-raw 直出内嵌 HTML） | P0 | markdown-previewer 强制复用 `ui/markdown-text.tsx`（rehype-sanitize + MARKDOWN_SANITIZE_SCHEMA 既有防线），禁止裸用 @uiw 组件（Design Grill F-1 必修，execute/verify 均以此为验收项） |

## 11. 决策追踪

| 决策 | 内容 | 覆盖章节 |
|---|---|---|
| D-001@v1 | 纯前端渲染路线（不做后端转换，pptx 转下载引导） | §2.3 / §3 / §5 Phase3 / R-01 |
| D-002@v1 | 统一文件查看组件覆盖三入口（注册表架构） | §5 Phase1/2 / §6 |
| D-003@v1 | PDF 纳入预览（iframe 零依赖） | §5 Phase3 |
| D-004@v1 | 交互形态 antd Modal（规范禁 Drawer） | §6 file-preview-modal 行 |
| D-005@v1 | SheetJS 固定官方源 0.20.3 tarball（规避 npm 0.18.5 已知漏洞） | §6 依赖行 / R-02 |
| D-006@v1 | md 预览必须经 MarkdownText 渲染（XSS 防线，Grill F-1） | §5 Phase3 / §6 / R-08 |

无未解决决策。

## 12. 自审

- 章节齐全：背景/目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约表/数据模型/
  兼容策略/风险登记/决策追踪 —— ✅ 全含；
- 生命周期关键词检查：涉及 "session"（会话附件）→ 已附生命周期契约表，明确声明零生命周期
  变更、仅消费幂等只读 GET —— ✅；
- 文件清单核对：新增 10 个源文件 + 测试目录、修改 4 个既有文件 + 依赖清单，与 Phase 1/2 一一
  对应 —— ✅；
- YAGNI：未引入后端转换、未做移动端、未做旧格式 Office、未建新 API 封装层（复用既有
  fetcher）—— ✅；
- 兼容：不改 API/表/OpenAPI，三入口旧交互（下载）保留 —— ✅；
- 前端规范符合性：antd Modal（非 Drawer）、brand-* 语义阶、颜色不硬编码 hex、shadow 走主题
  token（FRONTEND_PAGE_STYLE.md §0/§0.5/§6）—— ✅；
- 类型纪律：无 OpenAPI 变更，不触发 gen:types —— ✅（若 execute 中发现 `AttachmentRead` 类型
  缺字段再按规则 21 走生成流程）。

**Design Grill 修订记录**（2026-08-25 独立审查子代理，specVerdict=pass / qualityVerdict=pass，
C-01~C-10 十项交叉核查，两大前提经源码核实成立：上传白名单允许 office 类型、零后端改动属实）：

- F-1（必修，已修）：md 预览补 XSS 防线规格——复用 MarkdownText，新增 R-08（P0）；
- F-2（已修）：matchRenderer 匹配优先级改为 blob.type > meta.mime > 扩展名（marker 无 mime）；
- F-3（已修）：R-02 缓解描述重写（原"frozen-lockfile 不再触网"技术性错误，改如实登记 + 三级退路）；
- F-4（已修）：§4 补与 explorer/file-preview.tsx 的不合并说明；
- F-5（已修）：fetchAttachmentBlob 对齐 401 单飞刷新语义；
- U-01（不阻塞）：部署环境对 cdn.sheetjs.com 可达性留待 execute 实测，退路已登记 R-02。
