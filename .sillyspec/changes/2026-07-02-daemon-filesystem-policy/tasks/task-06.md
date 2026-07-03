---
id: task-06
title: backend protocol.py POLICY_UPDATE 消息
author: WhaleFall
created_at: 2026-07-02T15:12:00
priority: P0
depends_on: []
blocks: [task-07, task-08, task-13]
allowed_paths:
  - backend/app/modules/daemon/protocol.py
  - backend/app/modules/daemon/tests/
change: 2026-07-02-daemon-filesystem-policy
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-06

> goal: backend 新增 POLICY_UPDATE WS 消息类型 + payload（D-004）。

## implementation
- `protocol.py` 新增 `DaemonMessageType.POLICY_UPDATE`（或消息 type 字符串 `daemon:policy_update`）
- `PolicyUpdatePayload(BaseModel) { runtime_id: str; allowed_roots: list[str]; version: int }`
- 对齐 daemon 侧 ws-client 消息处理

## 验收标准
- POLICY_UPDATE 消息类型 + payload 定义存在
- 字段与 daemon RuntimePolicy.version 对齐
- 旧 daemon 不监听此消息→忽略（向后兼容）

## 验证
- `cd backend && uv run pytest app/modules/daemon/ -k protocol`

## constraints
- version 用于 daemon 侧去重（收旧 version 忽略，R-07）
- 不改现有协议消息
- 心跳响应仍带 allowed_roots（兜底，不变）
