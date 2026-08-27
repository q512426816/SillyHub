---
author: WhaleFall
created_at: 2026-08-25 10:35:00
---
# 需求规格（Requirements）— 会话附件与文件统一在线预览

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在会话中上传文件给智能体、接收 agent 产出文件、使用文件中心的普通用户 |
| 前端开发者 | 后续扩展新预览格式的开发者（registry 加一行 + renderer 一个文件） |

## 功能需求

### FR-01: 会话附件可点击预览
覆盖决策：D-002@v1
Given 用户在会话面板查看历史消息，消息带附件（图片或文件）
When 点击任一附件 chip
Then 弹出统一预览窗（FilePreviewModal），按格式渲染内容，可下载、可关闭

Given 附件为图片（png/jpeg/webp/gif）
When 点击 chip
Then 预览窗内 antd Image 居中展示，可放大/缩放/旋转（原新窗打开路径移除）

Given 附件拉取失败（已删除/网络错误）
When 点击 chip
Then 预览窗显示错误态（"文件已失效或被清理"文案）与重试/关闭，不崩溃

### FR-02: 格式渲染覆盖
覆盖决策：D-001@v1, D-003@v1
Given 附件/文件为 PDF
When 打开预览
Then iframe 内嵌浏览器原生 PDF 视图（objectURL），可滚动翻页

Given 文件为 .docx
When 打开预览
Then docx-preview 渲染文档内容（标题/段落/表格）；渲染异常时显示错误态 + 下载引导，不白屏

Given 文件为 .xlsx
When 打开预览
Then SheetJS 渲染表格并支持多 sheet 切换

Given 单个 sheet 超过 2000 行
When 渲染
Then 只渲染前 2000 行并显示截断提示（防卡死）

Given 文件为 .md
When 打开预览
Then 经 MarkdownText（rehype-sanitize）渲染，**禁止裸用 @uiw 组件**（D-006@v1 XSS 防线）

Given 文件为 pptx 或其他不支持的格式
When 打开预览
Then 显示"该格式暂不支持在线预览"说明 + 醒目下载按钮

### FR-03: 格式匹配优先级
覆盖决策：（Design Grill F-2）
Given 会话附件 marker 仅含 id/kind/name（无 mime）
When 预览窗解析渲染器
Then 按 blob.type（后端 media_type 透传）> 入口 meta.mime > 扩展名 的优先级匹配

### FR-04: agent 文件卡片可预览
覆盖决策：D-002@v1
Given agent 回复中包含文件卡片（通用形态）
When 点击卡片主体（文件名区域）
Then 弹出统一预览窗；下载按钮独立可点（不触发预览）

Given 文件卡片为图片形态
When 查看缩略图
Then 维持现有 antd Image 放大交互不变（避免回归）

### FR-05: 文件中心非图片文件可预览
覆盖决策：D-002@v1
Given 文件中心查看器（FileViewer）列表中存在非图片文件
When 点击其"预览"入口
Then 弹出统一预览窗；既有下载图标保留；图片网格 PreviewGroup 行为不变

### FR-06: blob 生命周期统一管理
Given 预览窗打开（拉取 blob → objectURL）
When 预览窗关闭或切换文件
Then objectURL 自动 revoke，无泄漏；快速重复开关无竞态（stale 结果丢弃）

### FR-07: 三主题适配
Given 平台处于任一主题（blue/ai-native/dark）
When 打开预览窗
Then 弹窗壳/加载态/错误态/fallback 均走主题 token（brand-* 语义阶），无硬编码 hex；
docx/xlsx 白纸内容区在暗色主题下保持可读（纸张底允许保持浅色，模拟真实文档）

## 非功能需求

- 兼容性：纯前端增量；不点击预览时既有行为全部不变；不改后端 API/表/OpenAPI
- 可回退：预览入口组件级回退（三入口还原为不绑定 onClick 即回到现状）；无数据迁移
- 可测试：registry 匹配、useObjectUrl 生命周期（revoke/竞态）、渲染器冒烟、三入口交互均有
  vitest 用例（jsdom 无 createObjectURL 时按既有 explorer 测试 mock 先例处理）
- 依赖安全：不引入 npm xlsx@0.18.5（已知 CVE）；SheetJS 官方源 tarball 安装可复现性在
  execute 阶段实测（R-02 三级退路）

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-02 | 纯前端渲染路线，pptx fallback |
| D-002@v1 | FR-01/FR-04/FR-05 | 统一组件覆盖三入口 |
| D-003@v1 | FR-02 | PDF iframe 内嵌 |
| D-004@v1 | FR-01/FR-04/FR-05 | antd Modal 容器 |
| D-005@v1 | FR-02 | SheetJS 官方源选型 |
| D-006@v1 | FR-02 | md 必经 MarkdownText（XSS） |
