---
author: qinyi
created_at: 2026-07-24 09:45:00
plan_level: full
---

# 实现计划（Plan）

## Spike 前置验证

无。技术方案确定——完全复用项目计划导入范式（`plan/importer.py` + `import-preview`/`import-commit` + `import-module-modal.tsx`），反查源/字段映射/原子性等关键不确定性已由 Design Grill 据源码核验并落决策（D-006/D-008~D-014）。

## Wave 1 — 后端解析与端点（顺序，无前端依赖）

- [x] task-01: 新增 `ppm/common/upload.py` 通用 .xlsx 上传校验（覆盖：FR-02, D-013@v1）
- [x] task-02: 新增 `problem/importer.py` 纯解析 + 枚举规范化（覆盖：FR-02, D-001@v1）
- [x] task-03: `problem/schema.py` 增 4 个导入 DTO（覆盖：FR-02, D-003@v1）
- [x] task-04: `problem/router.py` 增 import-preview / import-commit 端点（覆盖：FR-02, FR-11, D-001@v1）
- [x] task-05: `problem/service.py` 增 import_preview（反查+严格校验）+ import_commit（重查+date转换+字段映射+原子单次事务）（覆盖：FR-03~FR-10, D-002/D-004~D-012/D-014@v1）
- [x] task-06: 后端测试 新增 `test_importer.py` + `test_import_flow.py` 导入端点用例（problem/tests/ 无 test_router.py）（覆盖：全部 FR 验收）

## Wave 2 — 前端组件与接入（依赖 Wave 1 端点）

- [x] task-07: `lib/ppm/problem.ts` + `types.ts` 导入 client 函数与类型（覆盖：FR-02, FR-12）
- [x] task-08: 新增 `components/ppm/problem/import-problem-modal.tsx` 三态弹窗（覆盖：FR-12, D-001@v1）
- [x] task-09: `problem-list/page.tsx` 接入「导入」按钮（覆盖：FR-01, FR-12）
- [x] task-10: 新增 `frontend/public/templates/problem-import-template.xlsx` 静态模板（覆盖：FR-01, D-003@v1）
- [x] task-11: 前端测试 `import-problem-modal.test.tsx`（覆盖：FR-12 验收）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | ppm/common/upload.py 上传校验 | W1 | P0 | — | FR-02, D-013 | 抽通用 .xlsx 校验，中立异常 |
| task-02 | problem/importer.py 纯解析 | W1 | P0 | — | FR-02, D-001 | 按表头定位列/合并填充/日期/枚举规范化 |
| task-03 | problem/schema.py 导入 DTO | W1 | P0 | — | FR-02, D-003 | 4 DTO：PreviewRow/PreviewResp/CommitReq/ResultResp |
| task-04 | problem/router.py 2 端点 | W1 | P0 | task-01, task-03 | FR-02, FR-11, D-001 | import-preview/import-commit，权限同 create |
| task-05 | problem/service.py 反查/校验/入库 | W1 | P0 | task-02, task-03 | FR-03~10, D-002/4/5/6/7/8/9/10/11/12/14 | 核心逻辑：批量反查+严格校验+原子单次commit+重查防篡改+date→datetime(preview/commit) |
| task-06 | 后端测试 | W1 | P0 | task-01~05 | 全 FR | test_importer + test_import_flow 导入用例 |
| task-07 | lib/ppm client+types | W2 | P0 | Wave 1 | FR-02, FR-12 | importProblemsPreview/Commit + 类型 |
| task-08 | import-problem-modal 组件 | W2 | P0 | task-07 | FR-12, D-001 | 三态弹窗，复制 import-module-modal 范式 |
| task-09 | page.tsx 接入导入按钮 | W2 | P0 | task-08 | FR-01, FR-12 | 顶部「导出」旁加「导入」 |
| task-10 | 静态模板 xlsx | W2 | P1 | — | FR-01, D-003 | 17 列中文表头 + 示例行 |
| task-11 | 前端测试 | W2 | P0 | task-08 | FR-12 | 三态切换/标红/提交回传 |

## 关键路径

task-02 → task-05 → task-06（后端解析→入库→测试）→ task-07 → task-08 → task-09（前端 client→弹窗→接入）。task-01/task-03 可与 task-02 并行预备；task-10 独立。

## 全局验收标准

- [ ] 后端 `cd backend && uv run pytest app/modules/ppm -q --no-cov` 通过（含 test_importer + test_router 导入用例）
- [ ] 前端 `cd frontend && pnpm test` 通过（含 import-problem-modal.test）
- [ ] 前端 `pnpm typecheck` 通过
- [ ] 后端 `ruff check . && mypy app` 通过
- [ ] （brownfield）旧功能不变：create/编辑/导出/列表/3 态执行流行为零回归
- [ ] 导入端点权限同 create_problem（无权限 403）
- [ ] 严格校验：项目名/责任人/验证人/模块名填了未匹配、项目名或问题描述为空 → 整行 valid=false 标红不入库
- [ ] 原子入库：单次事务，全成或全回滚（D-008）
- [ ] 防篡改：commit 按原文重新反查，前端伪造 UUID 无效（D-011）
- [ ] 字段正确：module_name→model_name+module_id、date→datetime、枚举是/否→1/0（D-010/D-012）
- [ ] 跨项目导入：Excel 每行项目名反查，一次导入多项目（D-002）

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-02, task-04, task-08 | 后端解析+两步式+前端三态弹窗 |
| D-002@v1 | task-05 | project_name 反查 + 跨项目 |
| D-003@v1 | task-03, task-10 | 全字段 DTO + 模板 |
| D-004@v1 | task-05, task-06 | 严格匹配校验 + 测试 |
| D-005@v1 | task-05 | 不查重 |
| D-006@v1 | task-05 | 反查源（project/module/成员） |
| D-007@v1 | task-05 | 系统字段默认（status/created_by/file_urls） |
| D-008@v1 | task-05, task-06 | 原子单次事务 + 原子性测试 |
| D-009@v1 | task-05, task-06 | 必填=项目名+问题描述 + 测试 |
| D-010@v1 | task-05 | date→datetime 转换 |
| D-011@v1 | task-05, task-06 | commit 重查防篡改 + 测试 |
| D-012@v1 | task-05 | module_name→model_name+module_id 映射 |
| D-013@v1 | task-01 | 上传校验抽 ppm/common |
| D-014@v1 | task-05 | duty/audit 限项目成员 |
| FR-01 | task-09, task-10 | 模板下载入口 + 模板文件 |
| FR-02 | task-01~04 | 上传预览端点链路 |
| FR-03 | task-05, task-06 | 严格匹配校验 |
| FR-04 | task-05, task-06 | 必填校验 |
| FR-05 | task-05, task-06 | 原子入库 |
| FR-06 | task-05, task-06 | 防篡改 |
| FR-07 | task-05 | 字段映射与转换 |
| FR-08 | task-05 | 系统字段 |
| FR-09 | task-05, task-06 | 不查重 |
| FR-10 | task-05, task-06 | 跨项目 |
| FR-11 | task-04 | 权限同 create |
| FR-12 | task-07~09, task-11 | 前端三态弹窗 + 测试 |
