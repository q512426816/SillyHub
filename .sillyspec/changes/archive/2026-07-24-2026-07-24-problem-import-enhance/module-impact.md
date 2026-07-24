---
author: qinyi
created_at: 2026-07-24 16:30:00
---

# 模块影响分析（Module Impact）— 问题清单导入增强

14 文件（7M+4A+2A+1D），全匹配 backend/frontend。三重交叉（声明/任务/真实）一致。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 内容 | needs_review |
|---|---|---|---|---|
| backend | 新增依赖 | pyproject.toml+uv.lock | Pillow>=10（openpyxl 图像读写 D-008） | false |
| backend | 逻辑+数据结构 | importer.py | ws._images 提取+ImageExtracted+anchor+1 | false |
| backend | 数据结构 | schema.py | PreviewRow attachment_count/exceeded | false |
| backend | 逻辑 | service.py | import_preview 附件校验+import_commit 逐图上传 try/except+list_problems 全字段+images_by_row | false |
| backend | 接口+逻辑 | router.py | commit multipart D-013+/import-template 动态下拉+export 拆两段嵌图 | false |
| backend | 测试 | tests/* | 图片/附件/模板/导出 14 新用例 | false |
| frontend | 接口+数据结构 | problem.ts+types.ts | commit multipart+downloadImportTemplate 动态+attachment 字段 | false |
| frontend | 逻辑 | import-problem-modal.tsx | 预览附件列+超额标红+下载动态 | false |
| frontend | 测试 | .test.tsx | 附件超额+下载动态 2 用例 | false |
| frontend | 删除 | problem-import-template.xlsx | 静态模板→统一动态 | false |

**未匹配文件**：无（14 文件全匹配 backend/frontend）。
