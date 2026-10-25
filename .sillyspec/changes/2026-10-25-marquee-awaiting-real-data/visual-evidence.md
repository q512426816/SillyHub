# 视觉证据 — 2026-10-25-marquee-awaiting-real-data

## 用户需求（2026-10-25）

1. 等待模型响应的计时用页面本地掐表不真实（刷新重置）——能否用 daemon 的数据？
2. 等待期间能否显示 token 信息？

## 调研结论

- daemon→backend→SSE 已有 `tokens` 事件（执行中累积实时推送 input/output/cache/ctx/
  duration_api_ms），轮级 inputTokens/outputTokens 已实时写入 turn 状态（轮头状态条
  已在消费）——数据通道现成，无需 daemon/backend 改动。
- daemon 无专门「API 请求已发出」事件；最真实的可行等待起点 = 最后一条事件的服务端
  时间戳（日志/工具段携带）。

## 实现（纯前端）

- `TurnLiveMarquee` 新增 `lastEventAt`（服务端起点：`Date.now() - lastEventAt`，刷新/
  中途打开后等待时长继续累计不重置；缺省回退客户端起点）与 `turnTokens`（等待条目
  追加 `· ↑8,400 ↓1,250`，两值皆 null 不显示）。
- `SegmentedTurnBody` 派生 `lastEventAt = max(endedAt ?? startedAt)` 并透传 turn 的
  inputTokens/outputTokens（整页/弹窗共用路径接线一次）。
- 数值段（时长/token）挂载后渲染，SSR 首帧只渲染「等待模型响应…」骨架（水合一致）。
- 子代理卡片内嵌条不传（token 作用域是主轮）。

## 核验

- 测试：turn-live-marquee 34 用例（新增「服务端起点不重置」「token 回显与缺省不显示」）
  + turn-timeline/弹窗回归 12 用例全绿；lint 通过（并行会话在 variant/page-helpers
  留有两个存量 TS 错误，非本变更文件）。
