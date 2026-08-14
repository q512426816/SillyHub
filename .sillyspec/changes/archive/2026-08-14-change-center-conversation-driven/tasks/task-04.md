---
id: task-04
title: backend approval notification service-identity inject to bound session
title_zh: 审批服务身份注入绑定会话
author: qinyi
created_at: 2026-08-14 15:46:49
priority: P0
depends_on: [task-02, task-03]
blocks: [task-05, task-10]
requirement_ids: [FR-05d]
decision_ids: [D-006@v2]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/schema.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/change/tests/test_approval_notify_session.py
provides:
  ReviewResponse.notified_session:
    fields: [notified_session, notify_error]
goal: >
  审批通过/打回后，由后端以服务身份向绑定会话注入审批消息（D-006@v2），绕过会话归属校验
  （_get_owned_session_for_update），使多成员工作区任意审批人都能触发；best-effort 不回滚审批，
  三类降级（turn 冲突/会话非 active/异常）语义完整。
implementation:
  - change/service.py：审批四方法（task-03 改造后）加 notify_session 逻辑：
    a) 取该 change 在 change_session_links 最新一条 link 的 session（task-02 已建）；
    b) 无绑定会话 → notified_session=false，notify_error=null（或 no_bound_session，降级由前端处理）；
    c) 有绑定 → 以服务身份调用 session 注入（复用 daemon/session/service.py 的注入能力，但以服务
    身份绕过 _get_owned_session_for_update 归属校验——若该方法强制 user 归属，则在 service 层构造
    服务上下文/跳过该校验的调用路径，或用现有后端→daemon 注入通道）；
    d) 注入消息格式：`[平台审批] 变更 <change_key> 的 <阶段> 审批已<通过/打回（decision）>。<意见>。请继续推进。`
    e) 三类降级：turn 冲突（agent 忙）→ notify_error="turn_conflict"；会话非 active → 
    notify_error="session_inactive"；其它异常 → notify_error="inject_failed"。均 best-effort，
    审批记录/状态已落库不回滚。
  - schema：审批请求体加 `notify_session: bool = true`；响应加 `notified_session: bool` /
    `notify_error: str | null`。
  - MCP submit_stage_review 契约同步在 task-05，本任务只做 HTTP 端点侧。
acceptance:
  - 审批通过/打回后，绑定会话收到注入消息（含 change_key/阶段/结果/意见）
  - 多成员场景审批人≠会话创建人仍能注入（服务身份绕过归属校验）
  - 三类降级：turn 冲突/会话非 active/异常均不回滚审批，响应带 notify_error 语义
  - 无绑定会话时不注入（notified_session=false）
  - pytest 覆盖：注入成功/三类降级/无绑定；ruff/mypy 通过
verify:
  - cd backend && uv run pytest app/modules/change -q --no-cov
  - cd backend && uv run ruff format --check app/modules/change app/modules/daemon/session && uv run ruff check app/modules/change app/modules/daemon/session && uv run mypy app/modules/change
constraints:
  - 注入必须服务身份（D-006@v2，Grill F-2 修正：前端用户身份注入受会话归属校验 403，多成员不可用）
  - best-effort 不回滚审批（R-03）
  - 消息格式固定（前端不拼接，由后端拼，见 acceptance）
  - 不动 daemon 的注入通道本身，只接服务身份调用路径
---
