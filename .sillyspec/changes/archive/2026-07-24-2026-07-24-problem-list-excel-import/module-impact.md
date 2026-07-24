---
author: qinyi
created_at: 2026-07-24 12:10:00
---

# 模块影响分析（Module Impact）— 问题清单 Excel 批量导入

## 背景

为问题清单（`/ppm/problem-list`）新增 Excel 批量导入功能，对齐项目计划导入的两步式范式（上传 → 预览标红 → 确认原子入库）。13 个文件变更（7 新增 + 6 修改），+677/-6 行，无 schema/migration/状态机/权限变更。

## 三重交叉验证

| 来源 | 范围 | 一致性 |
|---|---|---|
| 声明（design §6 文件变更清单） | 13 文件（backend ppm/problem + common + frontend lib/components/app/templates） | ✅ |
| 任务（plan.md 11 task allowed_paths） | 同上 13 文件 | ✅ |
| 真实（git diff --name-only --cached） | 13 文件（见下表） | ✅ 基准 |

三重一致，无声明/任务/真实偏离。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| backend | 新增 + 接口变更 | `backend/app/modules/ppm/common/upload.py` | 新增通用 .xlsx 上传校验 `validate_xlsx_upload`（中立异常 PpmUploadError，D-013） | false |
| backend | 新增 | `backend/app/modules/ppm/problem/importer.py` | 新增纯解析 `parse_problem_workbook` + ParsedProblemRow（按表头文字定位列/合并填充/日期序列号/枚举是/否→1/0，D-001） | false |
| backend | 接口变更 + 数据结构变更 | `backend/app/modules/ppm/problem/schema.py` | 新增 4 导入 DTO（PreviewRow 24字段/PreviewResp/CommitReq/ResultResp，D-003） | false |
| backend | 接口变更 | `backend/app/modules/ppm/problem/router.py` | 新增 2 端点 POST /problem-list/import-preview（UploadFile→anyio.to_thread→service）、/import-commit（JSON→service），路由前置于 /{item_id} | false |
| backend | 逻辑变更 | `backend/app/modules/ppm/problem/service.py` | 新增 import_preview（批量反查 project/module/项目成员 + 严格校验 + 短路）/ import_commit（重查防篡改 + data_scope + 原子单次 commit + 字段映射 module_name→model_name + status/created_by，D-002/004~014） | false |
| backend | 新增 | `backend/app/modules/ppm/problem/tests/test_importer.py` | 解析单测 17（含官方模板表头用例，P1 回归防护） | false |
| backend | 新增 | `backend/app/modules/ppm/problem/tests/test_import_flow.py` | 端点集成测试 9（未匹配标红/必填/原子回滚/防篡改/data_scope 越权/权限 401） | false |
| frontend | 逻辑变更 | `frontend/src/lib/ppm/problem.ts` | 新增 importProblemsPreview（multipart uploadExcelWithAuth）/ importProblemsCommit（apiFetch JSON） | false |
| frontend | 数据结构变更 | `frontend/src/lib/ppm/types.ts` | 新增 4 类型（PreviewRow/PreviewResp/CommitReq/ResultResp，对齐后端 DTO） | false |
| frontend | 新增 | `frontend/src/components/ppm/problem/import-problem-modal.tsx` | 三态导入弹窗（上传/预览全字段标红/结果统计，复制 import-module-modal 范式适配单表 rows） | false |
| frontend | 新增 | `frontend/src/components/ppm/problem/import-problem-modal.test.tsx` | 组件测试 3（三态/标红/提交回传） | false |
| frontend | 逻辑变更 | `frontend/src/app/(dashboard)/ppm/problem-list/page.tsx` | 顶部「导出」旁接入「导入」按钮 + 渲染弹窗（onSuccess→load 刷新） | false |
| frontend | 新增 | `frontend/public/templates/problem-import-template.xlsx` | 17 列全字段中文表头 + 1 行示例（D-003） | false |

## 未匹配文件

无。13 个文件全部匹配到 module-map 的 `backend/**` / `frontend/**` glob。

## 影响总结

- **接口变更**：新增 2 个 REST 端点（import-preview/import-commit），不改现有 problem API。
- **数据结构变更**：新增 4 Pydantic DTO + 4 前端类型（纯新增，不改现有）。
- **逻辑变更**：service 新增导入方法（不改 create_problem/_backfill_names/_Crud）；page.tsx 加按钮（不改现有逻辑）。
- **无 schema/migration/状态机/权限/配置/入口文件变更**。
- 零回归：backend ppm 449 passed + frontend vitest 1068 passed。
