---
author: flow-machine-draft
created_at: 2026-10-26T15:08:17.166Z
---
# 决策记录（Decisions）— 2026-10-26-ws-evict-close

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险是 `close` 的 await 在 socket 极端僵死时理论上可悬挂——但 Starlette 的 close 仅向 ASGI 协议层投递 close 消息（不走网络层关闭握手），uvicorn 侧对死 transport 的投递立即返回或抛错，与同文件 `connect()` 替换路径 `await existing.close(code=4000, ...)` 的既有先例风险面完全一致（该先例运行至今无事故），故不加超时、保持同款写法。已试放弃的方案：daemon 侧「HTTP 心跳正常但 WS 长期无下行 → 主动重连」看门狗——协议改动大、需 daemon 发版铺开才生效，且 backend 单侧修复到位后该缺陷类不再产生，留作后续纵深防御候选（另立变更）。
