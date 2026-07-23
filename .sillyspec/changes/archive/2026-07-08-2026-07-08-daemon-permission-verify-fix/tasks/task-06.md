---
author: qinyi
created_at: 2026-07-08T21:55:21
id: task-06
title: verify stage requires_worktree=false
priority: P0
estimated_hours: 2
depends_on: []
blocks: []
allowed_paths:
  - backend/app/modules/change/dispatch.py
goal: 将 verify stage 的 requires_worktree 改为 False，消除 daemon-client 下 worktree lease 矛盾
implementation: 修改 STAGE_AGENT_CONFIG 中 StageEnum.VERIFY.value 对应的 StageAgentConfig.requires_worktree 从 True 改为 False，保持 read_only=False，并更新下游消费链路断言
acceptance: STAGE_AGENT_CONFIG[VERIFY].requires_worktree is False；verify dispatch 不创建 worktree lease；last_dispatch.config.requires_worktree==False；其余 stage 保持 True；stage config 测试全绿
verify: 跑 test_dispatch_stage_config.py（backend/tests/modules/change/）确认 verify 断言更新后全绿，断言 verify.requires_worktree==False
constraints: 不改 read_only（verify 仍写 verify-result.md）；仅改 verify 配置源头，不动 agent/service.py 消费方；依赖 host-fs-delegate 保证 daemon cwd 正确
covers: [FR-005, D-004]
---
# task-06: verify stage requires_worktree=false

## 文件
修改 backend/app/modules/change/dispatch.py（STAGE_AGENT_CONFIG 的 VERIFY 项）

> 说明：design.md §6 文件清单写 `agent/service.py`，但 `requires_worktree` 的真实定义点是 `change/dispatch.py` 的 `STAGE_AGENT_CONFIG` 字典（line 78-119）。`agent/service.py:1019/1050` 是消费方（`start_stage_dispatch` 接收 `requires_worktree` 参数），不持有 verify 专属配置，无需改动。本 task 改 config 源头即可让 dispatch 链路（`dispatch()` line 632 / `SillySpecStageDispatchService._dispatch_stage` line 937）透传 False。

## 操作步骤
1. 定位 `backend/app/modules/change/dispatch.py` 的 `STAGE_AGENT_CONFIG`（line 78-119）。
2. 将 `StageEnum.VERIFY.value` 对应的 `StageAgentConfig`（line 103-110）的 `requires_worktree` 从 `True` 改为 `False`：
   ```python
   StageEnum.VERIFY.value: StageAgentConfig(
       enabled=True,
       prompt_template="verify.md",
       phase="Verify",
       requires_worktree=False,  # D-004: daemon-client 不用 worktree，配合 host-fs-delegate
       read_only=False,
       description="Write verify-result.md and run verification checks.",
   ),
   ```
3. 确认下游消费链路无硬编码 verify+worktree 假设：
   - `dispatch()`（line 613-632）：`config.requires_worktree` 透传到 `start_stage_dispatch`，改为 False 后 `start_stage_dispatch`（agent/service.py:1050 `if requires_worktree:`）跳过 `_try_acquire_lease`，`resolve_work_dir` 走非 worktree 分支（workspace_root / change.path）。
   - `_dispatch_stage`（line 914/937）：同上透传。
4. 不改 `read_only`（verify 仍需写 verify-result.md，read_only 保持 False）。
5. 检查 `test_dispatch_stage_config.py`（backend/tests/modules/change/）是否有断言 verify.requires_worktree==True 的用例，若有则更新为 False（这是配置变更的正确体现，非测试逻辑错误）。

## 验收标准
- `STAGE_AGENT_CONFIG[StageEnum.VERIFY.value].requires_worktree is False`。
- verify stage dispatch 时不创建 worktree lease（`start_stage_dispatch` 的 `lease` 为 None）。
- `change.stages.last_dispatch.config.requires_worktree` == False（dispatch.py:613/914 写入）。
- brainstorm/plan/execute/archive 的 `requires_worktree` 保持 True 不变（仅 verify 改）。
- 现有 stage config 测试全绿（更新 verify 断言后）。

## 依赖
无（Wave 3 独立）。host-fs-delegate（2026-07-06-daemon-host-fs-delegate）提供 agent cwd 正确性，本 task 只解配置层矛盾。

## 风险
- verify 在非 worktree 下写 verify-result.md：依赖 host-fs-delegate 让 daemon 机器写到正确 spec_root（design §5 Phase 4）。若 host-fs-delegate 未部署，verify 可能写到容器内错误路径——但 worktree 本就旁路（worktree-vestigial），现状 verify 也跑不通，改 False 是把"卡 worktree lease"降级为"靠 host-fs-delegate 定位"，不引入新坏。
- verify 仍 read_only=False：写安全靠 task-03/04 的 CLI deny + PolicyEngine allowed_roots 兜底（R-01）。
