---
author: WhaleFall
created_at: 2026-07-14 18:36:00
scale: large
---

# 任务清单（Tasks）— 里程碑明细·实施阶段 模块导入

> brainstorm 阶段的粗任务分组；plan 阶段将细化为 Wave + 具体步骤 + 依赖关系。
> 依赖依据见 `design.md` §5（Phase 划分）、§6（文件变更清单）、`decisions.md`。

## Wave 1：数据模型（基础，无依赖）
- **T1.1** `model.py`：`PlanNodeModule` 加 `plan_type`（`String(32)`，nullable，default `"正常计划"`）
- **T1.2** alembic 迁移 `add_plan_type_to_plan_node_module`（加 nullable 列，旧数据 NULL）
- **T1.3** `schema.py`：`PlanNodeModuleBase`/`Create`/`Update`/`Resp` 加 `plan_type`
- **T1.4** 前端 `types.ts`：`PlanNodeModule` 加 `plan_type`；`PlanNodeModuleUpdate` 同步加字段（编辑保存不丢字段）

## Wave 2：后端解析与入库（依赖 Wave 1）
- **T2.1** `pyproject.toml` 加 `python-multipart` 依赖；`pip install -e .` 验证；提醒 Docker rebuild
- **T2.2** 新建 `importer.py`：`parse_workbook(file_bytes)`（识别数据 Sheet、按表头名定位列、合并单元格向下填充、Excel 日期序列号转换、构造 `ImportPreviewRow`；两类 Sheet 列位差异按表头分别定位）
- **T2.3** `schema.py`：新增 DTO `ImportPreviewRow`/`ImportPreviewSheet`/`ImportPreviewResp`、`ImportCommitReq`/`ImportCommitSheet`、`ImportResultResp`
- **T2.4** `service.py`：`import_preview`（`anyio.to_thread` 包解析 + ORM 查 `ProjectMember` 全量反查 + 标记 `duty_matched`/`valid`）
- **T2.5** `service.py`：`import_commit`（按平台/子系统分组、同名合并、模块汇总 min/max/sum/首个、明细 `status=draft`、`session.add()` + 末尾单次 `commit()` 原子提交，**不复用 `_Crud.create`** — D-008）
- **T2.6** `router.py`：新增 `POST /plan-node/{plan_node_id}/modules/import-preview`（`UploadFile` + Query `pm_project_id`）、`POST .../modules/import-commit`（`PPM_PLAN_WRITE`，前置注册）

## Wave 3：前端交互（依赖 Wave 2 端点）
- **T3.1** `lib/ppm/export.ts`：抽取/新增 `uploadExcelWithAuth(url, file)`（FormData + token 刷新，不复用 `apiFetch`）
- **T3.2** `lib/ppm/plan.ts`：`importModulesPreview(planNodeId, projectId, file)`、`importModulesCommit(planNodeId, payload)` + TS 类型
- **T3.3** `milestone-details/page.tsx`：`moduleColumns` 加「计划类型」列（Tag：正常计划/临时计划；NULL→「—」）
- **T3.4** `milestone-details/page.tsx`：`ModuleLevelTable` 顶部加「导入模块」按钮
- **T3.5** 新增 `ImportModuleModal` 组件（上传态 / 预览态 Sheet 勾选 + 表格标错 / 结果态报告）

## Wave 4：测试（与 Wave 3 并行）
- **T4.1** `test_importer.py`：正常/临时 Sheet 解析、合并单元格向下填充、日期序列号转换、多人责任人、空行、表头列位变体、非数字工作量防御
- **T4.2** `test_router.py`：`import-preview`（解析 + 责任人反查匹配/未匹配）、`import-commit`（新建 / 同名合并 / 模块汇总 / 原子回滚 / 未匹配行跳过）
- **T4.3** 前端：上传 → 预览 → 确认 → 结果 流程测试

## 验收
- 对照 `design.md` §2 设计目标 + `requirements.md` FR-001 ~ FR-010 逐项验收
- 用两份参考 xlsx（`项目详细开发计划V1.0(康尼).xlsx` / `项目详细开发计划-EHS.xlsx`）做导入演练；importer 单测用自造 fixtures（不依赖桌面路径）
