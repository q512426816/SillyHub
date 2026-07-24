---
author: qinyi
created_at: 2026-07-24 12:05:00
---

# 验证报告 — 问题清单 Excel 批量导入

## 结论

**PASS**

11/11 task 完成，实现与 design.md / decisions D-001~D-014 一致（独立 QA acceptance review pass/pass 无 P0），全量测试零回归，P1/P2/mypy 缺陷已修复。本变更非 integration/deployment-critical（纯 CRUD 导入，无 daemon/session/lease），PASS 不降级。

## 任务完成度

11/11 task 全部完成（100%）：

| task | 产出 | 状态 |
|---|---|---|
| task-01 | ppm/common/upload.py（validate_xlsx_upload 中立异常 PpmUploadError） | ✅ |
| task-02 | problem/importer.py（纯解析+枚举规范化是/否→1/0） | ✅ |
| task-03 | problem/schema.py 4 DTO（PreviewRow 24字段/PreviewResp/CommitReq/ResultResp） | ✅ |
| task-04 | problem/router.py import-preview/import-commit 端点（路由前置于 /{item_id}） | ✅ |
| task-05 | problem/service.py import_preview（批量反查+严格校验+短路）/ import_commit（重查防篡改+data_scope+原子单次commit+字段映射） | ✅ |
| task-06 | test_importer.py(17) + test_import_flow.py(9) | ✅ |
| task-07 | lib/ppm/problem.ts client + types.ts 4 类型 | ✅ |
| task-08 | import-problem-modal.tsx 三态弹窗（标红/handleCommit 提交 valid 行） | ✅ |
| task-09 | problem-list/page.tsx 接入「导入」按钮 | ✅ |
| task-10 | problem-import-template.xlsx 17 列模板（D-003 全字段） | ✅ |
| task-11 | import-problem-modal.test.tsx 3 用例 | ✅ |

## 设计一致性

对照 design.md §5/§7/§11 + decisions D-001~D-014，实现一致（acceptance review 12 项检查 9 pass / 3 gap 已修）：

- §7 端点（import-preview UploadFile→validate_xlsx_upload→anyio.to_thread→service；import-commit JSON→service）+ 4 DTO + 字段映射表（module_name→ORM.model_name+module_id D-012、date→datetime D-010）
- §5 import_preview：批量反查（project=PpmProjectMaintenance.project_name D-002 非 .name；module=list_modules_by_project 范围内 D-006；duty/audit=该项目 PpmProjectMember D-014）+ 严格校验（project_name 必填须匹配 D-009、pro_desc 必填、module/duty/audit 填了须匹配 D-004、project 失败短路）+ date→datetime
- §5 import_commit：**不信任前端 UUID 重查**（D-011）+ data_scope 校验 + 显式字段映射 + status="新建"/created_by/file_urls=[]（D-007）+ **session.add_all 单次 commit 原子**（D-008，非逐行 _Crud.create）+ 不查重（D-005）
- D-013 upload 抽 ppm/common（中立异常，不抛 PlanError/不引 plan 私有）
- §3 非目标（不查重/不附件/不非新建态/不改现有 API）/ §9 兼容（旧功能零回归）

## 探针结果

- **独立 QA acceptance review（opus 子代理）**：12 项检查 9 pass / 3 gap，无 P0。发现并修复：
  - **P1**（关键 bug）：官方模板表头「是否加急」「问题答复」与 importer `_FIELD_ALIASES`（原只认「是否紧急」「解决方案」）不一致 → 用户按模板填会静默丢失 is_urgent/pro_answer。修复：补别名 + 全 17 字段逐一核对（仅此 2 个不匹配）+ 用官方模板文件实跑 parse_problem_workbook 验证两字段非 None + 补 TestOfficialTemplateHeaders 用例防回归。
  - **P2**：import-problem-modal 结果态用 result.skipped（后端恒 0）→ 改用 preview 阶段 invalidCount。
  - **mypy**：test_importer.py 12 个 [list-item] 错误（list 不变）→ `list[list[object]]` 改 `list[Sequence[object]]` 协变，零逻辑改动，不用 type:ignore。
- 端点路由前置于 /{item_id}（FastAPI 路由顺序坑规避，对齐 export-excel）。
- 前端 preview 走 uploadExcelWithAuth（multipart）非 apiFetch（强制 JSON 不适用）。
- worktree assess 决策 SAFE，auto-apply 13 文件（+677/-6）到主工作区，无高风险文件（lockfile/migration/配置/入口）。

## 测试结果（实测，非子代理自报）

- **backend ppm 全量**：**449 passed**（103s，11 warnings = 既有 errors.py HTTP_422 DeprecationWarning 非本次引入），零回归
  - problem 子域 69 passed：test_importer 17（含官方模板表头用例）+ test_import_flow 9（未匹配标红/必填/原子回滚/防篡改/data_scope 越权/权限 401）+ 现有 43
- **frontend vitest 全量**：**1068 passed**（27s，106 test files，1 skipped，29 todo），零回归
  - import-problem-modal.test：3 passed（三态切换/标红/提交回传）
- **ruff**：All checks passed（变更文件）
- **mypy**：5 源文件 no issues（importer/service/schema/router/upload）
- 变更文件无 TODO/FIXME/HACK/XXX

## 变更风险等级

**低**。纯新增功能（2 端点 + 三态弹窗 + 模板），无 schema/migration/状态机/权限变更，不改现有 create/导出/列表/3 态执行流 API。全量测试零回归（ppm 449 + frontend 1068）。commit 时 ci-check hook 会再卡 mypy/ruff（已干净）。

## Runtime Evidence

N/A — 本变更非 integration/deployment-critical（纯 CRUD Excel 导入，无 daemon/session/lease/lifecycle 关键词）。核心逻辑（反查/严格校验/原子入库/防篡改/data_scope）已由单测覆盖；端到端真实联调（真实 Excel 上传 + 真实后端反查 + 真实浏览器交互）留作部署后人工 e2e。

## 遗留 / 注意

- **遗留（低优先）**：service.py `_build_member_maps` 同名成员 last-wins 行为待加注释（超 task-05 修复范围，与 `_build_project_name_map` 同口径，非 bug）。
- **部署注意**：前端改动须 `docker compose --build frontend` 重新构建（prod 镜像 baked）；后端无 migration（复用现有表，无需 alembic upgrade）。
- verify 通过后建议：commit 变更 → 部署 → 人工 e2e（下载模板/填/上传/预览标红/确认入库）。
