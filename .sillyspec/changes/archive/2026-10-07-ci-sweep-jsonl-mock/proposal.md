---
author: flow-machine-draft
created_at: 2026-10-07T15:31:05.409Z
---
# 提案书（Proposal）— 2026-10-07-ci-sweep-jsonl-mock

## 动机

任务原话转写：CI 红清偿补漏：frontend-ci 第 4 处失败（首轮排查 tail 截断漏看）——onlyoffice-preview.test.tsx 枚举式 vi.mock('../previewers') 缺 fa799e68b 新增的 JsonlPreviewer 导出，模块作用域炸掉整套件收集失败。测试文件自有注释即约定「枚举式工厂须随桶文件新导出同步补齐」，属既定惯例的漏补，生产零改动。

成功标准：
- onlyoffice-preview.test.tsx 的 ../previewers mock 补 JsonlPreviewer 桩导出，该文件全绿
- 顺带审计其余枚举式 previewers mock 无缺导出（file-preview-modal.test.tsx 已含 JsonlPreviewer）
- 本地仅跑相关两文件全绿（全量留 CI），frontend-ci 推送后转绿

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. onlyoffice-preview.test.tsx 的 ../previewers mock 补 JsonlPreviewer 桩导出，该文件全绿
2. 顺带审计其余枚举式 previewers mock 无缺导出（file-preview-modal.test.tsx 已含 JsonlPreviewer）
3. 本地仅跑相关两文件全绿（全量留 CI），frontend-ci 推送后转绿

## 成功标准（可验证）

1. onlyoffice-preview.test.tsx 的 ../previewers mock 补 JsonlPreviewer 桩导出，该文件全绿
2. 顺带审计其余枚举式 previewers mock 无缺导出（file-preview-modal.test.tsx 已含 JsonlPreviewer）
3. 本地仅跑相关两文件全绿（全量留 CI），frontend-ci 推送后转绿
