---
author: qinyi
created_at: 2026-08-24 07:58:12
id: task-05
title: 前端订阅客户端 subscribeAgentSessionsEvents
title_zh: 前端订阅客户端 subscribeAgentSessionsEvents
goal: 提供会话列表信号订阅函数：fetchSse 传输 + 自实现退避重连 + onEvent/onReconnected 回调契约，供门户接线。
depends_on: []
provides:
  - contract: frontend-subscription
    fields:
      - subscribeAgentSessionsEvents(opts: { onEvent: () => void; onReconnected?: () => void }): { close: () => void }
      - 行为契约：收到任一 data 帧（JSON 信号）→ onEvent()；连接出错退避重连（对齐 streamSession 的 RECONNECT_BACKOFF_MS 档位）；重连成功后触发一次 onReconnected()（仅断开过才调）；close() 幂等关连接与定时器
expects_from: []
allowed_paths:
  - frontend/src/lib/daemon.ts
  - frontend/src/lib/daemon.test.ts
implementation:
  - daemon.ts 追加（放在 streamSession 附近的 SSE 区段）：
    - export function subscribeAgentSessionsEvents(opts): { close }
    - URL：apiUrl("/api/daemon/sessions/events")——与 streamSession 同源的 URL 拼装方式（看 streamSession 现有实现取同款）
    - fetchSse(url, { token })：token 每次重连现取 useSession.getState().accessToken（对齐 streamSession wireConnection）
    - 重连骨架抄 streamSession（daemon.ts wireConnection/scheduleReconnect 收敛版）：es.onmessage → retryCount=0、若此前断开过则 onReconnected?.()（先于 onEvent 或合并触发一次 onEvent 均可，卡片验收以「重连后两回调都有机会触发」为准）；es.onerror → scheduleReconnect
    - RECONNECT_BACKOFF_MS 说明：该常量现是 streamSession 内局部 const（daemon.ts:916）——本卡允许将其提升为模块级导出 const（一行最小改动 + 原地引用，不改 streamSession 行为），订阅函数复用该导出；不得复制一份常量表
    - close()：closed 标志 + es.close() + 清 reconnectTimer
  - 测试 daemon.test.ts 追加（该文件已存在则追加 describe；不存在则新建并核对既有测试布局——先 grep frontend/src/lib/ 下 daemon 相关测试文件名）：
    - mock fetchSse 捕获 handlers → 喂 data 帧 → onEvent 被调
    - 触发 onerror → 退避定时器排程（fake timers）→ 重连后 onReconnected 被调
    - close() 后不再重连
acceptance:
  - 信号帧触发 onEvent；断线退避重连并触发 onReconnected；close 幂等终止
  - 新增测试全绿
verify:
  - pnpm -C frontend exec vitest run src/lib/daemon.test.ts（或实际测试文件名）
constraints:
  - fetchSse 本身不含自动重连（fetch-sse.ts:14-20）——退避逻辑必须在本函数内实现，勿假设传输层重连
  - RECONNECT_BACKOFF_MS 提升为模块级导出是唯一允许触碰 streamSession 的改动（声明上移，原行为零变化）；其余 streamSession 代码不动

---
