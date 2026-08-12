---
id: task-04
title: build_claim_payload init 分支注入明文 token
title_zh: context build_claim_payload 的 mode init 分支 claim 时调两 get_or_issue 拿明文注入 payload platform_config local_yaml 不落 lease metadata
author: qinyi
created_at: 2026-08-12 10:34:01
priority: P0
depends_on: [task-01, task-02]
blocks: [task-06, task-10]
requirement_ids: [FR-01, FR-03]
decision_ids: [D-002]
allowed_paths:
  - backend/app/modules/daemon/lease/context.py
provides:
  - contract: claim payload platform_config local_yaml
    fields: [platform_token 与 mcp_token 两明文]
expects_from:
  task-01:
    - contract: PlatformSyncTokenService.get_or_issue
      needs: [返回明文 plaintext]
  task-02:
    - contract: McpTokenService.get_or_issue
      needs: [返回明文 plaintext]
goal: >
  在 backend/app/modules/daemon/lease/context.py build_claim_payload mode init 分支 579 行 claim 时从 lease_meta 解析 actor_user_id 与 workspace_id 调两 get_or_issue 拿明文注入 payload platform_config local_yaml 等于 platform_token 与 mcp_token B1 明文只进 payload 内存绝不写 lease metadata 覆盖 FR-01 FR-03 与 D-002 为 task-06 daemon 写盘提供 token 来源。
implementation:
  - 在 context.py 579 mode init 分支顶部解析 actor_user_id 从 lease_meta get 用 uuid.UUID 转 同 _init_ws 既有 try except 风格 ws_id 复用本分支已解析的 _init_ws 582 592
  - 引入 PlatformSyncTokenService 与 McpTokenService 与 get_settings 构造 settings 等于 get_settings 两 service 均传 session 与 settings 必填对齐 design 7.1
  - 调两条 await get_or_issue workspace_id 等于 ws_id created_by 等于 actor_user_id 各取明文 row 丢弃 B1 只用明文注入 payload
  - 在既有 _init_pc 透传 599 602 之后给 payload platform_config 追加 local_yaml 键 等于 platform_token shpsync 明文 与 mcp_token shmcp 明文 保留原 server_origin 与 strategy 不整体覆盖 可选双写 camelCase platformConfig local_yaml 对齐既有惯例
  - 全程不动 lease metadata 明文仅活局部变量与 payload dict 与 HTTP 响应体 actor 缺失或非法时回退 None 不签 token 不注入 local_yaml 防御降级不抛 500
acceptance:
  - build_claim_payload init 分支被调时两 service 各被 get_or_issue ws_id actor 调一次 mock 断言 call_count
  - 返回 payload platform_config local_yaml 等于 platform_token 与 mcp_token 两明文 前缀 shpsync 与 shmcp 正确
  - claim 后 DB 查 daemon_task_leases metadata 无 platform_token mcp_token local_yaml 键 lease metadata 内存对象同样不含 守 P0 D-002
  - actor_user_id 从 lease_meta 解析为 get_or_issue 的 created_by 缺失时不签不注入降级
  - 原 _init_pc server_origin strategy 透传行为零回归 spec_version 保鲜链路不破
verify:
  - cd backend && uv run pytest app/modules/daemon -q --no-cov
constraints:
  - 明文绝不落 lease metadata 因 daemon_task_leases metadata 是持久化 JSON 且被 audit service py 74 读取 明文只在 claim payload 内存 对齐 P0 B1 design 5.3 9
  - 不改 dispatch 阶段行为 task-05 管 本任务只动 claim 端 build_claim_payload 不碰 start_init_dispatch
  - 两 service 构造器必填 settings 用 get_settings 注入 不裸 Service session 对齐 design 7.1
  - 消费 task-01 02 的明文返回契约 两 get_or_issue 返回 tuple row 与明文 本任务只用明文 row 丢弃
  - url 不下发 local_yaml 子结构只含两 token url 由 daemon _serverOrigin 拼 对齐 D-002
---
