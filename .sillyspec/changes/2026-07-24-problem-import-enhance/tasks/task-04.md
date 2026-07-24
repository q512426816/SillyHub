---
id: task-04
title: service import_preview attachment check + import_commit upload + rewrite list_problems_for_export
title_zh: service 附件校验 + 逐图上传 + 改写 list_problems_for_export 返回全字段
author: qinyi
created_at: 2026-07-24 14:20:45
priority: P0
depends_on: [task-02, task-03]
blocks: [task-05, task-06]
requirement_ids: [FR-03, FR-04, FR-07]
decision_ids: [D-004@v1, D-009@v1, D-010@v1]
allowed_paths:
  - backend/app/modules/ppm/problem/service.py
provides:
  - contract: list_problems_for_export
    fields: [project_name, module_name, model_name, pro_desc, pro_type, is_urgent, func_name, duty_user_name, find_by, find_time, plan_start_time, plan_end_time, audit_user_name, work_load, work_type, pro_answer, is_delay_plan, remarks, file_urls]
expects_from:
  task-02:
    - contract: ParsedProblemRow
      needs: [images]
  task-03:
    - contract: ProblemImportPreviewRow
      needs: [attachment_count, attachment_exceeded]
goal: >
  import_preview 填附件数+≤3校验；import_commit 入库后逐图 upload_file 存 file_id 入 file_urls（单图 try/except 失败 failed_rows 不中断）；改写 list_problems_for_export 返回 18 列全字段含 file_urls。
implementation:
  - import_preview：解析后填 row.attachment_count=len(images)、attachment_exceeded=(>3)；>3 → valid=false（error「附件超过3张」）
  - import_commit：入库 commit（复用前置 D-008 原子）→ 拿 problem_id → **逐图** FileService(session).upload_file(data=img.data, original_name=f"problem_{pid}_{idx}.{ext}", mime_type=img.mime_type, uploaded_by=user, owner_type="problem_import", owner_id=pid)，**每图 try/except AppError**（失败 failed_rows.append + 跳过，不中断/不回滚已入库）→ 成功 file_id 追加 file_urls → commit
  - 改写 list_problems_for_export（service.py:934）：返回 list[dict] 含 18 列字段（含 file_urls list[str]），不改过滤/排序
acceptance:
  - import_preview 填 attachment_count + >3 标红
  - import_commit 图片上传存 file_id；单图失败 failed_rows 不中断整批
  - list_problems_for_export 返回含 file_urls 全字段
verify:
  - cd backend && uv run pytest app/modules/ppm/problem/tests/test_import_flow.py -q
  - cd backend && uv run ruff check app/modules/ppm/problem/service.py && uv run mypy app/modules/ppm/problem/service.py
constraints:
  - upload_file 内部自 commit（file:92），逐图独立事务；附件失败 best-effort 不回滚 problem 入库（D-009）
  - file_urls 值=file_id（D-004/D-006）
  - 不改现有 create_problem/_backfill；复用前置 import_commit 原子入库
---

# task-04 — service 附件校验 + 逐图上传 + 改写 list_problems_for_export

> 依据：design.md §5 Wave1.3（service.py 三处改）、§10 R-05（逐图 try/except 不中断）、decisions D-004@v1（file_urls 值=file_id）、D-009@v1（附件 best-effort 不回滚 problem）、D-010@v1（改写 list_problems_for_export 返回全字段含 file_urls，供 task-05 导出源）；
> file 范式：`backend/app/modules/file/service.py:63-96`（`upload_file` 签名 + L93 内部自 commit + L94 返回 `FileUploadResp.id`；`validate_upload` L47-61 超限/类型不符抛 AppError 413/415）；
> 现有 service.py：`import_preview` L973-1051（逐行填 PreviewRow L1016-1043）、`import_commit` L1053-1155（原子 add_all+commit L1140-1143，返回 L1151）、`list_problems_for_export` L923-944（现仅 6 字段）。

## import_preview 改动（填附件数 + ≤3 校验，FR-03/D-005）

task-02 在 `ParsedProblemRow` 加 `images: list[ImageExtracted]`，task-03 给 `ProblemImportPreviewRow` 加 `attachment_count/attachment_exceeded`。在 L1016-1043 构造 PreviewRow 处补：`attachment_count=len(r.images)`、`attachment_exceeded=len(r.images)>3`；`>3` 接入现有 `errors` 链 → `valid=False` + error 追加「附件超过3张」（与 project/pro_desc 校验同口径，preview 阶段 `；` 拼接展示）。

## import_commit 改动（逐图上传存 file_id，FR-04/D-004/D-009）

复用前置 D-008 原子入库（L1140-1143 `add_all+commit`）→ 拿 `obj.id` → **逐图**调 FileService（`images` 随 `req.rows` 透传，task-02 contract）：

```python
file_svc = FileService(self._session, storage, settings)  # storage/settings 注入见下
for obj, row in zip(objs, req.rows):
    for idx, img in enumerate(row.images or []):
        try:
            resp = await file_svc.upload_file(
                data=img.data, mime_type=img.mime_type, uploaded_by=user.id,
                original_name=f"problem_{obj.id}_{idx}.{img.mime_type.split('/')[-1]}",
                owner_type="problem_import", owner_id=obj.id,
            )
            obj.file_urls.append(str(resp.id))  # D-004 值=file_id
        except AppError as e:  # D-009 best-effort
            failed_rows.append(f"第{row.row_index}行: 附件{idx+1}上传失败:{e.code}")
            continue  # 不中断整批、不回滚已入库 problem
await self._session.commit()  # file_urls 回写 problem
```

- `upload_file` 内部自 commit（file:93）→ 每图独立事务，**附件失败不回滚 problem 入库**（D-009/R-05）。
- **storage/settings 注入（新依赖）**：`problem/router.py` 当前未引 storage/FileService（已 grep 确认）；`import_commit` 签名加 `storage: StorageBackend, settings: Settings` 形参，由 router 从 `Depends(get_storage_backend)`/`get_settings` 透传——执行时与 task-05 router 端点一并接线（备选：router 装配 FileService 传入，避免 service 耦合 storage，二选一在 execute 与 task-05 对齐）。

## list_problems_for_export 改写（L923-944，FR-07/D-010）

返回 `list[dict]` 全字段（含 file_urls），**不改 user/scope 过滤与排序**：

```python
return [{
    "project_name": r.project_name, "module_name": r.model_name, "model_name": r.model_name,
    "pro_desc": r.pro_desc, "pro_type": r.pro_type, "is_urgent": r.is_urgent,
    "func_name": r.func_name, "duty_user_name": r.duty_user_name, "find_by": r.find_by,
    "find_time": r.find_time.isoformat() if r.find_time else None,
    "plan_start_time": r.plan_start_time.isoformat() if r.plan_start_time else None,
    "plan_end_time": r.plan_end_time.isoformat() if r.plan_end_time else None,
    "audit_user_name": r.audit_user_name, "work_load": r.work_load, "work_type": r.work_type,
    "pro_answer": r.pro_answer, "is_delay_plan": r.is_delay_plan, "remarks": r.remarks,
    "file_urls": list(r.file_urls or []),
} for r in rows]
```

> 注：`module_name`/`model_name` 同源 `r.model_name`（D-012 模块名列导入映射到 model_name，导出双 key 兼容前端/模板表头）。供 task-05 export-excel 端点 18 列对齐 + 嵌图往返（D-003/D-006）。

## 不做

- 不改 `create_problem`/`_backfill_names`/CRUD/3 态执行流（constraints）；不改 importer.py（task-02）/schema.py（task-03）。
- service 内不构造 MinIO 客户端——复用 file 模块 `upload_file`（写）/`get_stream`（task-05 导出读）。
- `list_problems_for_export` 的 user/scope 过滤、排序不动（仅扩字段）。
