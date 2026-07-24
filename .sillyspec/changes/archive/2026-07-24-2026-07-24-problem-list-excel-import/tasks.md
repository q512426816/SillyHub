---
author: qinyi
created_at: 2026-07-24 09:35:35
---

# 任务清单（Tasks）

> 只列任务名与归属 Wave，细节（步骤/验收/依赖）在 plan 阶段展开。

## Wave 1 — 后端解析与端点

- T1 `ppm/common/upload.py` 通用 .xlsx 上传校验（D-013）
- T2 `problem/importer.py` 纯解析 + 枚举规范化（按表头文字定位列/合并填充/日期/跳空行）
- T3 `problem/schema.py` 导入四件 DTO（PreviewRow/PreviewResp/CommitReq/ResultResp）
- T4 `problem/router.py` 新增 import-preview / import-commit 端点
- T5 `problem/service.py` import_preview（批量反查 + 严格校验）+ import_commit（重查 + date转换 + 字段映射 + 原子单次事务）
- T6 后端测试：`test_importer.py`（解析/枚举）+ `test_router.py` 增导入端点用例（标红/必填/原子/防篡改/权限）

## Wave 2 — 前端组件与接入

- T7 `lib/ppm/problem.ts` + `types.ts` 导入 client 函数与类型
- T8 `components/ppm/problem/import-problem-modal.tsx` 三态弹窗（复制 import-module-modal 范式）
- T9 `problem-list/page.tsx` 接入「导入」按钮
- T10 `frontend/public/templates/problem-import-template.xlsx` 静态模板
- T11 前端测试 `import-problem-modal.test.tsx`
