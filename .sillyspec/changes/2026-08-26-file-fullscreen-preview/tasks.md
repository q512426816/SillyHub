---
author: qinyi
created_at: 2026-08-26 20:02:00
updated_at: 2026-08-26 20:15:00
---

# 任务清单（Tasks）

- [x] task-01: 后端 raw 端点（service.read_file_raw + 路径守卫提取 + router + 测试）
- [x] task-02: gen:types 同步 + 前端 lib fetchChangeFileRaw (depends_on: task-01)
- [x] task-03: 渲染器层 fill 适配 + HtmlPreviewer + registry html/svg/bmp/ico（含测试）
- [x] task-04: FilePreviewModal 全屏态（fullscreen + defaultFullscreen + 工具栏按钮 + 测试） (depends_on: task-03)
- [x] task-05: 变更文件树接入（非文本态改造 + 全屏预览按钮 + 测试） (depends_on: task-02, task-04)
- [x] task-06: explorer 接入（antd Image + 全屏按钮 + 测试） (depends_on: task-04)
