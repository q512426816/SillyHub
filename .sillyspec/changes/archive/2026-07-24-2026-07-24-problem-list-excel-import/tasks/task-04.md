---
id: task-04
title: Add import-preview/import-commit endpoints to problem/router.py
title_zh: problem/router.py 增 import-preview / import-commit 端点
author: qinyi
created_at: 2026-07-24 09:49:57
priority: P0
depends_on: [task-01, task-03]
blocks: [task-06, task-07]
requirement_ids: [FR-02, FR-11]
decision_ids: [D-001@v1, D-013@v1]
allowed_paths:
  - backend/app/modules/ppm/problem/router.py
provides: []
expects_from:
  task-01:
    - contract: validate_xlsx_upload
      needs: []
  task-03:
    - contract: ProblemImportPreviewResp
      needs: [rows, parse_errors, valid_count, invalid_count]
    - contract: ProblemImportCommitReq
      needs: [rows]
    - contract: ProblemImportResultResp
      needs: [created, skipped, failed_rows]
goal: >
  新增两个导入端点：preview 用 anyio.to_thread 包同步解析，commit 收 JSON 入库，
  权限对齐 create_problem。
implementation:
  - POST /api/ppm/problem-list/import-preview：UploadFile → 读 bytes → validate_xlsx_upload → anyio.to_thread.run_sync 包 service.import_preview
  - POST /api/ppm/problem-list/import-commit：ProblemImportCommitReq → service.import_commit
  - 权限依赖与 create_problem 一致（get_current_principal + 当前 user）
acceptance:
  - 两个端点注册且返回正确响应模型
  - import-preview 用 anyio.to_thread 包裹解析（不阻塞事件循环）
  - 权限依赖同 create_problem
verify:
  - cd backend && uv run pytest app/modules/ppm/problem/tests/test_import_flow.py -q
  - cd backend && uv run ruff check app/modules/ppm/problem/router.py
constraints:
  - 不改现有 problem 端点
  - 上传校验用 task-01 的 validate_xlsx_upload，不引 plan 私有函数
---

# task-04 — problem/router.py 增 import-preview / import-commit 端点

> 依据：design.md §7（端点定义/DTO）、§5 Wave1 step4、decisions D-001@v1（两步式）、D-013@v1（通用上传校验）；
> 范式参考 `backend/app/modules/ppm/plan/router.py:352-394`（import-preview/import-commit）；
> 权限风格参考本文件 `create_problem`（L196-209）。

## 现有代码已具备（无需新建）

- `router` 已 `tags=["ppm-problem"]`，由 main 以 `prefix="/api/ppm"` 挂载，本文件不再注册前缀。
- 已导入：`anyio`、`APIRouter`、`Depends`、`status`、`get_current_principal`。
- 已定义别名：`SessionDep = Annotated[AsyncSession, Depends(get_session)]`、`AuthUser = Annotated[User, Depends(get_current_principal)]`。
- `create_problem` 用 `session: SessionDep, user: AuthUser`——两个新端点沿用同一对依赖即满足「权限同 create_problem」（FR-11）。

## 需新增的 import

- `from fastapi import UploadFile, File`（当前文件未导入二者）。
- 从 `problem.schema` 增量导入 task-03 产出的 `ProblemImportPreviewResp`、`ProblemImportCommitReq`、`ProblemImportResultResp`。
- 从 `ppm.common.upload` 导入 task-01 产出的 `validate_xlsx_upload`（D-013：不引 plan 私有 `_validate_upload`）。

## 端点放置（关键）

字面量路径 `/problem-list/import-preview`、`/problem-list/import-commit` **必须前置于 `/problem-list/{item_id}` 参数化路由**，否则 FastAPI 按注册顺序把 `import-preview` 当 `item_id` 解析为 UUID 失败返回 422（与本文件 `export-excel` L170-171、`list-by-date-range` L222-226 同款坑）。建议插在 `export_problems`（L194）之后、`create_problem`（L196）之前。

## 代码骨架（对齐 plan/router.py:352-394）

```python
@router.post("/problem-list/import-preview", response_model=ProblemImportPreviewResp)
async def import_problems_preview(
    session: SessionDep,
    user: AuthUser,
    file: UploadFile = File(...),
) -> ProblemImportPreviewResp:
    file_bytes = await file.read()
    validate_xlsx_upload(file, file_bytes)  # task-01：中立异常 → AppError 翻译
    return await ProblemService(session).import_preview(file_bytes, user=user)


@router.post("/problem-list/import-commit", response_model=ProblemImportResultResp)
async def import_problems_commit(
    body: ProblemImportCommitReq,
    session: SessionDep,
    user: AuthUser,
) -> ProblemImportResultResp:
    return await ProblemService(session).import_commit(body, user=user)
```

注意：design §5 step4 写「router 用 anyio.to_thread.run_sync 包解析」，但解析在 service.import_preview 内部还是 router 层——由 task-05 落定；本端点按 design §7 的 service 签名 `import_preview(file_bytes, user)` 收口，解析线程化归 task-05 实现（R-03：不阻塞事件循环）。若 task-05 让 router 层负责包线程，则在此处用 `anyio.to_thread.run_sync(lambda: parse_problem_workbook(file_bytes))` 并把结果传 service，二选一在执行时与 task-05 对齐。

## 不做

- 不改 `create_problem` / export / list / 3 态执行流端点（constraints）。
- 不在本端点做反查/校验/入库（归 task-05 service）。
- 不二次包装 commit 结果（service 返回 `ProblemImportResultResp`，router 直接 return，对齐 plan 范式 L394）。
