---
id: task-01
title: orchestrator team_mission_entry supports orchestration_mode=external
title_zh: orchestrator team_mission_entry 支持 external 模式（跳过 orchestrator spawn）
author: qinyi
created_at: 2026-08-08 17:39:23
priority: P0
depends_on: []
blocks: [task-05, task-06, task-07, task-09]
requirement_ids: [FR-08]
decision_ids: [D-007@v1]
allowed_paths:
  - C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\agent\orchestrator.py
provides:
  - contract: team_mission_entry_orchestration_mode
    fields:
      - orchestration_mode 形参（str，默认 team）
      - "返回类型 tuple[AgentMission, AgentRun|None]"
  - contract: mission_constraints_orchestration_mode
    fields:
      - mission.constraints.orchestration_mode=external（external 模式落库，供 task-03 检测）
goal: >
  team_mission_entry 加 orchestration_mode 形参，external 模式只建 mission（constraints 存 mode）、跳过主 agent run 与 daemon lease，返回 (mission, None)；默认 team 零回归。
implementation:
  - "加形参 orchestration_mode: str = \"team\"（默认 team，既有调用方零回归）"
  - "在合并 constraints 处：external 模式把 {\"orchestration_mode\": \"external\"} 并入 merged（落 AgentMission.constraints，不加列，D-002）"
  - external 分支：commit mission 后直接返回 (mission, None)——跳过 main_run 创建（orchestrator.py:169-185）+ dispatch_to_daemon（:191-205）+ lease 记录
  - team 分支（默认）：原逻辑字节不变，返回 (mission, main_run)
  - "返回类型注解改 tuple[AgentMission, AgentRun | None]"
acceptance:
  - "orchestration_mode=\"external\" → 不建 role=orchestrator 的 AgentRun、不调 dispatch_to_daemon、不占 lease"
  - "external mission 的 constraints 含 {\"orchestration_mode\": \"external\"}"
  - 默认（team）行为与改动前一致，既有 test_orchestrator / test_team_mode_dispatch 全绿
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_orchestrator.py app/modules/agent/tests/test_team_mode_dispatch.py -q
---

## 实现依据
- design §7.1（create_mission 新增 orchestration_mode 可选参，external 跳过 orchestrator run/lease，constraints 存 mode）
- design §5.1 数据流：mode="external" → 不建 orchestrator run / 不派 orchestrator lease + constraints 标记
- design §11 D-007@v1（mission external 模式，解 P0-2 僵尸 orchestrator）
- 源码：orchestrator.py:130 team_mission_entry（当前返回 tuple[AgentMission, AgentRun]，硬编码 spawn main_run + lease）

## 跨任务契约
- provides `team_mission_entry_orchestration_mode` + `mission_constraints_orchestration_mode`：被 task-03（converge 检测 external）/ task-04（mcp_gateway create_mission 透传）消费
- 不持久化新列（constraints JSON 复用，model.py:601），与 D-002 一致
