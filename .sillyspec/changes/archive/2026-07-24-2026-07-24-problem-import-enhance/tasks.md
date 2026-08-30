---
author: qinyi
created_at: 2026-07-24 14:12:57
---

# 任务清单（Tasks）— 问题清单导入增强

> 只列任务名与 Wave，细节在 plan 阶段展开。

## Wave 1 — 后端

- T1 `backend/pyproject.toml` 加 Pillow>=10 依赖（D-008）+ spike 验证 openpyxl 图像读写
- T2 `problem/importer.py` 扩展：提取 ws._images + anchor 关联行 + ImageExtracted（D-001）
- T3 `problem/schema.py` PreviewRow 加 attachment_count/exceeded（D-005）
- T4 `problem/service.py`：import_preview 附件校验 + import_commit 逐图 upload_file try/except 存 file_id（D-004/009）+ 改写 list_problems_for_export 返回全字段含 file_urls（D-010）
- T5 `problem/router.py`：新增 GET /import-template（动态下拉 data_scope+module 平铺，D-002/012）+ 改 export-excel 拆两段嵌图（D-003/006/011）
- T6 后端测试：test_importer（图片/锚点/≤3）+ test_import_flow（附件上传/file_id/超额/单图失败不中断）+ test_template_export（动态模板下拉/导出嵌图/18列）

## Wave 2 — 前端

- T7 `lib/ppm/problem.ts` downloadImportTemplate 改动态端点 + 类型加附件字段（D-007）
- T8 `import-problem-modal.tsx` 预览附件列（计数+超额标红）+ 下载模板走动态端点
- T9 删除静态 `frontend/public/templates/problem-import-template.xlsx`（统一动态）
- T10 `import-problem-modal.test.tsx` 适配（附件列 + 下载模板动态）
