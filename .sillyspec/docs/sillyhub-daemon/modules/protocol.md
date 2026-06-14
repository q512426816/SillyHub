---
schema_version: 1
doc_type: module-card
module_id: protocol
author: qinyi
created_at: 2026-06-10T16:55:00
---

# protocol

## 定位
定义 daemon 与 server 之间的 WebSocket/REST 通信常量。纯常量与类型模块，无逻辑，无状态。WS 消息类型必须与 `backend/app/modules/daemon/protocol.py` 保持同步。

## 契约摘要
- `WS_PATH` — WebSocket 路径常量（拼接在 server_url 后）
- `REST_PREFIX` — REST 端点公共前缀 `/api/daemon`
- `MSG` — 消息类型字符串集合对象（替代 Python 扁平常量）
  - Server -> Daemon：`MSG.task_available`, `MSG.heartbeat`
  - Daemon -> Server：`MSG.register`, `MSG.heartbeat_ack`, `MSG.lease_claim`, `MSG.lease_start`, `MSG.lease_complete`, `MSG.lease_messages`
  - 值统一为 `daemon:<action>` 格式
- `MsgType` — MSG 对应字面量联合类型
- `LEASE_STATE` — lease 状态字符串集合对象：pending / running / completed / failed / cancelled
- `LeaseState` — LEASE_STATE 对应字面量联合类型

## 关键逻辑
```
// 纯常量定义，无运行时逻辑
// 所有 WS 消息值以 "daemon:" 为前缀
// lease 状态值与 server 端 task state 枚举一一对应
```

## 注意事项
- 任何消息类型的增删改都必须同步修改 server 端 `backend/app/modules/daemon/protocol.py`
- 本模块被 daemon.ts 与 ws-client.ts 引用，改动后需回归 WebSocket 通信流程
- 消息类型格式为 `daemon:<action>`，添加新消息时必须保持此命名规范
- Node 版结构化为对象 + 类型，对外 WS 消息值与 Python 版完全相同（G-02 不变）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
