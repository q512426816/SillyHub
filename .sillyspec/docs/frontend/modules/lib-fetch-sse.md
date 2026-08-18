---
schema_version: 1
doc_type: module-card
module_id: lib-fetch-sse
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 通用 SSE 解析层（lib-fetch-sse）

## 定位
用 fetch + ReadableStream 订阅 `text/event-stream` 的 EventSource 替代品（零依赖的通用 SSE 解析层）。**存在的唯一理由**：浏览器 EventSource 无法自定义请求头，token 只能拼进 URL query 而 query 会被访问日志原样记录（等于 JWT 明文进日志）；本模块把 token 放 `Authorization: Bearer` header（backend auth 已 header-only）。接口形状刻意贴近 EventSource（onopen/onmessage/onerror/addEventListener/readyState/close），调用点从 EventSource 迁移时回调逻辑可逐字保留。当前两个调用方：`lib-daemon` 的 `streamSession`、`components-permissions` 的 session-permission-panel。

## 契约摘要
- `fetchSse(url, options?): FetchSseConnection` — 建立 SSE 连接。`FetchSseOptions`：`token`（空串/undefined 不发 Authorization）、`headers`（额外请求头，勿重复传 Authorization）、`signal`（外部 abort，组件卸载断流）。
- `FetchSseConnection`：`onmessage`（默认 data 帧）、`onopen`（fetch resolve 且 response.ok 即触发——backend 只发 `:` 心跳注释时 onmessage 永不触发，connected 状态只能靠它翻转）、`onerror({status?})`（网络错误/非 2xx/流中断/**流正常结束**；触发后 readyState=2，不重连）、`readyState`（0 CONNECTING / 1 OPEN / 2 CLOSED）、`addEventListener(type, listener)`（命名事件，返回解绑函数）、`close()`（abort 底层 fetch，幂等）。
- `parseSseChunk(chunk): { frames: ParsedFrame[]; rest: string }` — 解析一段空行分帧的 SSE 文本；导出供单测复用。
- `FetchSseEvent`：`{ data, lastEventId }`（多行 data 以 `\n` 连接，对齐规范）。

## 关键逻辑
```
读循环: buffer += decoder.decode(chunk, {stream:true})
        按 \n\n（容忍 \r\n\r\n）切出完整段 → parseSseChunk → 逐帧 dispatchFrame
parseSseChunk: 空行=分帧边界派发积攒 data；":" 前缀=注释/心跳忽略；
        data 多行 \n join；event/id 记录；retry/未知字段忽略；
        尾部未闭合半行 rest 返回，拼接进下次 chunk（不丢跨 chunk 断行的帧）
dispatchFrame: 无 data 行的帧不派发；frame.event=="" → onmessage，否则命名监听器
```

## 注意事项
- **无自动重连**（有意取舍）：Last-Event-ID 重连语义不实现；需要重连的调用方在 onerror 里自建连接重建 / 查询兜底。helper 在流结束或出错时只报 onerror 一次并置 CLOSED。
- **流正常结束（backend 关闭 SSE）也走 onerror**——对齐 EventSource 对服务端断开同样报 error 的行为，调用方按现有 onerror 容忍逻辑处理。
- 外部 `signal` abort 视为调用方主动终止：直接置 CLOSED 且**不报 onerror**（对齐主动 close()）；close() 先于响应到达也安全（isClosed 守卫）。
- `state` 在多处闭包被改，TS 控制流窄化不跨闭包共享——统一走 `snapshotState()` 读取，避免 2367 假报；勿改回直接比较。
- fetch 必须带 `cache: "no-store"`（EventSource 实现同样 no-store），勿删。
- 单测在 `lib/__tests__/fetch-sse.test.ts`（parseSseChunk 帧解析是主要测试面，导出即为此）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
