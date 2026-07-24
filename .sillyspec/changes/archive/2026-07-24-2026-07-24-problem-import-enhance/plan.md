---
author: qinyi
created_at: 2026-07-24 16:30:00
plan_level: full
---

# 实现计划（Plan）— 问题清单导入增强

## Spike 前置验证
| Spike | 验证 | 不通过后果 |
|---|---|---|
| spike-01 | Pillow 装后 openpyxl ws._images 读 + add_image 写两端可用（D-008） | task-02/05 图片读写推翻 |

## Wave 1 — 后端
- [x] task-01: pyproject.toml 加 Pillow>=10 + spike 验证（D-008）
- [x] task-02: importer 提取 ws._images + anchor 关联行（D-001）
- [x] task-03: schema PreviewRow 加 attachment_count/exceeded（D-005）
- [x] task-04: service import_preview 附件校验 + import_commit 逐图 upload_file try/except + list_problems_for_export 全字段（D-004/009/010）
- [x] task-05: router import-commit multipart（D-013）+ GET /import-template 动态下拉（D-002/012）+ export-excel 拆两段嵌图（D-003/006/011）
- [x] task-06: 后端测试 图片/附件/模板/导出 14 用例

## Wave 2 — 前端
- [x] task-07: lib/ppm importProblemsCommit multipart + downloadImportTemplate 动态 + types（D-007/013）
- [x] task-08: modal 预览附件列 + 超额标红 + 下载模板动态
- [x] task-09: 删静态模板 xlsx
- [x] task-10: 前端测试适配 5 passed

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D |
|---|---|---|---|---|---|
| task-01 | Pillow 依赖 | W1 | P0 | — | FR-09, D-008 |
| task-02 | importer 图片 | W1 | P0 | task-01 | FR-02, D-001 |
| task-03 | schema 附件字段 | W1 | P0 | — | FR-03, D-005 |
| task-04 | service 附件/export源 | W1 | P0 | task-02,03 | FR-04/07, D-004/009/010 |
| task-05 | router 模板/导出嵌图 | W1 | P0 | task-04 | FR-01/05/06/08, D-002/003/006/011/012/013 |
| task-06 | 后端测试 | W1 | P0 | task-01~05 | 全 FR |
| task-07 | 前端 client+types | W2 | P0 | Wave1 | FR-10, D-007/013 |
| task-08 | modal 附件列+下载 | W2 | P0 | task-07 | FR-10 |
| task-09 | 删静态模板 | W2 | P1 | task-07 | D-007 |
| task-10 | 前端测试 | W2 | P0 | task-08 | FR-10 |

## 关键路径
task-01(spike) → task-02 → task-04 → task-05 → task-06（后端）→ task-07 → task-08 → task-10（前端）。

## 全局验收
- [x] backend ppm 463 passed + frontend 1073 passed + tsc/vitest
- [x] Pillow 两端 spike 通过
- [x] 附件图片 ≤3 + 超额标红 + 单图失败不中断
- [x] 动态模板下拉 + 导出 18 列嵌图往返
- [x] 零回归

## 覆盖矩阵
D-001~D-013 + FR-01~11 全映射到 task。
