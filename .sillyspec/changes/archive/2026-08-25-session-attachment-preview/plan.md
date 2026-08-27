---
plan_level: full
---

# 实现计划（Plan）— 会话附件与文件统一在线预览

## Spike 前置验证

无独立 Spike：技术路线已经 Design Grill 独立审查确认（design.md §12 修订记录）。唯一技术
不确定性（SheetJS 官方源 tarball 安装可复现性）并入 task-01 首个任务实测，不通过即触发
R-02 三级退路（vendor 进仓 / 代理 / 换 exceljs），不影响其余任务。

## Wave 1（并行，无依赖）
- task-01
- task-02
- task-03
- task-04

## Wave 2（依赖 Wave 1）
- task-05
- task-06
- task-07

## Wave 3（依赖 Wave 1-2）
- task-08

## Wave 4（依赖 Wave 3）
- task-09
- task-10

## Wave 5（依赖全部）
- task-11

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 依赖引入 + 安装实测 | W1 | P0 | — | D-005@v1 | docx-preview（npm）+ xlsx 官方源 tarball；pnpm install 成功 + typecheck 不破即过；失败走 R-02 退路并回报 |
| task-02 | use-object-url hook | W1 | P0 | — | FR-06 | 拉取/loading/ok/error/retry、竞态防护、卸载与切换自动 revoke；单测覆盖生命周期 |
| task-03 | preview-registry | W1 | P0 | — | FR-03 | matchRenderer(blob.type > meta.mime > 扩展名)；单测覆盖六类格式与边界（无 mime/未知扩展名 → fallback） |
| task-04 | fetchAttachmentBlob 导出 | W1 | P1 | — | FR-01 | lib/api/session-attachments.ts 新增导出；401 单飞刷新对齐 fetchFileBlob 语义（F-5） |
| task-05 | image/pdf/fallback 渲染器 | W2 | P0 | task-03 | FR-02, D-003@v1 | antd Image 居中/iframe objectURL/不支持格式下载引导；冒烟测试 |
| task-06 | docx/xlsx 渲染器 | W2 | P0 | task-01, task-03 | FR-02, D-001@v1 | docx-preview 动态 import + 异常降级；SheetJS 多 sheet + 2000 行截断；jsdom 测试按 explorer 先例 mock |
| task-07 | markdown 渲染器 | W2 | P0 | task-03 | FR-02, D-006@v1 | 必须复用 ui/markdown-text.tsx（XSS 防线）；验收确认未直接 import @uiw |
| task-08 | FilePreviewModal 壳 | W3 | P0 | task-02, task-03, task-05, task-06, task-07 | FR-01, D-004@v1 | antd Modal（标题栏 FileTypeIcon+文件名+大小+下载+关闭；loading/error 重试态）；静态 import 六渲染器完成 registry 分发接线（编译期依赖渲染器文件，故排在渲染器之后，plan-review G2b）；一并落地 files/index.ts 目录导出（G1）；单测 |
| task-09 | attachment-chips 入口接入 | W4 | P0 | task-04, task-08 | FR-01 | 图片/文件 chip 全部可点击弹预览（图片新窗 `<a>` 路径移除）；交互测试 |
| task-10 | file-message-card + file-viewer 接入 | W4 | P0 | task-08 | FR-04, FR-05 | 卡片主体可点击（下载 stopPropagation、图片形态不动）；file-viewer 非图片项加"预览"；交互测试 |
| task-11 | 三主题核查 + 全量回归 | W5 | P0 | task-09, task-10 | FR-07 | blue/ai-native/dark 三主题下弹窗/加载/错误/fallback 走 token；pnpm typecheck/test/lint 全绿 |

## 关键路径

task-01 → task-06 → task-08 → task-09 → task-11（依赖安装→渲染器→Modal→入口→回归五边最长链；task-03→05/07→08 为并行支线。plan-review G2a 修正）

## 全局验收标准

1. `pnpm typecheck` / `pnpm test` / `pnpm lint`（frontend）全绿；
2. 三入口集成冒烟：会话附件 chip / agent 文件卡片 / 文件中心非图片项，点击均弹出预览窗且
   六种格式行为符合 FR-02（图片放大、PDF 内嵌、docx/xlsx 渲染、md 经 MarkdownText、pptx
   fallback）；
3. D-006 验收：markdown-previewer.tsx 未直接 import @uiw/react-markdown-preview（静态检查）；
4. 回归：不点击预览时既有行为不变（下载、file-message-card 图片放大、file-viewer 图片
   PreviewGroup、attachment marker 解析）；
5. 三主题（blue/ai-native/dark）下预览窗正常，无硬编码 hex（走 brand-* / 主题 token）。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-05, task-06, task-07 | 全局验收 2（六格式行为） |
| D-002@v1 | task-08, task-09, task-10 | 全局验收 2（三入口一致） |
| D-003@v1 | task-05 | 全局验收 2（PDF iframe） |
| D-004@v1 | task-08 | 全局验收 5（Modal 三主题） |
| D-005@v1 | task-01 | task-01 安装实测记录（R-02 退路未触发） |
| D-006@v1 | task-07 | 全局验收 3（静态检查无裸 @uiw import） |
| FR-01 | task-04, task-08, task-09 | 全局验收 2 |
| FR-02 | task-05, task-06, task-07 | 全局验收 2 |
| FR-03 | task-03 | task-03 单测 |
| FR-04 | task-10 | task-10 交互测试 |
| FR-05 | task-10 | task-10 交互测试 |
| FR-06 | task-02 | task-02 单测（revoke/竞态） |
| FR-07 | task-11 | 全局验收 5 |
