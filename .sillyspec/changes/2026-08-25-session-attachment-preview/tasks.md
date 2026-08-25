---
author: WhaleFall
created_at: 2026-08-25 10:35:00
---
# 任务清单（Tasks）— 会话附件与文件统一在线预览

- [x] task-01: 依赖引入 docx-preview + SheetJS 官方源 tarball，安装可复现实测（失败走 R-02 退路）
- [x] task-02: use-object-url hook（blob 拉取/loading/error/retry、竞态防护、卸载自动 revoke）+ 单测
- [x] task-03: preview-registry 格式匹配（blob.type > meta.mime > 扩展名）+ 单测
- [x] task-04: fetchAttachmentBlob 导出 + 401 单飞刷新对齐
- [x] task-05: image/pdf/fallback 三渲染器 + 冒烟测试
- [x] task-06: docx/xlsx 渲染器（动态 import、异常降级、2000 行截断保护）+ 测试
- [x] task-07: markdown 渲染器（复用 MarkdownText，禁裸用 @uiw，D-006）+ 测试
- [x] task-08: FilePreviewModal 弹窗壳（标题栏/下载/loading/error + registry 分发）+ 单测
- [x] task-09: attachment-chips 会话附件入口接入（全部 chip 可点击）+ 交互测试
- [x] task-10: file-message-card + file-viewer 入口接入 + 交互测试
- [x] task-11: 三主题适配核查 + 全量回归（typecheck/test/lint）
