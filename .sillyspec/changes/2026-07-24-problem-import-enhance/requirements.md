---
author: qinyi
created_at: 2026-07-24 14:12:57
---

# 需求规格（Requirements）— 问题清单导入增强

## 角色

| 角色 | 说明 |
|---|---|
| 项目经理 / 责任人 | 批量导入问题（含图片附件）、用下拉模板减少填错 |
| 系统管理员 | 同上（超管可操作所有项目） |
| 普通成员 | 受 data_scope 限制：模板下拉只见可访问项目/成员 |

## 功能需求（FR）

- **FR-01 动态模板下载**：GET /problem-list/import-template 返回动态 xlsx（18 列表头 + 隐藏 sheet + 数据有效性下拉）（D-002/D-007）。可测试：下载 xlsx 含 DataValidation + 隐藏 sheet。
- **FR-02 附件图片提取**：importer 提取 ws._images 按 anchor._from.row 关联数据行（D-001）。可测试：嵌图 xlsx 解析出 images + 锚点行。
- **FR-03 附件 ≤3 校验**：>3 张/行 valid=false 标红（D-005）。可测试：4 图行 valid=false。
- **FR-04 附件上传存 file_id**：import_commit 入库后逐图 upload_file → file_id 存 file_urls；单图失败 try/except + failed_rows 不中断（D-004/D-009）。可测试：导入后 file_urls 含 file_id；单图失败整批不回滚。
- **FR-05 导出 18 列对齐**：export-excel 列 = 导入模板 18 列，表头/顺序一致（D-003）。可测试：导出表头 = 模板表头。
- **FR-06 导出嵌图片**：附件列 add_image 嵌图（D-006/D-011 拆 async/sync 两段）。可测试：导出 xlsx 含图；导出→改→导回 file_id 链不断。
- **FR-07 list_problems_for_export 改写**：返回 18 列全字段含 file_urls（D-010）。可测试：返回 dict 含 file_urls。
- **FR-08 下拉范围**：project/member 按 data_scope 收敛，module 全部平铺（D-012）。可测试：下拉隐藏 sheet 含 data_scope 项目 + 全部模块。
- **FR-09 Pillow 依赖**：pyproject 加 Pillow>=10（D-008）。可测试：openpyxl add_image/_import_image 不 ImportError。
- **FR-10 前端预览附件列 + 下载模板动态**：modal 预览加附件列（计数+超额标红），下载模板走 GET /import-template（D-007）。可测试：预览渲染附件列；下载调动态端点。
- **FR-11 兼容**：原导入（无附件）仍工作；旧功能零回归（D-004 复用 file_id 语义）。

## 决策覆盖矩阵

| 决策 ID | 覆盖 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-02 | 附件图片导入（supersede 前置 D-007） |
| D-002@v1 | FR-01/08 | 动态下拉模板（supersede 前置非目标） |
| D-003@v1 | FR-05 | 导出对齐 18 列 |
| D-004@v1 | FR-04 | file_urls=file_id |
| D-005@v1 | FR-03 | 附件 ≤3 超额标红 |
| D-006@v1 | FR-06 | 导出嵌图非链接 |
| D-007@v1 | FR-01/10 | 模板下载改动态端点 |
| D-008@v1 | FR-09 | Pillow 依赖（grill B-001） |
| D-009@v1 | FR-04 | 逐图 try/except + failed_rows（grill B-002） |
| D-010@v1 | FR-07 | 改写 list_problems_for_export（grill B-003） |
| D-011@v1 | FR-06 | 导出拆两段 async/sync（grill B-004） |
| D-012@v1 | FR-08 | module 下拉平铺（grill B-005） |

全部 D-001~D-012 被 FR 覆盖。
