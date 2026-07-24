---
id: task-05
title: Add /import-template endpoint + rewrite export-excel with embedded images
title_zh: router 新增 /import-template 动态下拉模板 + 改 export-excel 拆两段嵌图片
author: qinyi
created_at: 2026-07-24 14:21:00
priority: P0
depends_on: [task-04]
blocks: [task-06, task-07]
requirement_ids: [FR-01, FR-05, FR-06, FR-08]
decision_ids: [D-002@v1, D-003@v1, D-006@v1, D-007@v1, D-011@v1, D-012@v1]
allowed_paths:
  - backend/app/modules/ppm/problem/router.py
provides:
  - contract: GET /problem-list/import-template
    fields: []
  - contract: GET /problem-list/export-excel
    fields: []
expects_from:
  task-04:
    - contract: list_problems_for_export
      needs: [file_urls, project_name, module_name, model_name, pro_desc, pro_type, is_urgent, func_name, duty_user_name, find_by, find_time, plan_start_time, plan_end_time, audit_user_name, work_load, work_type, pro_answer, is_delay_plan, remarks]
goal: >
  新增动态下拉模板端点 + 改导出 18 列对齐导入并嵌图片（拆 async/sync 两段）。
implementation:
  - GET /problem-list/import-template：查 data_scope 内项目（PpmProjectMaintenance.project_name）+ 项目成员（PpmProjectMember 姓名）+ 全部模块（PlanNodeModule.module_name 去重平铺）+ 固定枚举 → openpyxl 生成 xlsx（主表 18 列表头 + 隐藏 sheet _data 分列存 project/member/module/枚举 + 主表 DataValidation type=list 引用隐藏 sheet：项目/责任人/验证人/模块列 + 问题类型/加急/延期 固定 list）→ excel_response（路由前置 /{item_id}）
  - 改 export-excel：拆两段（D-011）—— ① async 段调 list_problems_for_export 取 18 列 + 对每行 file_urls 调 FileService.get_stream 收集图 bytes；② anyio.to_thread.run_sync 包同步段 openpyxl 构造 workbook（18 列表头 + 数据行 + 附件列对每行 images add_image(Image(BytesIO(bytes)), anchor 锚到该行附件列单元格)）→ excel_response
  - router 注入 storage/settings（task-04 import_commit 需 FileService，本 task export 需 get_stream，接线）
acceptance:
  - /import-template 返回 xlsx 含下拉（DataValidation）+ 隐藏 sheet
  - export-excel 返回 18 列 xlsx 含嵌图片
  - 两端点路由前置于 /{item_id}
verify:
  - cd backend && uv run pytest app/modules/ppm/problem/tests/test_template_export.py -q
  - cd backend && uv run ruff check app/modules/ppm/problem/router.py && uv run mypy app/modules/ppm/problem/router.py
constraints:
  - export 拆两段（get_stream AsyncIterator 不能在 sync 里 await，D-011）
  - module 下拉全部平铺（DV 列级静态不支持级联，D-012）
  - 端点字面量路径前置（对齐 export-excel 现有约定）
---

# task-05 — router 新增 /import-template 动态下拉模板 + 改 export-excel 拆两段嵌图片

> 依据：design.md §5 Wave1.4（router 两端点）、§7（接口定义 18 列 + 隐藏 sheet + DV）、§10 R-07（导出嵌图跨 async/sync 拆两段）、decisions D-002@v1（动态下拉模板）、D-003@v1（导出 18 列嵌图）、D-006@v1（嵌图非链接）、D-007@v1（模板下载改动态端点）、D-011@v1（导出拆两段）、D-012@v1（module 全部平铺，DV 不支持按行级联）；
> 范式：`backend/app/modules/ppm/common/export.py`（`ColumnDef` L43、`rows_to_workbook` L67、`excel_response` L183）、`backend/app/modules/file/service.py`（`get_stream` L109 返回 `tuple[File, AsyncIterator[bytes]]`，async 段需 `async for chunk in stream` 收 bytes）；
> 现有 router.py：`export_problems` L186-197（现 6 列 `_PROBLEM_COLUMNS` L176 + `anyio.to_thread.run_sync(_build_excel_response)`）、`import-preview` L205 / `import-commit` L227（字面量前置）、参数化 `/{item_id}` L280。

## /import-template 端点（FR-01/FR-08/D-002/D-007/D-012）

`GET /problem-list/import-template`，声明位置在 `export_problems` 旁（L186 区段，前置于 `/{item_id}` L280）：

- 查 data_scope 内项目名（`PpmProjectMaintenance.project_name`，复用 service 现有 `manager_project_ids` 范围）、项目成员姓名（`PpmProjectMember.user_name/display_name` 去重）、**全部**模块名（`PlanNodeModule.module_name` 去重平铺，D-012 不按项目级联）、固定枚举（pro_type/is_urgent/is_delay_plan/work_type）。
- openpyxl 同步构造（`anyio.to_thread.run_sync` 包）：主表 18 列表头（同导出列序）+ 隐藏 sheet `_data` 分列存 project/member/module/各枚举 → 主表 `DataValidation(type="list", formula1="=_data!$A:$A")` 加到 项目名称/责任人/验证人/模块 列（引用隐藏 sheet 列绕 255 字符限，R-03）；pro_type/is_urgent/is_delay_plan 用固定 list（`"是,否"` 等）。`ws.sheet_state = "hidden"` 设隐藏 sheet。
- 返回 `excel_response(content, filename="问题清单导入模板.xlsx")`。

## export-excel 改写（FR-05/FR-06/D-003/D-006/D-011/R-07）

扩 `_PROBLEM_COLUMNS` 到 18 列（对齐 task-04 `list_problems_for_export` 返回键）。**拆两段**（D-011）：

```python
async def export_problems(session, user, storage, settings):
    rows = await ProblemService(session).list_problems_for_export(user=user)  # task-04: 18列含 file_urls
    # ① async 段：逐行 file_urls → get_stream 收图 bytes（get_stream 返回 AsyncIterator，不能在 sync 里 await）
    file_svc = FileService(session, storage, settings)
    for r in rows:
        r["images"] = []
        for fid in r.get("file_urls") or []:
            try:
                _meta, stream = await file_svc.get_stream(uuid.UUID(fid))
                r["images"].append(b"".join([c async for c in stream]))
            except AppError:
                continue  # 单图缺失跳过，不阻断导出（对齐 D-009 best-effort 口径）
    # ② sync 段：openpyxl 构造 + add_image
    return await anyio.to_thread.run_sync(lambda: _build_export_with_images(rows, filename))
```

- `_build_export_with_images`（同步，丢线程池）：`Workbook()` 写 18 列表头 + 数据行（复用 `ColumnDef.extract`）+ 末列「附件」对每行 `images` 逐个 `ws.add_image(Image(BytesIO(bytes)), anchor=f"{col}{row}")` 锚到该行附件列单元格（D-006 嵌图非链接）。→ `excel_response`。
- `Image`/`BytesIO` 在函数内 `from openpyxl.drawing.image import Image` + `from io import BytesIO`，避免模块顶层 Pillow 缺失炸 import（task-01 已加 Pillow>=10）。

## router 注入 storage/settings + 路由顺序

- 端点签名加 `storage: Annotated[StorageBackend, Depends(get_storage_backend)]` + `settings: Annotated[Settings, Depends(get_settings)]`（export 用 `get_stream`；import-template 可选）；`get_storage_backend`/`get_settings` 复用 file 模块同款依赖（已存在，grep 确认路径）。
- **路由顺序**：`/import-template` 与 `/export-excel` 都在 `/{item_id}`（L280）之前注册——对齐 L174-176 现有 export 前置注释 + L201-204 import 前置注释（避免 FastAPI 把字面量当 item_id 解析 UUID 返 422）。

## 不做

- 不改 service 层（task-04）/importer（task-02）/schema（task-03）；`list_problems_for_export` 的过滤/排序不动（task-04 约束）。
- 不做 module 按项目级联下拉（DV 列级静态不支持，D-012 非目标）。
- 不改 file 模块（复用 `get_stream`）；不在 service 内构造 MinIO 客户端。
- 测试写在本 task 范围外（task-06 `test_template_export.py`）；本 task 只交付两端点 + router 接线。
