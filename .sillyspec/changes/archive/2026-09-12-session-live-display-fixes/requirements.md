---
author: qinyi
created_at: 2026-09-12T23:55:00
---

# 需求 — 2026-09-12-session-live-display-fixes

## FR-1 直播渲染与刷新一致（碎片气泡）

- FR-1.1 任意 segmentId 前缀形态（`main:` / `pi:msg<N>:ci<C>` / `<tool_use_id>:`）的 override 撤回令箭到达后，该 segmentId 派生的同类段（顶层或任意嵌套容器内）全部移除，无静默 no-op。
- FR-1.2 完整回复行到达时，桶内**任意位置**的「text 为完整行前缀」的流式 partial 段（segId 非空）被收编移除（不再要求 partial 处于桶尾）。
- FR-1.3 收编移除后，F7 增量投影 output 与全量重投影（segmentsToLegacy）逐字节一致。
- FR-1.4 pi 三行到达序（THINKING → ASSISTANT_OVERRIDE → ASSISTANT 全文）下，直播装配产物与历史装配产物等价（无重复/碎片段）。

## FR-2 失败卡归因准确

- FR-2.1 `extractCode` 不再从非 HTTP 上下文的裸三位数字出码（`api_calls=116, final_text=y` → code=null）。
- FR-2.2 上下文锚定出码不回归：`(429)` / `HTTP 500` / `status: 502` / `http=503` / `401 Unauthorized` / `502 Bad Gateway` 均仍出码。
- FR-2.3 `[silent stream truncation]` 签名：message/hint 覆写为「上游输出流中断」专属中文文案；type 维持关键词分类结果（零分类学变更）；code 为 null。

## FR-3 纯切换轮不再虚增

- FR-3.1 纯切换轮（config_switch 且 prompt 全空白）不落 user_input AgentRunLog、turn_count 不递增。
- FR-3.2 run 仍创建且落终态 completed；last_active_at 照刷（紧凑配置行/孤儿轮补建消费链不破坏）。
- FR-3.3 带消息切换轮与普通轮行为零回归；queue 派发的空 prompt 切换轮同被覆盖。
- FR-3.4 重复判定收口：终态分支与 user_input/turn_count 跳过共用 `silent_config_switch` 单一源（不新增第三处判定）。

## FR-4 运行中轮计时准确

- FR-4.1 活跃态轮（running / pending / pending_approval）且 runsMeta 有可解析 started_at 时，计时锚点强制取 run 快照值（窗口派生锚点/Date.now 占位不再优先）。
- FR-4.2 终态轮锚点维持现状（?? 链）；占位轮在 runsMeta 未命中时不受影响；身份稳定守卫不抖动。

## FR-5 自动续跑停止可感知

- FR-5.1 chain-limit 停跑后，该 run 的 error_detail.hint 覆写为手动接续指引文案，并加 `auto_resume_stopped: true`。
- FR-5.2 type / code / raw 原值不动（auto-recovery 判定与既有断言零影响）；未到上限路径不写标记；覆写失败仅告警不影响终态。

## 验收场景（对应用户实测）

1. pi 会话直播期间：回复单气泡完整呈现，刷新前后 DOM 等价。
2. 同会话失败卡显示「上游输出流中断」提示、无伪 code 行；链上限停跑后失败卡 hint 明确告知手动继续。
3. 同会话反复切换供应商：轮次计数不增、时间线无空消息气泡。
4. 附加观察长 run：elapsed 与真实时长一致，页面重连后不重置。
