---
id: task-01
title: Add ppm/common/upload.py xlsx upload validation
title_zh: 新增 ppm/common/upload.py 通用 .xlsx 上传校验
author: qinyi
created_at: 2026-07-24 09:49:06
priority: P0
depends_on: []
blocks: [task-04]
requirement_ids: [FR-02]
decision_ids: [D-013@v1]
allowed_paths:
  - backend/app/modules/ppm/common/upload.py
provides:
  - contract: validate_xlsx_upload
    fields: []
expects_from: {}
goal: >
  抽一个通用 .xlsx 上传校验函数到 ppm/common，供 problem 导入端点复用，
  避免跨子域引用 plan 的私有 _validate_upload（D-013）。
implementation:
  - 新增 backend/app/modules/ppm/common/upload.py
  - 实现 validate_xlsx_upload(file: UploadFile, file_bytes: bytes) -> None：校验扩展名 .xlsx、大小上限（对齐 plan _validate_upload 的阈值）
  - 不通过时抛中立异常（如 PpmImportError 或复用 ppm/common 现有异常基类），不抛 PlanError
acceptance:
  - upload.py 存在 validate_xlsx_upload 函数
  - 非 .xlsx 文件被拒绝
  - 超大文件被拒绝
  - 异常类型不属于 plan 域
verify:
  - cd backend && uv run ruff check app/modules/ppm/common/upload.py
  - cd backend && uv run mypy app/modules/ppm/common/upload.py
constraints:
  - 不跨子域 import plan 的私有 _ 前缀函数
  - 不改 plan 现有 _validate_upload
---

# TaskCard — task-01

## 目标

在 `ppm/common/` 下新增 `upload.py`，提供通用 `.xlsx` 上传校验函数
`validate_xlsx_upload(file, file_bytes)`，供 Wave1 task-04 的 problem 导入端点
（`import-preview`）调用。校验逻辑对齐 plan 子域现有实现，但**不跨子域 import**
plan 的私有 `_validate_upload`（D-013@v1）。

## 参考依据

- **设计**：`design.md` §5 Wave1 step1、§6 文件清单、§10 R-06、§11 D-013@v1
- **计划**：`plan.md` task-01 行（W1 / P0 / 依赖空 / 阻塞 task-04）
- **源码参照（逻辑搬移，不改原函数）**：
  `backend/app/modules/ppm/plan/router.py:1009` `_validate_upload`
  - 阈值：`MAX_IMPORT_BYTES = 10 * 1024 * 1024`（`router.py:77`）→ 超 → 413
  - 扩展名/content_type：`name.endswith(".xlsx") or "spreadsheetml" in ctype or "xlsx" in ctype` → 否 → 415
- **命名风格**：对齐 `ppm/common/` 现有模块（`crud.py`/`export.py`/`fsm.py`/`data_scope.py`，
  小写模块名 + `__all__`）

## 实现要点

1. 新增 `backend/app/modules/ppm/common/upload.py`，导出
   `validate_xlsx_upload(file: UploadFile, file_bytes: bytes) -> None`。
2. 模块内定义常量（如 `MAX_IMPORT_BYTES = 10 * 1024 * 1024`），与 plan 阈值一致；
   不从 plan 反向 import 常量。
3. **中立异常**：在 `upload.py` 内定义自有异常（如 `PpmUploadError`，带可覆盖
   `http_status`），或复用 `ppm/common` 已有基类；**禁止抛 `PlanError`**
   （acceptance: 异常类型不属于 plan 域）。错误体翻译链同 plan，由
   `app.core.errors` 统一处理。
4. 校验顺序沿用 plan：先 size（413）→ 再扩展名/content_type（415）。
5. 纯函数、无 DB、无 IO，便于单测。

## 验收（必须全过）

- [ ] `validate_xlsx_upload` 函数存在于 `ppm/common/upload.py`
- [ ] 非 `.xlsx` 文件被拒绝（扩展名 + content_type 双判）
- [ ] 超大文件被拒绝（> 10 MiB）
- [ ] 抛出的异常类型**不属于 plan 域**（无 `from app.modules.ppm.plan` import）
- [ ] `ruff check` / `mypy` 通过（见 verify 命令）

## 边界 / 约束

- 不改 `plan/router.py` 现有 `_validate_upload`（plan 子域保持私有实现）。
- 不在本任务接线 router/service——调用方由 task-04 引入。
- 不引入 openpyxl（本任务只做上传前校验，解析在 task-02 `importer.py`）。
