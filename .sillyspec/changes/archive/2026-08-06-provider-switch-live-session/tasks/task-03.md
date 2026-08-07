---
id: task-03
title: set_default and unset_default refactor (probe, notify push, rollback on failure)
title_zh: set_default 与 unset_default 改造（探测加触发推送加失败回滚）
author: WhaleFall
created_at: "2026-08-06 16:40:41"
priority: P0
depends_on: [task-01, task-02, task-04]
blocks: [task-05]
requirement_ids: [FR-01, FR-02, FR-08]
decision_ids: [D-001, D-003, D-004]
allowed_paths:
  - backend/app/modules/llm_provider/service.py
  - backend/app/modules/llm_provider/tests/test_llm_provider.py
goal: >
  set_default 改造为切换前先凭证探测失败则回滚不推送，成功后触发 notify_provider_switch；
  unset_default 触发推送 provider_config 为 null（回退本机）。
implementation:
  - set_default 先调 task-01 probe_provider 凭证探测，失败则不改 is_default 并返回 error
  - 成功则 _clear_sibling_defaults 清同组默认并置本行 True
  - 调用 task-04 notify_provider_switch 触发热切换（启动传 resolve_default_provider_config 构造的 config）
  - set_default 返回 affected_sessions 计数（来自 notify 返回值）
  - unset_default 置本行 False 并调 notify_provider_switch 传 provider_config 为 null
  - notify 调用失败仅日志告警不阻塞 set 成功
  - 适配现有 test_llm_provider.py 的 set/unset_default 测试：patch probe_provider 返回 ok + patch notify_provider_switch 避免真实推送，确保现有测试 pass
acceptance:
  - set 凭证失败时 is_default 不变且不推送
  - set 成功推送新 provider_config 并返回计数
  - unset 推送 provider_config 为 null 并返回计数
  - 现有 test_llm_provider.py 全部 pass（probe/notify 已 mock）
verify:
  - cd backend && uv run --extra dev pytest app/modules/llm_provider/tests/
constraints:
  - 回滚事务原子
  - notify 失败不阻塞 set 成功（日志告警）
  - brownfield 未切换供应商时行为与现状逐字一致
  - 跨 agent_kind 推送过滤由 task-04 负责（当前 task-04 未过滤，留 verify 阶段补，task-03 按 task-04 现状调用）
expects_from:
  task-01:
    - contract: ProviderProbeResult
      needs: [ok, error]
  task-04:
    - contract: notify_provider_switch
      needs: [函数]
---
