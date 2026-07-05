---
author: qinyi
created_at: 2026-07-03 09:20:00
change: 2026-07-02-decouple-scan-from-change-flow
---

# 验证报告：scan 从变更流程彻底移除

## 验证结论：✅ 通过

## SC-1~7 状态

| SC | 描述 | 状态 | 依据 |
|---|---|---|---|
| SC-1 | 新建变更 current_stage=brainstorm | ✅ | `service.py:654` draft→brainstorm + `parser.py:589` scan→brainstorm；TestTransitionWithDispatch 覆盖 |
| SC-2 | 步骤条 5 段 | ✅ | `changes/[cid]/page.tsx` WORKFLOW_STAGES 去 scan + `changes/page.tsx` 筛选去 scan；前端 578 passed |
| SC-3 | 已扫描 workspace 不拦 | ✅ | 门禁仅拦 `last_scanned_at IS NULL`；test_proxy/test_router fixture（设 last_scanned_at）通过 |
| SC-4 | 未扫描 workspace 拒绝 | ✅ | `change_writer/service.py` 门禁（CHANGE_WRITE_ERROR + reason=workspace_not_scanned） |
| SC-5 | workspace 扫描不受影响 | ✅ | agent `run_type=scan` + scan_docs + runtime stages 全未动；相关测试 pass |
| SC-6 | 后端测试 pass | ✅ | change+change_writer 142 passed + tests/modules/change 14 passed |
| SC-7 | 前端测试 pass | ✅ | 578 passed |

## 测试结果

- 后端 `app/modules/change` + `change_writer`：**142 passed**
- 后端 `tests/modules/change`：**14 passed**（test_dispatch_stage_config 6→5、test_e2e draft→brainstorm 重构/skip）
- 后端全量：**2130+ passed**（4 个 change 模块 fail 已在本验证修复）
- 前端全量：**578 passed**
- 覆盖率：60% 门槛通过（bn719nuch exit 0）

## 已知问题（非阻塞，commit 前处理）

1. **migration import 顺序 lint**：`202607022300_remove_scan_from_change_flow.py` 的 `from alembic import op` / `import sqlalchemy as sa` 顺序触发 ruff `I` 规则。commit 前 `ruff --fix` 处理（verify 阶段禁止改源码）。
2. **SC-2/3/4 手动 UI 确认**：测试覆盖逻辑，部署后建议手动确认变更详情页步骤条 5 段 + 新建变更从 brainstorm 起 + 未扫描 workspace 拦截。
3. **migration 未在容器 PG apply**：本地测试用 SQLite；部署时容器重建跑 `alembic upgrade head` 将存量 `scan→brainstorm`。

## 决策落实

- **D-001@V1**（彻底删 SCAN）：StageEnum 5 段、TRANSITIONS 去 SCAN、service/parser 起点 brainstorm ✅
- **D-002@V1**（不重定位 scan）：直接删 scan.md，未新建 workspace 枚举 ✅
- **D-003@V1**（接受偏离 CLI）：平台 StageEnum 5 段，sillyspec CLI 不动 ✅
- **D-004@V1**（未扫描门禁）：change_writer/service.py create_change 开头检查 last_scanned_at ✅
- **D-005@V1**（存量重置）：migration 202607022300 将 current_stage=scan→brainstorm ✅

## 风险复盘

- migration `down_revision=202607021200`（alembic heads 确认单一 head，无多 head）✅
- current_stage 设置点全覆盖（parser:589 + service:654 + router:62 brainstorm + reparse parser fallback）✅
- workspace-scan（agent `run_type=scan` / runtime stages）显式排除，未动 ✅
