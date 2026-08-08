---
id: task-03
title: finalizer converge external 模式短路（跳过 finalize/cleanup）
title_zh: converge_mission_for_completed_run 检测 external mission → 跳过 finalize/cleanup（不 merge 不清 caller worktree）
author: qinyi
created_at: 2026-08-08 17:39:23
priority: P0
depends_on: []
blocks: [task-07]
requirement_ids: [FR-09]
decision_ids: [D-003@v2]
allowed_paths:
  - C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\agent\finalizer.py
expects_from:
  task-01:
    - contract: mission_constraints_orchestration_mode
      needs: ["mission.constraints['orchestration_mode'] 字段（external 检测依据，task-01 external 模式落库）"]
goal: >
  converge_mission_for_completed_run 在 derive_status 后、finalize 块前插短路：mission.constraints.orchestration_mode=="external" → 直接返回 status，跳过 finalize_execute_mission / finalize_bootstrap_mission（及连带 cleanup），不 merge 不清 caller worktree。
implementation:
  - finalizer.py:503 `status = derive_status(...)` 之后、:505 `if status in ("done","degraded"):` 之前插短路
  - 短路条件：`mission is not None and (mission.constraints or {}).get("orchestration_mode") == "external"`
  - 命中 → log info（converge_external_mode_skip_finalize + mission_id/status）+ return status（collect_completed_artifacts 仍先执行，回灌 worker 产出 artifact 无害且只读）
  - team mission（constraints 无 mode 或 ="team"）默认不命中 → finalize/cleanup 走原 merge 逻辑（零回归）
acceptance:
  - external mission worker 全终态 → converge 不调 finalize_execute_mission / finalize_bootstrap_mission，不触发 git merge / 不清 worktree
  - team mission converge 行为与改动前一致（test_converge_mission_reentrant / test_finalizer / test_finalize_execute_mission_merge 全绿）
  - 双保险：即使本检测失效，路径A 不写 run.worktree_branch（task-02）→ finalize 查空也跳过 merge（finalizer.py:255）
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_converge_mission_reentrant.py app/modules/agent/tests/test_finalizer.py app/modules/agent/tests/test_finalize_execute_mission_merge.py app/modules/agent/tests/test_finalizer_cleanup.py -q
---

## 实现依据
- design §5.1 数据流：converge_mission_for_completed_run 检测 external → 跳过 finalize_execute_mission / cleanup_mission
- design §7.5 缺失事件说明：路径A 不触发 converge finalize/cleanup（external 检测 + 不写 worktree_branch 双保险）
- design §11 D-003@v2（round-2 修订：finalizer 改检测 external 跳过，round-1 v1"不改"被 Grill 证伪）；R-01 根解
- 源码：finalizer.py:470 converge_mission_for_completed_run、:501 mission 取出、:503 status 计算、:505-545 finalize 块（finalize_execute_mission :535 / finalize_bootstrap_mission :545）

## 跨任务契约
- expects_from task-01 `mission_constraints_orchestration_mode`：必须有 constraints 字段才能检测
- 是 R-01（merge 污染 caller 主仓）三重防御的根解层（① external converge 跳过 + ② 不写 worktree_branch + ③ worker_prompt 不 commit）
