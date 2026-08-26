---
author: qinyi
created_at: 2026-08-26 20:01:00
updated_at: 2026-08-26 20:01:00
---

# 提案书（Proposal）

## 动机

平台的文件展示功能分散在多处且预览能力不一致：统一预览弹窗无全屏（大图/宽表/长文档看不全），变更文件树的非文本文件（含图片）完全不能预览，工作区文件浏览器图片不能放大缩小。用户要求给变更文件及其他类似展示功能补齐「全屏预览 + 图片缩放」能力。

## 关键问题

1. **统一预览弹窗 `FilePreviewModal` 固定 `min(960px, 94vw)` 无全屏**——会话附件、聊天文件卡、批任务产出文件、PPM 文件中心四个入口共用，全都看不全大内容。
2. **变更文件树非文本分支只显示一行「暂不支持预览/编辑」**——变更目录里的原型图/截图完全看不了；后端也只支持读 UTF-8 文本（1MB 截断），无二进制通道。
3. **工作区文件浏览器图片用原生 `<img>`**——不能放大缩小，无全屏；PDF/Word 窄区看不全也没有全屏出口。

## 变更范围

- `FilePreviewModal` 增加全屏态（工具栏切换按钮 + `defaultFullscreen` prop），渲染器增加 `fill` 高度适配；新增 HtmlPreviewer 渲染器（iframe sandbox）。
- 变更文件树接入统一预览：非文本文件图片内联展示（antd Image 可缩放）、工具栏「全屏预览」按钮。
- 后端 change 模块新增二进制读取端点 `GET /changes/{cid}/files/raw`（CHANGE_READ、路径穿越守卫、50MB 上限、mimetypes 猜 Content-Type）。
- explorer 文件浏览器：图片改 antd Image；头部加「全屏预览」按钮（含二进制分支）。
- `pnpm gen:types` 同步 openapi.json + api-types.ts。

## 不在范围内（显式清单）

- 不做 git-log 提交文件列表的内容预览/全屏（D-002@v1，用户确认排除）。
- 变更文件/explorer 入口不接 OnlyOffice 高保真预览（D-007@v1，无 officeSource 对应 id）。
- 不用浏览器原生 Fullscreen API（D-004@v1）。
- 不做变更文件在线编辑二进制、quicklog 文件清单可点击化、知识库/scan-docs 渲染改造。
- 不改变普通态弹窗尺寸与行为、不改 daemon 同步机制、无表结构变更。

## 成功标准（可验证）

- 现有四类弹窗入口不传新 prop 时，弹窗样式/尺寸/行为与现状完全一致（零回归）。
- 弹窗工具栏出现全屏切换按钮；全屏态撑满视口，图片可放大/缩小/旋转（antd Image 内建）。
- 变更详情里选中 png 文件：右侧内联显示图片且可点击放大；「全屏预览」打开全屏弹窗。
- `GET .../files/raw` 对图片返回 200+正确 Content-Type；路径穿越/不存在 404；>50MB 413；无权限 403。
- explorer 选中图片：可放大缩小；「全屏预览」按钮打开全屏弹窗；svg/bmp/ico 与 png 行为一致。
- 后端 pytest 与前端 vitest 全绿；`pnpm gen:types` 产物已提交。
