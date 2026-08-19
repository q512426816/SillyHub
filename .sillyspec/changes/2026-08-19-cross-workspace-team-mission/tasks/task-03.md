---
id: task-03
title: add-representative-fallback-flag
title_zh: 添加代表 binding 旗标分支
author: qinyi
created_at: 2026-08-19 10:50:00
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001@v2, D-004@v2]
allowed_paths:
  - backend/app/modules/agent/placement.py
  - backend/app/modules/agent/tests/test_placement_representative.py
provides:
  - contract: _resolve_dispatch_runtime
    fields: [representative_fallback]
expects_from:
  task-02:
    - contract: resolve_representative_binding
      needs: [workspace_id, user_id, provider]
goal: >
  在 placement.py _resolve_dispatch_runtime 新增 representative_fallback 旗标分支，worker target 异于 anchor 时走代表 binding 解析。
implementation:
  - _resolve_dispatch_runtime 新增 representative_fallback 形参（bool，缺省 False）
  - 分支顺序保持：本人 binding 命中直接返回
  - 新分支：本人无 binding 且 representative_fallback=True 时调 resolve_representative_binding
  - 代表 binding 无结果抛 NoOnlineDaemonError(带提示 worker failed)
  - representative_fallback=False 时维持现状 borrow 兜底链不动
acceptance:
  - 旗标开且本人无 binding 时调用 resolve_representative_binding
  - owner 在线 binding 优先命中
  - 任意在线 binding 兜底命中
  - 全部离线抛 NoOnlineDaemonError(文案明确 no_binding_for_workspace)
  - 旗标关时维持 borrow 路径不变
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_placement_representative.py -q --no-cov
constraints:
  - 本人 binding 命中优先级高于代表 binding(零回归)
  - 旗标关时完全不进入代表 binding 逻辑(维持 borrow)
  - 主 agent 派发(target=anchor)不走代表 binding(B-04 选项 a)
  - 仅 worker target 异于 anchor 时 execution 传 True

---
