---
author: WhaleFall
created_at: 2026-08-27 11:10:00
---

# 验证结果（Verify）— OnlyOffice 高保真 Office 预览（已退役）

> 归档期补记：变更期内经历多轮真实验证，最终以用户决策退役收尾。本记录沉淀
> 验证证据链与退役结论，供未来重启该方案时参考。

## 功能验证（变更期内，均通过后部署）

- **DS 9 严格 JWT**：两轮修复后三段签名（顶层 + document.token + editorConfig.token）通过；width/height 必须入签名（前端事后注入被拒的教训）
- **一次性令牌**：DS 容器内 curl 回拉成功（38912B OLE2 魔数验证）；同令牌二次请求 410（防重放生效）
- **降级链**：office-config 503 / api.js 加载失败 / DocEditor onError → 前端回落本地渲染器（多轮真实浏览器验证）
- **误降级修复**：替换式挂载检测（父容器 iframe / holder 消失）+ onDocumentReady 取消兜底，"先 DS 后回落"消失
- **字体修复**：方正内嵌子集（odttf 异或解混淆）装入 DS 容器，字形渲染正确（转换 PDF 内嵌字体表验证）

## 排版保真验证（决定退役的证据链）

1. **docGrid 行网格不支持**：DS 编辑器引擎 sdk-all.js（28MB）linePitch/docGrid 零命中——公文封面空段撑页失效，目录漂移到第一页，引擎级限制无配置可绕
2. **字体度量补丁无效**：hhea/OS/2 放大到 1.5x em 布局零变化——其行高不读字体垂直度量表
3. **LibreOffice 对照**：docGrid 完整支持（封面独立/目录第二页/使用说明第三页），但正文页数 46 v Word 42 偏差，用户不接受（ql-20260827-003）

## 终态测试

- backend preview_office：16/16 绿（含 LO 分支、DS 禁用语义、redis 快速失败）
- frontend files 套件：70/70 绿 + tsc 0 错
- 端到端：office-config 503 实测（env 关闭生效）

## 结论

方案实现完整、验证充分，但因排版保真度无法达到用户预期（Word 差异 + 页数偏差），
经用户决策退役。代码路径保留休眠（env 开关），重启成本一行配置。
