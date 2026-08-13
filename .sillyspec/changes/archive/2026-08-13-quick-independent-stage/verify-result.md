---
title: quick 独立阶段 验证报告
change_key: 2026-08-12-quick-independent-stage
stage: verify
result: PASS_WITH_NOTES
created_at: 2026-08-13T10:01:06+08:00
author: WhaleFall
---

# 验证报告：quick 独立阶段全套适配

## 结论

**PASS WITH NOTES**

8 个 task 全部实现并对照 design.md（D-001~D-004）/ requirements.md（FR-01~06、NFR-01~02）核验通过。后端 ruff/mypy 干净，分类器与分流测试 10 passed，前端 tsc/lint 通过。独立 QA 子代理 acceptance review 已过。

存在两点 NOTE（均不阻断本次验收）：
1. **预存测试债**（ql-006 遗留，非本次引入）：`test_proxy.py:493` 断言 `current_stage=="draft"`，但代码自 ql-006 起已为 `"brainstorm"` —— 在 main HEAD（e8b7c6d5，本次改动前）该测试即失败，与 quick 无关。
2. **真实 daemon↔backend e2e 未执行**：本次改动是 backend 内部枚举/分流 + 前端 UI，未引入 daemon↔backend 新集成点（详见 Runtime Evidence）。

## 任务完成度

对照 plan.md 8 task（全部 `[x]` 已勾选）：

| task | 文件 | 完成度 | 证据 |
|------|------|--------|------|
| task-01 StageEnum 加 QUICK | model.py | ✅ | `StageEnum.QUICK="quick"` + `spec_auxiliary_stages()` 返回 `[QUICK]`；import 实跑 `spec_stages()` 仍主线5阶段 |
| task-02 dispatch 加 quick 配置 | dispatch.py | ✅ | `STAGE_AGENT_CONFIG["quick"]`（prompt=quick.md, read_only=False）；quick.md 模板存在 |
| task-03 创建分流 | proxy.py + service.py | ✅ | 两路均 `initial_stage = "quick" if change_type=="quick" else "brainstorm"` |
| task-04 后端单测 | test_classifier.py | ✅ | 新增5例，10 passed |
| task-05 列表页 quick 标签 | changes/page.tsx | ✅ | STAGE_LABEL 加 `quick:快速任务`，STAGE_KIND 加 `quick:warning` |
| task-06 详情页 quick 操作区 | change-stage-actions.tsx | ✅ | quick 早返回分支（⚡快速修复 + 档案选择器 + 触发按钮 + 完成态） |
| task-07 端到端验证 | — | ✅ | 代码层链路验证（见探针结果） |
| task-08 router 守卫 | router.py | ✅ | `/changes/create` 加 `if change.change_type=="quick"` 守卫 |

## 设计一致性

逐条核验 design.md 决策与需求：

- **D-001（quick 无后继转换）** ✅：`TRANSITIONS`（model.py:103-109）零改动，仅主线5阶段。实跑 `can_transition(QUICK, *)` 均为 False。
- **D-002（quick 是 auxiliary）** ✅：`spec_stages()` 仍 `[BRAINSTORM,PLAN,EXECUTE,VERIFY,ARCHIVE]`（排除 quick）；新增 `spec_auxiliary_stages()` 返回 `[QUICK]`。dispatch.py:46 断言 `spec_stages()==STAGE_ORDER` 在 import 时实跑保持成立。
- **D-003（完成态无 DB 字段）** ✅：前端从 `change.stages.quick.status` 推导（sync_stage_status 同步源），model.py 无新列，alembic versions 空。
- **D-004（详情页 quick 分支隔离主线 UI）** ✅：`currentStage==="quick"` 早返回，return 后主线 gate/推进/团队代码不执行；tsc exit 0 证所有变量 in-scope。
- **FR-01 创建分流** ✅：proxy.py + service.py 两路都按 change_type 分流。
- **FR-02~FR-05** ✅：StageEnum 扩展 / dispatch 配置 / 列表标签 / 详情操作区 全部落地。
- **FR-06 完成态判定** ✅（独立 QA 审查后修正）：原实现误读 `last_dispatch.status`（dispatch 时写死 "running"、sync 不更新，致完成态永不显示）；已改读 `change.stages.quick.status==="completed"`（design D-003/§6 指定源）。
- **NFR-01 向后兼容** ✅：TRANSITIONS/spec_stages/STAGE_ORDER/主线 dispatch 全不变；import 不变量实跑通过。
- **NFR-02 无 DB 迁移** ✅：`current_stage` 是 `Column(String, nullable=True)`（model.py:170），存 "quick" 无 schema 改动。
- **design §9 文件清单** ✅：7 文件全覆盖 + task-08 额外修 router.py（plan 记录的遗留端点）。

## 探针结果

代码层链路验证（只读 grep/import，未启动服务）：

1. **创建分流链路**：`classify_change_type(desc)` → `"quick"` → proxy/service `initial_stage="quick"` → `Change(current_stage="quick", stages={"quick":{"status":"pending"}})`。test_classifier.py `test_quick_classify_maps_to_quick_stage` 覆盖。
2. **dispatch 派发链路**：`STAGE_AGENT_CONFIG["quick"]` 就位 → `get_config_for_stage("quick")` 返回配置 → `manual_dispatch`（router.py POST /changes/{id}/dispatch）generic 调 `dispatch(target_stage=current_stage)`。无需改派发逻辑。
3. **完成态同步链路**：`sync_stage_status`（dispatch.py:1744-1767）按 `current_stage`（="quick"）写 `stages["quick"]["status"]="completed"` —— generic，未针对具体 stage 硬编码，quick 天然走通。前端读同名字段。
4. **主线不受影响**：非 quick 描述 → `initial_stage="brainstorm"`（保持 ql-006）；TRANSITIONS/spec_stages 零改。

## 测试结果

| 套件 | 命令 | 结果 |
|------|------|------|
| 后端 classifier | `pytest app/modules/change_writer/tests/test_classifier.py` | **10 passed**（原5 + 新5） |
| 后端 change_writer 全量 | `pytest app/modules/change_writer/tests/` | 37 passed, **1 failed**（预存债，见下） |
| 后端 ruff | `ruff check <5 改动文件>` | All checks passed |
| 后端 mypy | `mypy <5 改动文件>` | Success, no issues in 5 source files |
| 前端 tsc | `tsc --noEmit` | exit 0（全量） |
| 前端 lint | `next lint <2 改动文件>` | 仅3预存 warning，无新增 |

### 失败用例分析（预存债，非本次引入）

`test_proxy.py::test_proxy_create_change_preempts_change_before_dispatch` 失败：
- 断言：`changes[0].current_stage == "draft"`（test_proxy.py:493）
- 实际：`'brainstorm'`
- **根因**：ql-20260812-006 把 proxy.py 创建逻辑从 `draft` 改 `brainstorm`（proxy.py:282 注释明示），但漏改 test_proxy.py:493 的断言。
- **与本次无关的铁证**（只读 git）：
  - `git diff --stat -- test_proxy.py` 为空（本变更未碰该文件）
  - `git show e8b7c6d5:test_proxy.py | grep` 显示 main HEAD（本次改动前）该行就断言 `"draft"`
  - `git show e8b7c6d5:proxy.py` 显示 main HEAD 已是 `current_stage="brainstorm"`
  - 即：在 main 分支（本次改动前）该测试**已经失败**。
- **本次影响**：无。该测试用例的描述是非 quick（默认 feature→brainstorm），ql-007 的分流逻辑对非 quick 保持 brainstorm（与 ql-006 一致），未改变其行为。
- **处置建议**：单独 quick 修 test_proxy.py:493 断言（draft→brainstorm），或改成跟随 change_type。不属于本变更范围。

## 变更风险等级

**低**。

- 改动性质：backend 枚举加成员 + dict 加 key + 创建分流字符串变量 + 前端 UI 早返回分支。无新 DB 列、无通信协议改动、无启动入口改动。
- 主线隔离：quick 走独立 manual_dispatch，不侵入主线 transition；spec_stages/TRANSITIONS/STAGE_ORDER 全不变（实跑断言通过）。
- 回归保护：change_writer 37 passed（除1预存债），主线创建/派发逻辑未被破坏。
- 唯一行为变化：quick 类型变更创建时 current_stage=quick（而非 brainstorm），符合设计意图。

## Runtime Evidence

> 本节为 integration/deployment-critical 门控的自报告证据（CLI 仅字面校验）。诚实声明：本次**未执行**真实 daemon↔backend 端到端集成测试。

### 本次改动不引入新 daemon↔backend 集成点

design.md/plan.md 命中 `backend` 关键词均为**模块文件路径**（`backend/change`、`backend/app/modules/...`），非 daemon↔backend 跨进程通信语义。本次实际改动范围：

- **backend 内部**：StageEnum 枚举成员、STAGE_AGENT_CONFIG dict 条目、创建分流字符串变量（`initial_stage`）。纯进程内逻辑，无 RPC/WS/HTTP 通信改动。
- **daemon↔backend 通信**：**未改动**。proxy_create_change 的 lease-polling 下发链路、sync_stage_status 的 HostFsDelegate RPC 读 sillyspec.db 链路，均为既有机制，本次仅让它们对 `current_stage="quick"` 工作（generic 复用，未改协议）。
- **启动入口/CLI**：无。未碰 cli.ts/main.ts/server/bootstrap/entrypoint。

### sync_stage_status 对 quick 的支持是 generic 复用（关键论证）

`SillySpecStageDispatchService._sync_stage_status_daemon_client`（dispatch.py:1574-1779）按 `change.current_stage` 读 sillyspec.db 的 changes/stages/steps 表，投影到 `Change.stages[<current_stage>]`。该路径**不针对具体 stage 硬编码**——quick 变更 agent run 完成后，sillyspec.db 写入 `stages.quick.status=completed`，sync_stage_status 按 `current_stage="quick"` 读到并写 `change.stages.quick.status`，前端完成态判定据此成立。plan.md Gap 2 已验证（progress.js:685/698 写 sillyspec.db，sync_stage_status 能读到）。

### 已执行的真实证据

- **进程内集成测试**（真实 DB session + daemon-client workspace binding + mock 回执）：test_proxy.py 4 例创建分流链路中 3 例 pass（在线/离线/无 runtime），验证 proxy_create_change 落 Change + daemon_change_writes 真实 DB 写入链路未被破坏。
- **单元测试**：classifier 分流映射 + StageEnum 不变量 + STAGE_AGENT_CONFIG 配置，10 passed。
- **静态全绿**：ruff/mypy/tsc。

### 未执行及理由

真实 daemon↔backend e2e（起 backend 容器 + daemon 进程，创建 quick 变更，触发 dispatch，验证 sillyspec.db 回写 + sync_stage_status 同步）**未执行**：
- 本次改动无新增集成点（generic 复用既有 RPC 路径），e2e 主要回归的是既有机制，而非本次新逻辑。
- 当前环境 backend/daemon 未运行（sillyspec sync 报 fetch failed 127.0.0.1:8000）。
- 建议部署后在真实环境补一次手动 e2e 冒烟（创建 quick 变更 → 详情页显示「⚡快速修复」→ 触发后显示「✓已完成」），作为部署后验收。

## 下一步建议

1. 本次 verify PASS WITH NOTES，可进 archive。
2. 遗留（独立 quick）：修 test_proxy.py:493 断言 draft→brainstorm（ql-006 遗留债）。
3. 部署后冒烟：真实环境验证 quick 变更创建→派发→完成态全链路。
