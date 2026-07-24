---
id: task-06
title: Backend tests for attachment/template/export-image
title_zh: 后端测试 图片导入/动态模板/导出嵌图
author: qinyi
created_at: 2026-07-24 14:21:15
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09, FR-11]
decision_ids: [D-001@v1, D-005@v1, D-009@v1, D-012@v1]
allowed_paths:
  - backend/app/modules/ppm/problem/tests/test_importer.py
  - backend/app/modules/ppm/problem/tests/test_import_flow.py
  - backend/app/modules/ppm/problem/tests/test_template_export.py
provides: []
expects_from: {}
goal: >
  覆盖附件图片导入（提取/锚点/≤3/上传存file_id/单图失败不中断）+ 动态模板（下拉/隐藏sheet）+ 导出嵌图（18列/add_image/往返）。
implementation:
  - test_importer.py 增：嵌图 xlsx 解析 images + anchor 关联行（注意 openpyxl anchor._from.row 0-based，row_index 1-based，+1）+ 跨行图归起始行 + 多图同行 + 无图空列表
  - test_import_flow.py 增：附件≤3张导入成功 file_urls 含 file_id + 4张超额标红 + 单图失败（mock upload_file 抛）failed_rows 不中断整批 + 动态模板端点返回 xlsx 含 DataValidation
  - test_template_export.py（新建）：导出 18 列表头对齐 + 附件列嵌图（add_image 调用）+ 导出→改→导回 file_id 链不断
acceptance:
  - test_importer 覆盖图片各分支
  - test_import_flow 覆盖附件上传/超额/单图失败/模板
  - test_template_export 覆盖导出嵌图/往返
  - 全绿
verify:
  - cd backend && uv run pytest app/modules/ppm/problem/tests/test_importer.py app/modules/ppm/problem/tests/test_import_flow.py app/modules/ppm/problem/tests/test_template_export.py -q
constraints:
  - 不改现有 problem 测试
  - openpyxl anchor 0-based（+1 对齐 row_index）
---

# TaskCard — task-06：后端测试（图片导入 / 动态模板 / 导出嵌图）

## 现状基线
- `test_importer.py`（L1-540）：`_build_xlsx(headers, rows)` 程序构造 + `parse_problem_workbook` 纯解析，已覆盖 8 类用例（正常/乱序/合并/日期/枚举/空行/无表头/官方模板别名）。
- `test_import_flow.py`（L1-615）：httpx `client` + `auth_headers` + `db_session`/`db_engine` + `_seed_project/member/module` + `_preview_row_dict` + `_fresh_session_factory`，9 用例覆盖 preview 严格校验 + commit 原子/防篡改/data_scope/鉴权。
- `conftest.py`（L1-15）：仅注册 problem + project 模型到 metadata；根 conftest 提供 `client/auth_headers/db_session/db_engine`。
- plan/test_importer.py：openpyxl `Workbook` + `_set(ws, coord, val)` + `BytesIO` 不落盘范式参考。

## 实现要点

### test_importer.py（扩展，FR-02 / D-001）
- 加 `_build_xlsx_with_images(headers, rows, images=[(coord, png_bytes)])`：`ws.add_image(Image(BytesIO(png)), coord)` 嵌图。
- 用例：① 单图 `"C2"` → `images[0].anchor_row==2`、`data==原 bytes`、`mime_type=="image/png"`（openpyxl `anchor._from.row` 0-based，`+1` 对齐 1-based `row_index`，R-01/task-02 constraints）；② 跨行图归起始行（`row_index==2`）；③ 多图同行 → `len(images)==N`、顺序稳定；④ 无图 → `images == []`（零回归兼容原导入，D-001 非阻断）。

### test_import_flow.py（扩展，FR-03/04 / D-005/009）
- `_preview_row_dict` 补默认 `attachment_count=0`/`attachment_exceeded=False`/`images=None`（向后兼容现有 9 用例）。
- 用例：① ≤3 张附件 commit 成功 → `created==1`、落库 `PpmProblemList.file_urls` 长度 3 且元素为 UUID 串（D-004 值=file_id）；② 4 张 → preview `attachment_exceeded==True` + `valid==False` + error 含「附件超过3张」（D-005）；③ 单图失败：`monkeypatch.setattr(FileService, "upload_file", _boom)` → `failed_rows` 含该行 + `created==1`（problem 已入库不回滚）+ 落库 `file_urls==[]`（D-009 best-effort）；④ `GET /problem-list/import-template` → 200 xlsx + `load_workbook` 主表 18 列表头 + 存在 `DataValidation`（type=list）+ 隐藏 sheet「_data」存在（D-002/D-012）。

### test_template_export.py（新建，FR-05/06 / D-003/006）
- 造带 `file_urls`（mock file_id → 图 bytes）的 problem → `GET /export-excel` → 200 xlsx → `load_workbook` 解析：① 18 列表头对齐导入模板（17 业务列 + 「附件」）；② `ws._images` 非空且 anchor 落该行附件列（D-006 嵌图非链接）；③ 往返：导出 xlsx → 喂回 `parse_problem_workbook` → images 非空 + 17 字段一致（file_id 链不断，R-07 拆两段不丢）。
- 图 bytes 用最小 1×1 PNG fixture（不依赖外部资源）；`get_stream` 用 monkeypatch 或 in-memory StorageBackend（execute 核根 conftest 实际接线，对齐 fake storage 范式）。

## 不做（边界）
- 不改现有 9 个 flow + 8 类 importer 用例（constraints）：仅新增用例 + 扩 `_preview_row_dict` 默认值（默认 None/0/False 向后兼容）。
- 不测 file 模块/MinIO 真实链路（upload_file 内部已覆盖）；单图失败用 monkeypatch 够。
- 不跨任务验模板字段顺序/表头文字（以 task-05 实现为准），本卡只断言「18 列存在 + DV 存在 + 嵌图存在」结构事实。

## 依据
design §5 Wave1.5（测试三条）+ §10 R-01/R-05/R-07 + §12 自审；plan task-06（全 FR 验收）+ 覆盖矩阵 FR-02/03/04/05/06/08/11；decisions D-001@v1（图片提取）、D-005@v1（≤3 标红）、D-009@v1（单图失败不中断）、D-012@v1（导出 18 列对齐）；test_importer.py L60-83 `_build_xlsx` + L196-226 合并范式 + test_import_flow.py L87-140 seed helpers / L199-244 `_preview_row_dict` / L444-488 monkeypatch 注入异常范式。
