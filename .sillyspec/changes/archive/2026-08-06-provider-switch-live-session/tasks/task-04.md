---
id: task-04
title: notify_provider_switch 按 daemon 分组推送热切换
title_zh: 通知运行中会话热切换供应商
author: WhaleFall
created_at: "2026-08-06 16:40:41"
priority: P0
depends_on:
  - task-02
  - task-03
blocks: []
requirement_ids:
  - FR-03
decision_ids:
  - D-001
  - D-005
allowed_paths:
  - backend/app/modules/daemon/lease/provider_switch.py
goal: 新增 notify_provider_switch 查询目标用户 active interactive session 按 daemon_id 分组经 ws_hub.send_session_control 推送 PROVIDER_CONFIG_CHANGED 启动携带新 provider_config 停止传 null 并返回受影响会话计数
implementation:
  - 新建 backend/app/modules/daemon/lease/provider_switch.py 落地 notify_provider_switch,若读代码后判断更适合复用现有 lease 流程则并入 lease_service.py 并在此注明最终落点
  - 查 agent_sessions WHERE user_id 等于目标用户 AND status 在 active 与 reconnecting 之内,join DaemonTaskLease 经 lease_id 关联并过滤 lease.kind 等于 interactive
  - 每个 session 调 _resolve_daemon_id_for_runtime 把 runtime_id 解析为 daemon_id,解析为 None 则跳过并告警,再按 daemon_id 聚合每个 daemon 仅一次调 ws_hub.send_session_control 推送 MSG.PROVIDER_CONFIG_CHANGED
  - payload 含 session_id 与 provider_config,启动场景用 task-02 的 resolve_default_provider_config 构造新 config,停止场景 provider_config 传 null,返回 affected session 计数无 active session 时返回 0
acceptance:
  - 有 active session 分布多 daemon 时按 daemon_id 各推一次启动 payload provider_config 为新 config 停止为 null,无 session 时推送 0 次 no-op 不抛异常返回 0
  - 单个 daemon 离线 send_session_control 返回 False 不影响其余 daemon 推送,WS 失败 best-effort 参考 _send_interactive_cancel 模板只告警不阻塞
verify:
  - cd backend 后运行 pytest app/modules/daemon/lease/tests/test_provider_switch.py
constraints:
  - status 过滤仅取 active 与 reconnecting 两值 Grill 已确认枚举不含 ended/failed/pending
  - 无 active session 时 no-op 严格守 brownfield 零回归
  - 复用 _resolve_daemon_id_for_runtime 与 send_session_control 不新加 ws_hub 方法守 D-005,按 daemon_id 分组聚合推送避免同 daemon 多次往返应对 R-02
expects_from:
  task-02:
    - contract: MSG.PROVIDER_CONFIG_CHANGED
      needs: [消息常量]
    - contract: resolve_default_provider_config
      needs: [helper 函数]
---
