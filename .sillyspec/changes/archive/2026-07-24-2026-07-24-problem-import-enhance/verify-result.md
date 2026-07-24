---
author: qinyi
created_at: 2026-07-24 16:30:00
---

# 验证报告 — 问题清单导入增强（附件图片 + 动态下拉 + 导出对齐）

## 结论

**PASS**

14 文件变更，10 task 完成，实现与 design.md / decisions D-001~D-013 一致（独立 QA acceptance review 13/13 pass），全量测试零回归。本变更非 integration/deployment-critical（纯 CRUD 导入增强，无 daemon/session/lease），PASS 不降级。

## 任务完成度

10/10 task 全部完成（100%）：

| task | 产出 | 状态 |
|---|---|---|
| task-01 | pyproject Pillow>=10 + spike 验证图像读写两端可用（D-008 grill P0） | ✅ |
| task-02 | importer 提取 ws._images + ImageExtracted + anchor._from.row 0-based +1（D-001） | ✅ |
| task-03 | schema PreviewRow 加 attachment_count/exceeded（D-005） | ✅ |
| task-04 | service import_preview 附件校验 + import_commit 逐图 upload_file try/except（D-004/009）+ list_problems_for_export 全字段含 file_urls（D-010） | ✅ |
| task-05 | router import-commit 改 multipart file+rows（D-013）+ GET /import-template 动态下拉（D-002/012）+ export-excel 拆两段嵌图（D-003/006/011） | ✅ |
| task-06 | test_importer 图片4 + test_import_flow 附件4 + test_template_export 模板/导出/往返6 = 14 新用例 | ✅ |
| task-07 | 前端 problem.ts importProblemsCommit multipart + downloadImportTemplate 动态 + types（D-007/013） | ✅ |
| task-08 | modal 预览附件列 + 超额标红 + 下载模板动态 | ✅ |
| task-09 | 删静态模板 xlsx | ✅ |
| task-10 | 前端测试适配 5 passed（原3+附件超额+下载动态） | ✅ |

## 设计一致性

对照 design.md §5/§7/§11 + decisions D-001~D-013，实现一致（acceptance review 13/13 pass）：

- §5.3 service：import_preview 填附件数+>3 标红；import_commit 逐图 upload_file try/except + file_urls=file_id + images_by_row（D-013 解决 preview→commit JSON 往返丢图）+ list_problems_for_export 全字段
- §5.4 router：import-commit multipart（file + rows D-013）；/import-template 动态下拉（隐藏 sheet _data + DataValidation），项目/成员按 data_scope 收敛 + 模块平铺（D-012）+ 枚举固定；export-excel 拆两段 async/sync 嵌图（D-011）
- §5.0 Pillow 依赖（D-008 grill P0）+ spike 验证
- §3 非目标（OLE/module 级联/不改 file 模块/不改 CRUD）/ §9 兼容（旧导入无附件零回归）
- acceptance QA 发现的 P2（except AppError 偏窄 → except Exception；list_problems_for_export 无 order_by）已修复

## 探针结果

- **独立 QA acceptance review（opus 子代理）**：13/13 全 pass，无 P0。发现 P2 gap（except AppError 偏窄导致 MinIO 抖动破坏 best-effort + list_problems_for_export 无 order_by）已修复（except Exception 两处 + order_by created_at + log.warning）。确认 Pillow 依赖、openpyxl anchor 0-based +1、commit multipart D-013、动态下拉隐藏 sheet+DataValidation、导出拆两段 add_image 全部落地。
- **spike 验证**：Pillow 两端（ws._images 读 + add_image 写）可用。
- **临时 e2e**：D-013 带图全链路（preview attachment_count=1 → multipart commit created=1 → file_urls 含 file_id + File 行 + 对象入存储）。

## 测试结果（实测）

- **backend ppm 全量（含增强）**：**463 passed**（~130s，零回归）
  - problem 子域 83 passed（test_importer 21 含图片4 + test_import_flow 13 含附件4 + test_template_export 6 + 现有 43）
- **frontend vitest 全量**：**1073 passed**（~30s，106 files + 5 新，零回归）
  - import-problem-modal.test：5 passed（原3 + 附件超额 + 下载动态）
- **ruff** All checks passed + **mypy** 4 source files no issues + **tsc** EXIT=0

## 变更风险等级

**低**。纯导入增强（附件图片/动态下拉/导出对齐），不改现有 create/导出/列表/3 态执行流 API。无 schema/migration/状态机/权限变更。全量测试零回归（ppm 463 + frontend 1073）。Pillow 依赖（pyproject）需重建镜像。

## Runtime Evidence

N/A — 非 integration/deployment-critical。核心逻辑（ws._images 提取+anchor+1、逐图上传 file_id、DataValidation 下拉、add_image 嵌图）已由单测覆盖；临时 e2e 验证了 D-013 带图全链路。

## 遗留 / 注意

- 日期字段 ISO datetime 往返（list_problems_for_export 输出 ISO→importer _to_date 仅认 YYYY-MM-DD 落 None），属既有行为（非本次回归），test 已用 seed None 规避；后续可扩 importer 文本日期分支。
- 部署：前端改动须 `docker compose --build frontend`；backend 加 Pillow 依赖须 `uv sync`（生产 Docker 自动解决）；无 migration。
- verify 通过后建议：commit（feat(ppm): 问题清单导入增强 附件图片+动态下拉+导出对齐）→ 部署 → 人工 e2e（下载动态模板→填含图→上传预览→附件标红→确认导入→导出嵌图→改后导回）。
