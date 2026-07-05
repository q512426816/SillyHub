---
author: qinyi
created_at: 2026-07-03 08:40:00
change: 2026-07-02-decouple-scan-from-change-flow
plan_level: normal
---

# 实现计划：scan 从变更流程彻底移除

## plan_level 判定

**normal**。涉及 12 文件、跨 backend(change/workspace) + frontend + migration 模块、含 DB migration 与状态机变更 → 非 none；8 task 依赖明确、粒度均匀（每 task 1-3 文件）→ normal 非 complex。

## Wave 总览

| Wave | 任务 | 依赖 |
|---|---|---|
| W1 后端状态机核心 | task-01 / task-02 / task-03 | 无 |
| W2 迁移 + 门禁 | task-06 / task-05 | W1 |
| W3 前端 | task-04 | W1（可与 W2 并行） |
| W4 测试 + 验证 | task-07 / task-08 | W1~W3 |

## 依赖关系图

```
W1  task-01(状态机model+dispatch) ──┬─► task-02(起点brainstorm: service+parser) ──► task-05(门禁)[W2]
                                    ├─► task-03(删 scan.md)
                                    └─► task-06(migration)[W2]
W3  task-04(前端步骤条) ◄──── task-01(5 段定义对齐)   [可与 W2 并行]
W4  task-07(测试) ◄──── task-01~06
    task-08(验证) ◄──── task-07
```

---

## Wave 1 — 后端状态机核心（无依赖）

- [x] task-01: 后端状态机收敛 5 段
  - 文件：`backend/app/modules/change/model.py`、`backend/app/modules/change/dispatch.py`
  - 改动：`StageEnum` 删 `SCAN`；`spec_stages()` 去 SCAN；`TRANSITIONS` 删 `SCAN→BRAINSTORM`；`STAGE_ORDER`/`STAGE_AGENT_CONFIG` 去 scan；assert 对齐
  - 完成标准：`spec_stages()` 返回 5 段；`get_config_for_stage("scan")` 返回 None；TRANSITIONS 不含 scan 边
  - 覆盖：FR-01, FR-03, D-001@V1, D-003@V1（接受 StageEnum 偏离 sillyspec CLI 的 6 stage）

- [x] task-02: 新建变更起点 brainstorm
  - 文件：`backend/app/modules/change/service.py`、`backend/app/modules/change/parser.py`
  - 改动：`service.py:654-655` draft→brainstorm；`parser.py:589` scan→brainstorm；验证 daemon-client 解析路径无第三处设置点
  - 完成标准：draft/空 current_stage 的变更 transition 进入 brainstorm；解析变更默认 brainstorm
  - 覆盖：FR-02, D-001@V1

- [x] task-03: 删 scan stage 派发资源
  - 文件：`backend/app/modules/change/prompts/scan.md`（删除）
  - 改动：删除 scan.md（STAGE_AGENT_CONFIG.scan 已在 task-01 删）
  - 完成标准：prompts/ 无 scan.md；全局无残留引用
  - 覆盖：FR-03, D-002@V1（不重定位 scan 到 workspace 枚举，scan 派发资源直接删除而非迁移）

---

## Wave 2 — 迁移 + 门禁（依赖 W1）

- [x] task-06: alembic 存量迁移
  - 文件：`backend/migrations/versions/202607022300_remove_scan_from_change_flow.py`（新增）
  - 改动：execute 前跑 `alembic heads` 确认单一 head，`down_revision` 接真实 head；`upgrade()` 将 `current_stage='scan'` → `'brainstorm'`
  - 完成标准：upgrade 成功；存量 scan 变更迁移到 brainstorm；alembic heads 单一
  - 覆盖：FR-06, D-005@V1

- [x] task-05: 未扫描 workspace 门禁
  - 文件：`backend/app/modules/change/service.py`（create/注册路径）
  - 改动：新建变更时检查 `workspace.last_scanned_at IS NULL` 或无 scan_docs → 抛 409 + 引导「请先扫描工作区」
  - 完成标准：未扫描 workspace 新建变更返回 409；已扫描 workspace 正常创建（current_stage=brainstorm）
  - 覆盖：FR-05, D-004@V1

---

## Wave 3 — 前端（依赖 W1，可与 W2 并行）

- [x] task-04: 前端步骤条 5 段
  - 文件：`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx`
  - 改动：`WORKFLOW_STAGES` 去 `"scan"`；`WORKFLOW_STAGE_LABELS`/`COLORS` 去 scan；`changes/page.tsx` 阶段筛选项去 scan
  - 完成标准：变更详情页步骤条显示 5 段（需求分析/规划/执行/验证/归档）；筛选无 scan
  - 覆盖：FR-04

---

## Wave 4 — 测试 + 验证（依赖 W1~W3）

- [x] task-07: 测试更新
  - 文件：`test_dispatch.py`、`test_gate_transitions.py`、`test_complete_stage.py`、`test_projection.py`（scan→brainstorm）
  - 不动：`runtime/test_router.py`、`agent/test_execution_context*.py`（workspace-scan 级）
  - 完成标准：被改测试断言对齐 5 段；workspace-scan 测试不受影响
  - 覆盖：FR-01~FR-06

- [x] task-08: 验证
  - 命令：后端 `uv run pytest -q --cov=app --cov-fail-under=60`（重点 change/workflow）；前端 `pnpm vitest run`（changes 页）；手动（步骤条 5 段 + 新建变更从 brainstorm 起 + workspace 扫描仍正常）
  - 成功标准：SC-1~SC-7 全通过
  - 覆盖：SC-1~SC-7

---

## 自检清单

- [x] 每个 task 有明确完成标准（可验证）
- [x] Wave 间依赖清晰（W2/W3 依赖 W1，W4 依赖 W1~W3），无环
- [x] 粒度均匀（每 task 1-3 文件）
- [x] TDD 对齐：task-07 测试与 task-01~06 实现一一对应
- [x] 决策全覆盖：D-001@V1（task-01/02）、D-002@V1（task-03 不重定位直接删）、D-003@V1（task-01 接受偏离 CLI）、D-004@V1（task-05 门禁）、D-005@V1（task-06 存量重置）
- [x] workspace-scan（agent run_type=scan / runtime stages）显式排除，不动

## execute 时风险提示

1. **migration down_revision**：execute 前必跑 `alembic heads`，接真实 head（memory migration-chain-fragmentation 教训）
2. **current_stage 设置点全覆盖**：task-02 验证 parser:589 + service:654 之外，daemon-client 解析路径无第三处遗漏
3. **前端 scan 残留**：task-04 改后跑 vitest + 手动确认步骤条
4. **pre-commit hook**：ruff/mypy/frontend ci-check 拦截时修复不跳过（CLAUDE.md 规则 9）
5. **覆盖率门槛 60%**：scan 测试改写非删除，覆盖率不致跌破
