---
author: qinyi
created_at: 2026-07-24 12:50:00
scale: large
---

# 设计文档（Design）— 问题清单导入增强（附件图片 + 动态下拉 + 导出对齐）

> 已据 Design Grill（review.json specVerdict=pass / qualityVerdict=fail，P0 Pillow 依赖 + 4 P1）修正：补 Pillow 依赖、逐图 try/except、补 list_problems_for_export 改写、导出拆两段、module 下拉平铺。新增 D-008~D-012。

## 1. 背景

已上线变更 2026-07-24-problem-list-excel-import（commit c1d26a00）实现问题清单 Excel 批量导入，但有三点不足：① 不支持附件（原 D-007）；② 模板静态，下拉需手填易错；③ 导出格式与导入不一致，无法往返。本次增强补齐：附件图片导入（≤3/行）、动态下拉模板、导出对齐导入格式。

详细决策见 `decisions.md` D-001 ~ D-012（D-001/D-002 supersede 前置 D-007 与非目标）。

## 2. 设计目标

- 导入支持 Excel 嵌图片，每问题 ≤3 张，上传 MinIO 存 file_id。
- 模板下拉：固定枚举 + 系统数据（项目/成员按 data_scope 收敛，模块全部平铺）动态生成。
- 导出 18 列对齐导入模板，附件嵌图片，支持往返。

## 3. 非目标

- **不做** Word/PDF 等 OLE 嵌入对象导入（openpyxl 读不了，仅图片）。
- **不做** module 下拉按项目级联（openpyxl DataValidation 是列级静态范围，不支持逐行动态级联——D-012）。
- **不改** file 模块代码（复用 upload_file/get_stream）；**但需新增 Pillow 依赖**（openpyxl 图像读写必需，D-008）。
- **不改** 现有 CRUD/3 态执行流/权限/data_scope。

## 4. 拆分判断

单一增强，跨 backend + frontend，无独立子模块 → 不拆分，两 Wave。非批量。

## 5. 总体方案

### Wave 1 — 后端

0. **依赖**：`backend/pyproject.toml` 加 `Pillow>=10`（openpyxl `ws._images` 读取与 `add_image` 写入都强依赖 PIL，spike 实测无 PIL 时 `_import_image` ImportError，D-008）。
1. **`importer.py` 扩展**：`parse_problem_workbook` 提取 `ws._images`，按 `image.anchor._from.row` 关联数据行（跨行图片归起始行）；`ParsedProblemRow` 加 `images: list[ImageExtracted]`（{data: bytes, mime_type, anchor_row}）。
2. **`schema.py`**：`ProblemImportPreviewRow` 加 `attachment_count: int` + `attachment_exceeded: bool`。
3. **`service.py`**：
   - `import_preview`：填 attachment_count，>3 → valid=false（error「附件超过3张」）。
   - `import_commit`：原子入库（add_all + commit，复用前置 D-008）→ 拿 problem_id → **逐图** `FileService.upload_file(data, original_name, mime_type, uploaded_by=user, owner_type="problem_import", owner_id=problem_id)`，**每图 try/except**（upload_file 内部自 commit + validate_upload 可能因格式/大小抛 AppError；失败计入 failed_rows、该图跳过、不中断整批、不回滚已入库问题，D-009 修正 R-05）→ 成功的 file_id 追加该问题 file_urls → 再 commit。
   - **改写 `list_problems_for_export`**：现仅回 6 字段（service.py:934-944），改为返回 18 列全字段（含 file_urls），供导出源（D-010）。
4. **`router.py`**：
   - 新增 `GET /problem-list/import-template`：查 data_scope 内项目（PpmProjectMaintenance.project_name）+ 项目成员（PpmProjectMember 姓名）+ 全部模块（PlanNodeModule.module_name 去重平铺，D-012）+ 固定枚举 → 生成 xlsx（主表 18 列表头 + 隐藏 sheet「_data」分列存 project/member/module/枚举 + 主表 DataValidation type=list 引用隐藏 sheet：项目名称/责任人/验证人 引用对应列、模块名称引用全部模块平铺、问题类型/加急/延期 用固定 list）。
   - 改 `export-excel`：**拆两段**（D-011，跨 async/sync 边界）—— ① async 段：调改写后的 list_problems_for_export 取 18 列数据 + 对每行 file_urls 的 file_id 调 `get_stream` 收集图 bytes 到内存（list[dict]，每行附 images）；② anyio.to_thread.run_sync 包同步段：openpyxl 构造 workbook（18 列表头 + 数据行 + 附件列对每行 images `add_image(Image(BytesIO(bytes)), anchor)` 锚到该行附件列单元格）→ excel_response。
5. **测试**：test_importer 增图片提取/锚点/≤3；test_import_flow 增附件上传+file_id 落库+超额+单图失败不中断；test 增动态模板（下拉存在+隐藏sheet）+ 导出嵌图片（add_image）+ 导出 18 列含 file_urls。

### Wave 2 — 前端

1. **`lib/ppm/problem.ts`**：`downloadImportTemplate()` 改调 `GET /problem-list/import-template`（blob 下载）；类型加 attachment_count/exceeded。
2. **`import-problem-modal.tsx`**：预览加「附件」列（attachment_count + 超额标红）；下载模板走新 client。
3. 删除静态 `frontend/public/templates/problem-import-template.xlsx`（统一动态）。
4. 测试适配。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/pyproject.toml` | 加 Pillow>=10（D-008） |
| 修改 | `backend/uv.lock` | Pillow 依赖 lock 更新（D-008 副产物） |
| 修改 | `backend/app/modules/ppm/problem/importer.py` | 提取 ws._images + 锚点关联行 |
| 修改 | `backend/app/modules/ppm/problem/schema.py` | PreviewRow 加 attachment_count/exceeded |
| 修改 | `backend/app/modules/ppm/problem/service.py` | import_preview 附件校验 + import_commit 逐图上传 + **改写 list_problems_for_export 返回全字段含 file_urls**（D-010） |
| 修改 | `backend/app/modules/ppm/problem/router.py` | 新增 /import-template + 改 export-excel 拆两段嵌图（D-011） |
| 修改 | `backend/app/modules/ppm/problem/tests/test_importer.py` | 图片提取/锚点/≤3 |
| 修改 | `backend/app/modules/ppm/problem/tests/test_import_flow.py` | 附件上传+file_id+超额+单图失败不中断 |
| 新增 | `backend/app/modules/ppm/problem/tests/test_template_export.py` | 动态模板下拉 + 导出嵌图片 + 18 列 |
| 修改 | `frontend/src/lib/ppm/problem.ts` | downloadImportTemplate 改动态端点 |
| 修改 | `frontend/src/lib/ppm/types.ts` | PreviewRow 加 attachment_count/exceeded |
| 修改 | `frontend/src/components/ppm/problem/import-problem-modal.tsx` | 预览附件列 + 下载模板改 |
| 修改 | `frontend/src/components/ppm/problem/import-problem-modal.test.tsx` | 适配 |
| 删除 | `frontend/public/templates/problem-import-template.xlsx` | 统一动态 |

## 7. 接口定义

```
GET /api/ppm/problem-list/import-template
  → 200 xlsx（18列表头 + 隐藏sheet + DataValidation下拉：项目/责任人/验证人按data_scope、模块全部平铺、枚举固定）
POST /problem-list/import-preview （PreviewRow 加 attachment_count/exceeded）
POST /problem-list/import-commit （**multipart: file + rows** D-013；router 解析 file 取 images 按 row_index 填 commit rows + 装配 FileService 传 service，入库后逐图上传存 file_urls file_id，单图失败 failed_rows 不中断）
GET /problem-list/export-excel （18列对齐 + 附件嵌图片，async取图→sync构造）
```

```python
@dataclass
class ImageExtracted:
    data: bytes; mime_type: str; anchor_row: int
# ParsedProblemRow += images: list[ImageExtracted]
# ProblemImportPreviewRow += attachment_count: int; attachment_exceeded: bool
```

## 8. 数据模型

**无表结构变更**。复用 `ppm_problem_list.file_urls`（list[str]，值=file_id）、`File` 表、MinIO。**新增依赖 Pillow**（pyproject，D-008）。

## 9. 兼容策略

- 改现有导入/导出端点 + 模板生成，不改 API 路径/表/权限。
- 原导入（无附件）仍工作（images 空）。
- 导出格式变（17→18 列 + 嵌图），是用户要求的对齐，非回归。
- 静态模板删除，前端统一动态端点。
- 新增 Pillow 依赖：重建 backend 镜像即生效（uv sync）。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | openpyxl 图片锚点（跨行/浮动/合并区） | P1 | anchor._from.row 取起始行；execute 验证 |
| R-02 | 导出嵌图片慢/文件大 | P2 | anyio.to_thread 包；超量降级（execute 评估） |
| R-03 | 动态模板数据量大（DV 限制） | P2 | 隐藏 sheet 引用绕 255 字符限；project/member 按 data_scope 收敛减量 |
| R-04 | 图片格式/大小校验 | P2 | upload_file validate_upload 内置（jpeg/png/gif/webp 白名单，config.py:222）；不支持格式 → 单图失败 failed_rows（D-009） |
| R-05 | import_commit 图片上传失败 | P1 | **逐图 try/except**：失败 failed_rows + 跳过，不中断整批、不回滚已入库问题（附件非阻断，D-009） |
| R-06 | Pillow 依赖缺失 | P0 | pyproject 加 Pillow>=10；execute 前 spike 两端（读 ws._images + add_image）确认 PIL 可用（D-008） |
| R-07 | 导出嵌图跨 async/sync | P1 | 拆两段（async 取图字节 → sync 构造），D-011 |

## 11. 决策追踪

- **D-001@v1** 附件=图片导入（supersede 前置 D-007）→ §5.1/3
- **D-002@v1** 动态下拉模板（supersede 前置非目标）→ §5.4
- **D-003@v1** 导出对齐 18 列嵌图 → §5.4
- **D-004@v1** file_urls=file_id → §5.3
- **D-005@v1** 附件 ≤3 超额标红 → §5.2/3
- **D-006@v1** 导出嵌图非链接 → §5.4
- **D-007@v1** 模板下载改动态端点 → §5 Wave2
- **D-008@v1** Pillow 依赖（grill B-001）→ §5.0、§6、§10 R-06
- **D-009@v1** 逐图 try/except + failed_rows 不中断（grill B-002，修正 R-05）→ §5.3、§10 R-05
- **D-010@v1** 改写 list_problems_for_export 返回全字段含 file_urls（grill B-003）→ §5.3、§6
- **D-011@v1** 导出拆两段 async/sync（grill B-004）→ §5.4、§10 R-07
- **D-012@v1** module 下拉全部平铺（DV 不支持按行级联，grill B-005）→ §3、§5.4

无未解决决策；grill P0 + 全部 P1 已修正。

## 12. 自审

- ✅ 必填章节齐全；无 session/lease/daemon/lifecycle → 无生命周期契约表。
- ✅ 引用 D-001~D-012；D-001/D-002 supersede 前置。
- ✅ 复用 file 模块（upload_file/get_stream）+ 前置导入范式；补 Pillow 依赖。
- ✅ 无 schema/migration 变更。
- ✅ Design Grill P0（Pillow）+ 4 P1（upload commit/冒泡、list_problems_for_export、async/sync、module 级联）全部修正（D-008~D-012）。
- 进入 plan。
