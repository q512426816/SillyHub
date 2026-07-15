---
author: WhaleFall
created_at: 2026-07-14 23:28:00
---

# 模块影响分析（Module Impact）— 里程碑明细·实施阶段 模块导入

## 三重交叉验证
- **声明范围**（design.md §6 / proposal.md）：13 文件清单
- **任务范围**（plan.md / tasks）：task-01~12 allowed_paths
- **真实变更**（git diff d00c124e..a32f07c7）：16 文件

三者一致（真实 diff 含 design 清单全部 + uv.lock 依赖锁 + fixtures/.gitkeep + ImportModuleModal.test.tsx，已在 design §6 补全）。以 git diff 为准。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| ppm（backend/plan） | 数据结构变更 | `backend/app/modules/ppm/plan/model.py`、`backend/migrations/versions/20260714_add_plan_type_to_plan_node_module.py` | `PlanNodeModule` 新增 `plan_type` 字段（String(32) nullable）+ alembic migration | false |
| ppm（backend/plan） | 接口变更 + 新增 | `backend/app/modules/ppm/plan/router.py`、`importer.py`(新)、`schema.py` | 新增 `import-preview`/`import-commit` 两端点（PPM_PLAN_WRITE，413/415/422 校验）；6 个导入 DTO；importer.py 按表头名解析 Excel | false |
| ppm（backend/plan） | 逻辑变更 | `backend/app/modules/ppm/plan/service.py` | `import_preview`（anyio.to_thread + ORM 反查）、`import_commit`（D-008 单事务原子 + 同名合并 + 模块汇总） | false（D-008 已 code review） |
| ppm（backend/plan） | 测试新增 | `tests/test_importer.py`(新 14)、`tests/test_router.py`、`tests/fixtures/.gitkeep` | importer 单测 + 端点集成测试（含原子回滚） | false |
| backend 基础 | 配置变更 | `backend/pyproject.toml`、`backend/uv.lock` | 新增依赖 `python-multipart>=0.0.9`（UploadFile 必需） | false |
| ppm（frontend） | 逻辑变更 + 接口变更 | `frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx`、`__tests__/ImportModuleModal.test.tsx`(新) | `moduleColumns` 计划类型列；`ImportModuleModal` 三态弹窗 + 导入按钮；流程测试 | false |
| ppm（frontend lib） | 接口变更 | `frontend/src/lib/ppm/{export,plan,types}.ts` | `uploadExcelWithAuth`（FormData+token 刷新）；`importModulesPreview/Commit`；6 导入 TS 类型 | false |
| docs/sillyspec | 新增 | `docs/sillyspec/windows-python-crlf-taskcard.md` | 记录 Windows python 写 task-NN.md 变 CRLF 破坏 plan-postcheck 正则的工具坑 | false |

## 未匹配文件
无。所有变更文件均归属 ppm 模块（后端 plan 子域 + 前端 milestone-details/lib）或 backend 基础（依赖）或 docs/sillyspec（工具坑记录）。

## 影响汇总
- **核心模块**：ppm（后端 plan 子域 + 前端 ppm 页面/lib）
- **影响类型**：数据结构（plan_type 字段）、接口（2 新端点 + 6 DTO + 前端 API/类型）、逻辑（importer 解析 + service 两阶段入库 + 前端三态弹窗）、配置（python-multipart 依赖）、测试（importer 单测 + 端点集成 + 前端流程）
- **跨模块依赖**：无（变更集中在 ppm 域，不涉及 auth/change/daemon 等其他模块的业务逻辑；仅复用 auth 的 PPM_PLAN_WRITE 权限和 common 的 anyio.to_thread 约定）
- **后续需关注**：ppm.md 模块文档需补导入端点 + plan_type 字段（sync-module-docs 步骤处理）
