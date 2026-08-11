---
id: task-08
title: inject_session 等 readiness.wait
title_zh: inject 发送前等待 session ready
author: WhaleFall
created_at: 2026-08-07 14:32:00
priority: P0
depends_on: [task-05]
blocks: [task-12]
requirement_ids: [FR-03]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
expects_from:
  task-05:
    - contract: SessionReadiness
      needs:
        - wait
goal: >
  inject_session 在 commit AgentRun 之后 send SESSION_INJECT 之前阻塞等 daemon session
  ready，确保 inject 不在 daemon create 完成前到而被静默丢弃（/model 空白根因）。已 ready
  立即返回零开销，超时 30s 未 ready 则 fallback 仍发 SESSION_INJECT 加 warn，兼容不上报
  ready 的旧 daemon（D-003）。
implementation:
  - 定位注入点，inject_session（service.py 592）中 refresh run（约 665 行 commit AgentRun 块尾）之后、Dispatch the new turn control message 注释（约 673 行）之前，即 commit 与 send 之间
  - 插入阻塞等待，调 task-05 SessionReadiness 单例的 wait 传 session_id 与 30，接收布尔返回值（True 已 ready，False 超时），访问入口与 task-05 单例访问器一致
  - 已 ready 则 wait 立即返 True，零开销直通，继续原 send 路径
  - 超时 30s 未 ready 则不抛错不 return，落 warn 日志（如 session_ready_timeout 带 session_id），fallback 仍执行原 send SESSION_INJECT 分支兼容旧 daemon（D-003 与 R-02）
  - 不改 send_session_control 本身与 control_ok 收敛逻辑（boundary 13 保持），仅 send 前加 wait 与超时 warn 分支
acceptance:
  - wait 调用位置在 commit AgentRun 之后 send SESSION_INJECT 之前
  - 已 ready 时零开销直通（event 已 set，wait 立即返 True）
  - 超时 30s 未 ready 不抛错，fallback 仍发 SESSION_INJECT 加 warn 日志
  - inject 等待不阻塞超过 30s（asyncio.wait_for 兜底）
  - 新增单测过（已 ready 直通与超时 fallback 仍发，task-12 覆盖）
verify:
  - cd backend && ruff check app/modules/daemon/session/service.py
  - cd backend && python -m pytest
constraints:
  - 超时必须 fallback 发不抛错，兼容旧 daemon 不上报 ready（R-02）
  - 已 ready 必须零开销（event 已 set 立即返）
  - wait 位置严格 commit 后 send 前，不得颠倒或漏掉 commit 与 send
  - wait 阻塞上限 30s，不得无限等待（D-003）
  - 不改 send_session_control 与 control_ok 收敛，保持 boundary 13
---
