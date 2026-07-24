---
author: qinyi
created_at: 2026-07-24 14:15:00
plan_level: full
---

# 实现计划（Plan）— 问题清单导入增强

## Spike 前置验证

| Spike | 验证内容 | 不通过后果 |
|---|---|---|
| spike-01 | Pillow 装后 openpyxl `ws._images` 读取 + `add_image` 写入两端可用（D-008，grill B-001 P0） | task-02/05 图片读写推翻重设计 |

## Wave 1 — 后端（顺序，无前端依赖）

- [x] task-01: `pyproject.toml` 加 Pillow>=10 + spike 验证图像读写两端（覆盖：FR-09, D-008）
- [x] task-02: `importer.py` 提取 ws._images + anchor._from.row 关联行 + ImageExtracted（覆盖：FR-02, D-001）
- [x] task-03: `schema.py` PreviewRow 加 attachment_count/attachment_exceeded（覆盖：FR-03, D-005）
- [x] task-04: `service.py` import_preview 附件校验 + import_commit 逐图 upload_file try/except 存 file_id + 改写 list_problems_for_export 返回全字段（覆盖：FR-03/04/07, D-004/009/010）
- [x] task-05: `router.py` 新增 GET /import-template（动态下拉）+ 改 export-excel 拆两段嵌图（覆盖：FR-01/05/06/08, D-002/003/006/007/011/012）
- [x] task-06: 后端测试 test_importer/test_import_flow/test_template_export（覆盖：全 FR 验收）

## Wave 2 — 前端（依赖 Wave 1 端点）

- [x] task-07: `lib/ppm/problem.ts` downloadImportTemplate 改动态端点 + 类型加附件字段（覆盖：FR-10, D-007）
- [x] task-08: `import-problem-modal.tsx` 预览附件列（计数+超额标红）+ 下载模板走动态端点（覆盖：FR-10）
- [x] task-09: 删除静态 `public/templates/problem-import-template.xlsx`（覆盖：D-007）
- [x] task-10: `import-problem-modal.test.tsx` 适配（覆盖：FR-10 验收）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | Pillow 依赖 + spike | W1 | P0 | — | FR-09, D-008 | pyproject + 两端验证 |
| task-02 | importer 图片提取 | W1 | P0 | task-01 | FR-02, D-001 | ws._images + anchor |
| task-03 | schema 附件字段 | W1 | P0 | — | FR-03, D-005 | attachment_count/attachment_exceeded |
| task-04 | service 附件上传 + export 源改写 | W1 | P0 | task-02,03 | FR-03/04/07, D-004/009/010 | preview/commit/list_problems_for_export |
| task-05 | router 模板端点 + 导出嵌图 | W1 | P0 | task-04 | FR-01/05/06/08, D-002/003/006/011/012 | /import-template + export 拆两段 |
| task-06 | 后端测试 | W1 | P0 | task-01~05 | 全 FR | importer/flow/template_export |
| task-07 | 前端 client + 类型 | W2 | P0 | Wave 1 | FR-10, D-007 | downloadImportTemplate 动态 |
| task-08 | modal 附件列 + 下载动态 | W2 | P0 | task-07 | FR-10 | 预览附件 + 下载模板 |
| task-09 | 删静态模板 | W2 | P1 | task-07 | D-007 | 删 xlsx（前端改动态端点后删，避免旧前端 404） |
| task-10 | 前端测试 | W2 | P0 | task-08 | FR-10 | 适配 |

## 关键路径

task-01(spike) → task-02 → task-04 → task-05 → task-06（后端）→ task-07 → task-08（前端）。task-03 可与 task-02 并行；task-09 独立。

## 全局验收标准

- [ ] backend `cd backend && uv run pytest app/modules/ppm -q --no-cov` 通过（含附件/模板/导出嵌图用例）
- [ ] frontend `cd frontend && pnpm test` + `pnpm exec tsc --noEmit` 通过
- [ ] Pillow 装后 openpyxl 图像读写两端可用（spike-01）
- [ ] 附件图片 ≤3 导入 + 超额标红 + 单图失败不中断（failed_rows）
- [ ] 动态模板下拉（data_scope 项目/成员 + 模块全部平铺 + 枚举固定）
- [ ] 导出 18 列对齐导入模板 + 附件嵌图片 + 往返 file_id 链不断
- [ ] （brownfield）旧功能零回归（backend ppm + frontend vitest）

## 覆盖矩阵

| ID | 覆盖任务 | 验收 |
|---|---|---|
| D-001@v1 | task-02 | 图片提取 |
| D-002@v1 | task-05 | 动态模板端点 |
| D-003@v1 | task-05 | 导出 18 列 |
| D-004@v1 | task-04 | file_urls=file_id |
| D-005@v1 | task-03/04 | ≤3 超额标红 |
| D-006@v1 | task-05 | 导出嵌图 |
| D-007@v1 | task-05/07/09 | 模板下载动态 |
| D-008@v1 | task-01 | Pillow 依赖 |
| D-009@v1 | task-04/06 | 逐图 try/except |
| D-010@v1 | task-04 | list_problems_for_export |
| D-011@v1 | task-05 | 导出拆两段 |
| D-012@v1 | task-05 | module 平铺 |
| FR-01 | task-05/06 | 动态模板 |
| FR-02 | task-02/06 | 图片提取 |
| FR-03 | task-03/04/06 | ≤3 校验 |
| FR-04 | task-04/06 | 上传存 file_id |
| FR-05 | task-05/06 | 导出 18 列 |
| FR-06 | task-05/06 | 导出嵌图 |
| FR-07 | task-04 | list_problems_for_export |
| FR-08 | task-05/06 | 下拉范围 |
| FR-09 | task-01 | Pillow |
| FR-10 | task-07/08/10 | 前端附件列+下载动态 |
| FR-11 | task-06 | 兼容零回归 |
