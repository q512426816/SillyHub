---
author: qinyi
created_at: 2026-07-24 12:50:00
change: 2026-07-24-problem-import-enhance
---

# 决策台账 · 问题清单导入增强（附件图片 + 动态下拉 + 导出对齐）

本变更的决策台账。基于已上线变更 2026-07-24-problem-list-excel-import（commit c1d26a00）增强。

> 本变更推翻前置变更的 D-007（不导入附件）与「非目标·不做动态模板」两条，下面 D-001/D-002 显式声明 supersede。

## D-001@v1: 附件 = Excel 嵌图片导入（supersede 前置 D-007）
- type: requirement
- status: accepted
- source: user
- priority: P0
- question: 附件列导入怎么处理？前置变更 D-007 决定不导入附件。
- answer: **改为支持 Excel 嵌图片导入**：openpyxl 提取 `ws._images`，按 `anchor._from.row` 关联到所在数据行；每问题 ≤3 张（用户明确）；service 对每图调 `file_service.upload_file` 上传 MinIO → file_id，存入 `file_urls`。用户原话「最起码要支持图片，每个问题上限3张」。Word/PDF 等 OLE 对象 openpyxl 读不了，不支持（用户接受）。
- normalized_requirement: importer 提取 ws._images + 锚点关联行；≤3/行（D-005）；import_commit 入库后批量 upload_file 存 file_id 入 file_urls（D-004）；OLE 对象不支持。
- impacts: [design-§5, task-importer, task-service-commit]
- evidence: 用户回答；`backend/app/modules/file/service.py:63` upload_file 返回 FileUploadResp.id；openpyxl ws._images + anchor 文档

## D-002@v1: 动态下拉模板（supersede 前置「非目标·不做动态模板」）
- type: architecture
- status: accepted
- source: user
- priority: P0
- question: 模板下拉范围？前置变更非目标「不做动态模板」。
- answer: **改为动态下拉模板**，后端新增端点 `GET /api/ppm/problem-list/import-template` 实时生成 xlsx：固定枚举（问题类型 bug/change/其他、是否加急 是/否、是否延期 是/否）+ 系统数据动态下拉（项目名/模块名/责任人/验证人，从系统拉 → 隐藏 sheet 存 → 主 sheet 数据有效性引用，只能选已有）。前端「下载模板」改调此端点。
- normalized_requirement: 新增 GET /problem-list/import-template 端点；查 PpmProjectMaintenance/PpmProjectMember/PlanNodeModule + 固定枚举；生成 xlsx（主表 18 列表头 + 隐藏 sheet 系统数据 + 主表 DataValidation type=list 引用隐藏 sheet）；前端 downloadImportTemplate 改调此端点。
- impacts: [design-§5, design-§7, task-router-template, task-frontend-modal]
- evidence: 用户回答（固定枚举+系统数据下拉）；openpyxl DataValidation 文档

## D-003@v1: 导出对齐导入格式（18 列 + 嵌图片）
- type: requirement
- status: accepted
- source: user
- priority: P0
- question: 导出 Excel 是否对齐导入格式？
- answer: **对齐**：导出列 = 导入模板 18 列（17 业务 + 附件），表头/顺序一致；附件列嵌图片（每行 file_urls 的 file_id → get_stream 取图 → openpyxl add_image 锚到附件列单元格）。保证「导出→改→导回」往返图片不丢。
- normalized_requirement: 改 export-excel 列定义 = 18 列；附件列嵌图片（add_image，锚点对齐行）；表头/顺序与导入模板一致。
- impacts: [design-§5, task-router-export, verify-往返]
- evidence: 用户回答（导出对齐导入格式）

## D-004@v1: file_urls 复用 file_id 语义
- type: architecture
- status: accepted
- source: code
- priority: P0
- question: 附件上传后存什么进 file_urls？
- answer: 复用平台文件中心 D-006 既定语义——`file_urls: list[str]` 值为 **file_id（uuid 字符串）**（file-upload.tsx:12 注释）。图片 upload_file 返回 id → 存 file_urls。访问/展示经 file 模块 get_stream/by-id。
- normalized_requirement: import_commit 图片上传后 file_urls 存 file_id 列表；不存 URL。
- impacts: [task-service-commit]
- evidence: `frontend/src/components/file-upload.tsx:12`（file_urls 值语义为文件 id D-006）；`backend/app/modules/file/service.py:94` upload_file 返回 id

## D-005@v1: 附件 ≤3/行，超额整行标红
- type: requirement
- status: accepted
- source: user
- priority: P0
- question: 附件超额（>3 张/行）怎么处理？
- answer: 整行 `valid=false` 标红（error「附件超过3张」），对齐前置变更严格校验范式（不截断、不静默）。
- normalized_requirement: importer 按锚点行统计图片数；>3 → PreviewRow 标 `valid=false`/error；import_commit 跳过。
- impacts: [task-importer, task-service-preview, verify-超额]
- evidence: 用户回答（每问题上限3张）

## D-006@v1: 导出嵌图片（非链接），保往返
- type: architecture
- status: accepted
- source: code
- priority: P1
- question: 导出附件列嵌图片还是输出链接？
- answer: **嵌图片**（openpyxl add_image）。链接导出会导致导回时图片变链接（file_id 丢失），破坏 D-003 往返。嵌图片保证 导出→改→导回 图片 file_id 链不断。
- normalized_requirement: export 附件列 add_image（每行 file_urls → get_stream → Image → anchor 到该行附件列单元格）。
- impacts: [task-router-export, verify-往返图片不丢]
- evidence: D-003 往返要求；openpyxl add_image

## D-007@v1: 模板下载改动态端点
- type: architecture
- status: accepted
- source: code
- priority: P1
- question: 前端「下载模板」怎么改？
- answer: 从静态文件 `/templates/problem-import-template.xlsx` 改为调动态端点 `GET /api/ppm/problem-list/import-template`（D-002）。静态 xlsx 可保留作离线兜底或删除（倾向删除，统一动态）。
- normalized_requirement: 前端 downloadImportTemplate 调 GET /import-template（apiFetch 触发下载）；静态 xlsx 删除。
- impacts: [task-frontend-modal]
- evidence: D-002 动态模板

## D-008@v1: Pillow 依赖（grill B-001 P0 修正）
- type: architecture
- status: accepted
- source: code
- priority: P0
- question: openpyxl 图像读写（ws._images 提取 + add_image 嵌入）的依赖？
- answer: openpyxl 图像功能强依赖 Pillow（PIL），无 PIL 时 `_import_image` ImportError，导入取字节与导出嵌图两端全断。pyproject.toml 现仅 `openpyxl>=3.1` 无 Pillow。补 `Pillow>=10`。
- normalized_requirement: backend/pyproject.toml 加 Pillow>=10；execute 前两端 spike（读 ws._images + add_image）确认 PIL 可用。
- impacts: [design-§5.0, design-§6, design-§10-R-06, task-deps]
- evidence: grill B-001 spike 实测；openpyxl 文档（图像需 Pillow）

## D-009@v1: 逐图 try/except + failed_rows 不中断（grill B-002 修正 R-05）
- type: architecture
- status: accepted
- source: code
- priority: P1
- question: upload_file 内部自 commit（file/service.py:92-93）+ validate_upload 失败抛 AppError（格式 jpeg/png/gif/webp 白名单 config.py:222），循环里 N×M 次单图失败如何处理？
- answer: import_commit 入库后**逐图 try/except**：单图 upload_file 失败（格式/大小/MinIO）→ 计入 failed_rows + 跳过该图 + 不中断整批 + 不回滚已入库问题（附件非核心字段，非阻断）。R-05 原描述模糊，此决策收口。
- normalized_requirement: import_commit 图片上传循环每图 try/except AppError；失败 failed_rows.append(f"行X附件Y: {err}")、跳过；成功 file_id 追加 file_urls。
- impacts: [design-§5.3, design-§10-R-05, task-service-commit, verify-单图失败不中断]
- evidence: grill B-002；`backend/app/modules/file/service.py:92-93`（upload_file commit）；config.py:222 白名单

## D-010@v1: 改写 list_problems_for_export 返回全字段（grill B-003）
- type: architecture
- status: accepted
- source: code
- priority: P1
- question: 现有 list_problems_for_export（service.py:934-944）仅回 6 字段，无 file_urls 及其余 12 字段，18 列导出无数据源？
- answer: 改写 list_problems_for_export 返回 18 列全字段（含 file_urls、module_name/model_name、duty/audit、计划时间、work_load 等），作为导出 + 嵌图的数据源。design §6 原漏此方法，补上。
- normalized_requirement: list_problems_for_export 返回 list[dict] 含 18 列字段（含 file_urls list[str]）；不改其过滤/排序语义。
- impacts: [design-§5.3, design-§6, task-service-export, task-router-export]
- evidence: grill B-003；`backend/app/modules/ppm/problem/service.py:934-944`

## D-011@v1: 导出拆两段 async/sync（grill B-004）
- type: architecture
- status: accepted
- source: code
- priority: P1
- question: 导出嵌图跨 async/sync 边界——get_stream 返回 AsyncIterator（file/service.py:109），不能在 anyio.to_thread 同步 workbook 构造里 await？
- answer: 导出拆两段：① async 段（router）调 list_problems_for_export 取 18 列 + 对每行 file_urls 调 get_stream 收集图 bytes 到内存结构；② anyio.to_thread.run_sync 包同步段 openpyxl 构造 workbook（18 列 + add_image）。两段分离，不在 sync 里 await。
- normalized_requirement: export-excel router：async 取数据+图字节 → anyio.to_thread.run_sync(sync 构造 workbook 嵌图) → excel_response。
- impacts: [design-§5.4, design-§10-R-07, task-router-export]
- evidence: grill B-004；`backend/app/modules/file/service.py:109` get_stream AsyncIterator

## D-012@v1: module 下拉全部平铺（grill B-005）
- type: architecture
- status: accepted
- source: code
- priority: P1
- question: 动态模板 module 下拉「只能选已有」——但 openpyxl DataValidation 是列级静态范围，无法按每行 project 级联（不同行项目对应不同模块集），module 下拉不可达？
- answer: module 下拉改为**全部模块平铺**（隐藏 sheet 存所有 PlanNodeModule.module_name 去重），不按项目级联（DV 限制）。项目/成员下拉按 data_scope 收敛（用户可访问的项目/成员）减量。module 精确反查仍由 service 严格校验（D-004，填了须匹配该项目下模块，未匹配标红）——下拉仅辅助，校验兜底。
- normalized_requirement: /import-template 模块列 DV 引用隐藏 sheet 全部模块平铺（去重）；project/member 列 DV 引用 data_scope 内项目/成员；module 反查靠 service 严格校验。
- impacts: [design-§3, design-§5.4, task-router-template]
- evidence: grill B-005；openpyxl DataValidation 列级静态文档

## D-013@v1: import-commit 改 multipart（file + rows）传图片（task-04 执行发现的 gap 修正）
- type: architecture
- status: accepted
- source: code
- priority: P0
- question: preview→commit 是 JSON HTTP 往返，图片二进制在 round-trip 中丢失（task-04 service 用 row.images 但 PreviewRow JSON 不带 images bytes），怎么把图片传到 commit？
- answer: commit 端改 **multipart（file + rows）**：前端确认时重传原 Excel file + 勾选 rows（row_index）；router 解析 file（parse_problem_workbook）取 parsed_rows.images，按 row_index 填到 commit rows 后调 service.import_commit；router 装配 FileService（从 storage/settings，参考 file/router._make_service）传入。schema PreviewRow 不加 images 字段（JSON 不传 bytes），router 在内存把 parsed.images 挂到 row 后调 service（service import_commit 已用 getattr(row,"images",()) 兜底，task-04）。
- normalized_requirement: router /import-commit multipart（UploadFile + rows JSON）；router 解析 file 取 images 按 row_index 填 commit rows；router 装配 FileService 传 service.import_commit(..., file_service=fsvc)；前端 importProblemsCommit 改 FormData（file + rows）。
- impacts: [design-§7, task-05(router), task-07(frontend client), task-08(modal), verify-commit带图]
- evidence: task-04 执行子代理发现（preview→commit JSON 无 images bytes）；file/router.py _make_service 装配范式
