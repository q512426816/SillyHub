---
author: qinyi
created_at: 2026-08-26 14:20:00
id: task-06
title_zh: "workspaceId下发覆盖率验证"
title: "验证工作区会话 workspaceId 下发覆盖率（D-008 前置）"
priority: P0
depends_on: []
allowed_paths:
  - backend/app/modules/daemon/lease/context.py
  - backend/app/modules/agent/execution.py
  - backend/app/modules/daemon/tests/test_build_claim_payload.py
goal: 确认工作区普通/主控会话的 execPayload.workspaceId 下发覆盖；发现缺口则本任务内补齐 backend 下发
acceptance: |
  1. 核查 lease/context.py:586-591 下发条件（transport==='tar' 且 lease_meta.workspace_id 已写）：列出工作区各类会话（普通对话/主控 orchestrator/扫描等）在当前部署（SPEC_TRANSPORT=tar）下的覆盖结论（代码证据 + 既有测试证据）
  2. 覆盖完整 → 本任务产出结论文档于本卡片 body（勾选时回填），不改代码
  3. 发现某类工作区会话不带 workspaceId → 在 context.py/execution.py 补下发（最小改动），补对应测试断言
  4. 分身（mission_worker）明确不补（D-008@v1 维持治理受限注入）
verify: cd backend && uv run pytest app/modules/daemon -q --no-cov -n auto（若改代码）；纯核查则产出覆盖率结论即可
implementation: 核查 lease/context.py 下发条件与各会话类型 lease_meta 写入点，缺口则最小补齐
constraints: ["分身 mission_worker 明确不补（D-008@v1）", "quick-chat 豁免（范围外）"]
---

# task-06: workspaceId 覆盖率验证

## 核查清单

1. `lease/context.py` build claim payload 的 workspaceId 写入条件逐分支读透
2. 工作区普通会话（chat=true）、主控（stage=orchestrator）、扫描会话的 lease_meta.workspace_id 写入点（execution.py / orchestrator.py 等）
3. quick-chat 明确豁免（无工作区归属，D-008 范围外）
4. 结论回填本文件 body；缺口修复后补 pytest 断言（payload 含 workspace_id）

## 结论（2026-08-26 执行回填）

下发总条件：`lease_meta.workspace_id`（context.py:537-543）+ 主控兜底（:545-568 本任务补）→ tar 分支双写 `workspaceId/workspace_id`（:613-619）。

| 会话类型 | workspaceId 下发 | 说明 |
|---|---|---|
| 工作区普通对话（create/turn） | 既有下发 | placement.py:768-769 写入 |
| 会话模式主控（orchestrator） | 既有下发 | session/service.py:1326-1342 |
| 外部/team mission 主控（entry/重派/僵尸复活） | **本任务兜底补齐** | dispatch_to_daemon 原不写 workspace_id（placement.py:433-436）；兜底按 agent_run_id→AgentRun.mission_id→AgentMission.workspace_id（NOT NULL anchor）解析，仅 stage=='orchestrator' 触发 |
| 扫描会话（scan run/bootstrap init） | 既有下发 | placement.py:937-938 |
| 分身 mission_worker | 不下发（D-008@v1 明确不补） | 测试 O3 守护 |
| quick-chat | 不下发（豁免） | 测试 O4 守护 |

改动：context.py 兜底 + test_build_claim_payload.py O1-O4（4 passed）；execution.py 未改。daemon 模块 1217 passed 无回归。
