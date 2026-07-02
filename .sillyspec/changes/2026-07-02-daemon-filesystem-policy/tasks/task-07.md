---
id: task-07
title: backend ws_hub.send_policy_update
author: WhaleFall
created_at: 2026-07-02T15:12:00
priority: P0
depends_on: [task-06]
blocks: [task-08]
allowed_paths:
  - backend/app/modules/daemon/ws_hub.py
  - backend/app/modules/daemon/tests/
change: 2026-07-02-daemon-filesystem-policy
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-07

> goal: ws_hub 新增 send_policy_update，复用 send_to_runtime 下行推送（D-004）。

## implementation
- `ws_hub.py` 新增 `send_policy_update(rid: str, roots: list[str], version: int)`
- 内部拼装 POLICY_UPDATE envelope，调 `send_to_runtime(rid, message)`（现有 :106）
- runtime 不在线时 best-effort（心跳兜底）

## 验收标准
- send_policy_update 发送 POLICY_UPDATE 消息到指定 runtime
- runtime 不在线不抛错（靠心跳兜底）
- 消息含 runtime_id/allowed_roots/version

## 验证
- `cd backend && uv run pytest app/modules/daemon/ -k ws_hub`

## constraints
- 复用现有 send_to_runtime，不新建连接逻辑
- 不影响其他 send_ 方法
- 离线 runtime 靠下次心跳全量同步
