---
id: task-10
title: GLM fallback（主 agent 不可用 / 选 GLM 时退化 v1 链路）
title_zh: GLM 降级路径
author: qinyi
created_at: 2026-07-12 13:04:06
priority: P1
depends_on: [task-09]
blocks: []
requirement_ids: [FR-7]
decision_ids: [D-004@v2]
allowed_paths:
  - backend/app/modules/agent/orchestrator.py
  - backend/app/modules/agent/mission.py
expects_from:
  task-09:
    - contract: ModeDispatch
      needs: [fallback_hook]
goal: >
  主 agent 不可用或用户选 GLM 模型时，mode=team 退化走 v1 GLM Coordinator/Finalizer 链路，
  保留 v1 链路不删。
implementation:
  - OrchestratorService 检测主 agent 不可用（无 daemon / 主 agent agent_type 不支持）
  - 退化路径：mode=team 但无主 agent → 走 v1 CoordinatorPlanner + Finalizer（GLM 链路）
  - 用户选 GLM 模型时主动走 GLM 链路（D-004）
  - v1 GLM 链路保留（不删，fallback 时调用）
acceptance:
  - 主 agent 不可用时 mission 仍可完成（走 GLM）
  - 用户选 GLM 时走 v1 链路
  - v1 GLM 链路不被删除
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_orchestrator -q --no-cov -k fallback
constraints:
  - 保留 v1 GLM 链路（不重写，D-004 演进）
  - fallback 路径明确降级（日志标注 GLM fallback）
  - 主 agent 不可用检测准确（不误判）
---
