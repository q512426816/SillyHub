---
author: qinyi
created_at: 2026-07-03 09:25:00
change: 2026-07-02-decouple-scan-from-change-flow
---

# 模块影响矩阵：scan 从变更流程彻底移除

## 三重交叉验证

- **声明范围**（design.md §6 文件清单）：12 项
- **任务范围**（plan.md 8 task）：15 文件
- **真实变更**（git diff main -- 本次 decouple-scan 相关）：15 文件
- **以 git diff 为准**：本次 15 文件匹配 backend + frontend + sillyspec(资源删除)

## 影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| backend | 逻辑变更 + 数据结构变更 | `app/modules/change/model.py`（StageEnum 删 SCAN / TRANSITIONS / spec_stages）、`dispatch.py`（STAGE_ORDER/CONFIG 去 scan）、`service.py:654`（draft→brainstorm）、`parser.py:589`（scan→brainstorm）、`change_writer/service.py`（未扫描门禁）、`migrations/202607022300`（存量 scan→brainstorm） | 变更流程 6→5 段，scan 移除，新建变更起点 brainstorm | false |
| backend | 测试更新 | `app/modules/change/tests/{test_dispatch,test_gate_transitions}.py`、`tests/modules/change/{test_dispatch_stage_config,test_e2e_stage_dispatch}.py`、`change_writer/tests/{test_proxy,test_router}.py` | scan 断言改 brainstorm + 门禁 fixture 设 last_scanned_at | false |
| frontend | 逻辑变更 | `changes/[cid]/page.tsx`（WORKFLOW_STAGES 去 scan）、`changes/page.tsx`（筛选去 scan） | 步骤条 5 段、筛选去 scan | false |
| sillyspec | 资源删除 | `app/modules/change/prompts/scan.md`（删除） | scan stage prompt 不再需要 | false |

## 不受影响模块（显式排除）

- **sillyhub-daemon**：未改（scan 解耦在 backend 层，daemon 不感知 StageEnum）
- **agent 模块 workspace 扫描**（`run_type=scan` / context_builder / router）：未动，与变更 StageEnum.SCAN 解耦
- **scan_docs 模块 / workspace 详情页扫描按钮**：未动
- **runtime 模块**：stages 来自 sillyspec.db，不依赖 StageEnum，未动
- **deploy / ci / build**：未动

## 备注

工作区存在非本次变更的遗留改动（daemon/agent/spec_workspace tests、workspace page.tsx、.sillyspec staged、docs/quick-done md），不属于本变更范畴，commit 时排除（只 add 本次 15 文件）。
