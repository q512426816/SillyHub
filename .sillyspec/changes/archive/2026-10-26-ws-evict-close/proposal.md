---
author: flow-machine-draft
created_at: 2026-10-26T14:58:48.944Z
---
# 提案书（Proposal）— 2026-10-26-ws-evict-close

## 动机

任务原话转写：修复WS逐出不关socket致daemon假活不重连

动机与背景：2026-10-26 晚生产事故实证——backend ws_hub send 超时/异常时 _evict_stale 仅从路由表移除连接、不关闭 socket，daemon 侧 TCP 连接仍在、ping/pong 正常，永不触发重连；backend 路由表查无此 daemon，后续所有 session_inject 推送失败，15 分钟内两个会话 5 轮消息全部判死（interactive_inject_send_failed），直到 backend 容器重建才恢复。

成功标准：
- send 超时逐出与异常逐出路径均对旧 socket 主动 close（code=4000），daemon 侧可感知断线并重连
- 逐出 close 仅作用于被逐出的旧连接对象，不误伤并发重连的新连接（对象身份校验）
- 现有 ws_hub 相关测试全绿

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. send 超时逐出与异常逐出路径均对旧 socket 主动 close（code=4000），daemon 侧可感知断线并重连
2. 逐出 close 仅作用于被逐出的旧连接对象，不误伤并发重连的新连接（对象身份校验）
3. 现有 ws_hub 相关测试全绿

## 成功标准（可验证）

1. send 超时逐出与异常逐出路径均对旧 socket 主动 close（code=4000），daemon 侧可感知断线并重连
2. 逐出 close 仅作用于被逐出的旧连接对象，不误伤并发重连的新连接（对象身份校验）
3. 现有 ws_hub 相关测试全绿
