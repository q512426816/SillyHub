---
author: WhaleFall
created_at: 2026-07-14 18:50:30
plan_level: full
---

# 实现计划（Plan）— 里程碑明细·实施阶段 模块导入

> 来源：`design.md` §5/§6、`tasks.md`、`decisions.md`（D-001~D-008 全 accepted，无 P0/P1 unresolved）。
> Wave 按拓扑严格分层（同 Wave 内任务互不依赖，可并行；execute 按依赖安全执行）。无 Spike（方案确定）。

## Wave 1（无依赖 — 数据模型基础）
- [ ] task-01: 后端 `PlanNodeModule` 加 `plan_type` 字段 + alembic migration + schema(Base/Create/Update/Resp) 同步加字段（覆盖：FR-002, D-003）
- [ ] task-02: 前端 `types.ts` 加 `plan_type`（含 `PlanNodeModuleUpdate`）+ `moduleColumns` 加「计划类型」列（覆盖：FR-002）

## Wave 2（依赖 Wave 1）
- [ ] task-03: 新增 `python-multipart` 依赖 + 新建 `importer.py`（识别数据 Sheet、按表头名定位列、合并单元格向下填充、Excel 日期序列号转换、两类 Sheet 列位差异处理）（覆盖：FR-003, D-007）
- [ ] task-04: `schema.py` 新增导入 DTO（ImportPreviewRow/Sheet/Resp、ImportCommitReq/Sheet、ImportResultResp）（覆盖：FR-008）

## Wave 3（依赖 Wave 2）
- [ ] task-05: `service.import_preview`（`anyio.to_thread` 包解析 + ORM 查 `ProjectMember` 全量反查 + 标记 `duty_matched`/`valid`）（覆盖：FR-004, D-002）
- [ ] task-06: `service.import_commit`（分组、同名合并、模块汇总、明细 `status=draft`、`session.add()` + 末尾单次 `commit()` 原子提交，**不复用 `_Crud.create`**）（覆盖：FR-001, FR-006, FR-007, FR-009, FR-010, D-001, D-004, D-005, D-008）
- [ ] task-10: 后端 `test_importer.py` 单测（依赖 task-03，可提前并行）（覆盖：FR-003）

## Wave 4（依赖 Wave 3）
- [ ] task-07: `router.py` 新增 `import-preview` / `import-commit` 两端点（显式 `response_model`，`PPM_PLAN_WRITE`）（覆盖：FR-008）

## Wave 5（依赖 Wave 4）
- [ ] task-08: 前端 `export.ts` 抽取 `uploadExcelWithAuth`（FormData + token 刷新）+ `plan.ts` 加 `importModulesPreview` / `importModulesCommit` 及 TS 类型（覆盖：FR-008）
- [ ] task-11: 后端 `test_router.py` 导入端点集成测试（依赖 task-07）（覆盖：FR-001, FR-004, FR-006, FR-009, D-008）

## Wave 6（依赖 Wave 5）
- [ ] task-09: 新增 `ImportModuleModal` 组件（上传/预览勾选+标错/结果态）+ `ModuleLevelTable` 顶部「导入模块」按钮（覆盖：FR-005, FR-008, D-003, D-006）

## Wave 7（依赖 Wave 6）
- [ ] task-12: 前端导入流程测试（上传→预览→确认→结果，mock 后端）（覆盖：FR-008）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR / D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 后端 plan_type 字段+migration+schema | W1 | P0 | — | FR-002, D-003 | model.py + alembic + schema.py |
| task-02 | 前端 plan_type 类型+列表列 | W1 | P0 | — | FR-002 | types.ts + moduleColumns |
| task-03 | python-multipart + importer.py | W2 | P0 | task-01 | FR-003, D-007 | pyproject.toml + 新建 importer.py |
| task-04 | 导入 DTO | W2 | P0 | task-01 | FR-008 | schema.py 新增 6 个 DTO |
| task-05 | service.import_preview | W3 | P0 | task-03, task-04 | FR-004, D-002 | 反查走 ORM 全量 |
| task-06 | service.import_commit | W3 | P0 | task-04 | FR-001,006,007,009,010, D-001,004,005,008 | 原子提交，绕过 _Crud |
| task-10 | importer 单测 | W3 | P1 | task-03 | FR-003 | 自造 xlsx fixtures |
| task-07 | router 两端点 | W4 | P0 | task-05, task-06 | FR-008 | 显式 response_model |
| task-08 | 前端上传+API 函数 | W5 | P0 | task-07 | FR-008 | export.ts + plan.ts |
| task-11 | 端点集成测试 | W5 | P1 | task-07 | FR-001,004,006,009, D-008 | test_router.py |
| task-09 | 导入弹窗+按钮 | W6 | P0 | task-02, task-08 | FR-005,008, D-003,006 | ImportModuleModal |
| task-12 | 前端流程测试 | W7 | P2 | task-09 | FR-008 | vitest |

## 关键路径
task-01 → task-03 → task-05 → task-07 → task-08 → task-09 → task-12（7 节点，决定最短交付周期 = 7 Wave）

> 副路径：task-01 → task-04 → task-06 → task-07（commit 分支汇入 Wave 4 的 task-07）。

## 全局验收标准
- [ ] 后端 `pytest`（`asyncio_mode=auto`）全绿，含 test_importer.py / test_router.py 新增用例
- [ ] 后端 `ruff format --check` + `ruff check` + `mypy app` 通过（line-length 100, double-quote, py312）
- [ ] 前端 `tsc --noEmit` + `pnpm lint` + `vitest run` 通过
- [ ] **（brownfield 兼容）** `plan_type` nullable，旧模块数据 NULL 不影响既有列表/CRUD；未使用导入功能时现有「新建/编辑模块」「明细」流程完全不变
- [ ] 两份参考 xlsx（康尼 / EHS）导入演练：字段映射正确、合并单元格向下填充正确、日期序列号正确转换、责任人未匹配行标红不入库、同名模块追加明细、模块汇总（min/max/求和）正确
- [ ] commit 中途失败（构造异常）整体回滚，无脏数据（验证 D-008）
- [ ] 列表显示「计划类型」列；导入明细固定 `status=draft`
- [ ] 每个端点有显式 `response_model`，不裸返回 dict

## 覆盖矩阵（decisions.md 当前版本）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（两级导入） | task-06 | AC: 同名合并+明细 module_id 关联 |
| D-002@v1（责任人反查） | task-05 | AC: 未匹配行 valid=False 不入库 |
| D-003@v1（多 Sheet/计划类型） | task-01, task-03, task-09 | AC: plan_type 字段 + Sheet 识别 + 勾选 UI |
| D-004@v1（同名合并） | task-06 | AC: 已存在模块复用 id 追加明细 |
| D-005@v1（模块汇总） | task-06 | AC: min/max/sum/首个 正确 |
| D-006@v1（预览确认） | task-04~07, task-09 | AC: 两阶段端点 + 预览弹窗 |
| D-007@v1（方案 A 后端解析） | task-03 | AC: 按表头名定位列 |
| D-008@v1（事务原子性） | task-06 | AC: 单次 commit + 回滚验证 |
