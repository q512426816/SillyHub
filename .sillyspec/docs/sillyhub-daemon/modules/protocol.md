---
schema_version: 1
doc_type: module-card
module_id: protocol
author: qinyi
created_at: 2026-06-10T16:55:00
---

# protocol

## 定位
定义 daemon 与 server 之间的 WebSocket 消息类型常量和任务状态常量。纯常量模块，无逻辑，无状态。必须与 `backend/app/modules/daemon/protocol.py` 保持同步。

## 契约摘要
- **Server -> Daemon 消息类型**：`MSG_TASK_AVAILABLE`, `MSG_HEARTBEAT`
- **Daemon -> Server 消息类型**：`MSG_REGISTER`, `MSG_HEARTBEAT_ACK`, `MSG_LEASE_CLAIM`, `MSG_LEASE_START`, `MSG_LEASE_COMPLETE`, `MSG_LEASE_MESSAGES`
- **任务状态**：`STATE_PENDING`, `STATE_RUNNING`, `STATE_COMPLETED`, `STATE_FAILED`, `STATE_CANCELLED`

## 关键逻辑
```
# 纯常量定义，无逻辑
# 所有值以 "daemon:" 为前缀的消息类型
# 状态值与 server 端 task state 枚举一一对应
```

## 注意事项
- 任何消息类型的增删改都必须同步修改 server 端 `backend/app/modules/daemon/protocol.py`
- 本模块被 daemon.py 直接引用，改动后需回归 WebSocket 通信流程
- 消息类型格式为 `daemon:<action>`，添加新消息时必须保持此命名规范

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
