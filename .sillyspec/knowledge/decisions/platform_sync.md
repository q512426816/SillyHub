# 决策知识 — platform_sync

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-003@v1 : 实现方案——daemon 自发现 + 日志 tail 推导 + 第一方事件汇聚（方案 1）
状态：implemented
变更：2026-09-07-agent-liveness-states
锚点：未记录
最近确认：e76e191d9
理由：方案 1。唯一同时满足"全托管会话有状态灯（含 zcode 非托管登记）"与"blocked 确定性"的路线，CLI 契约零变更零回归（草案 D-005），五层既有地基全复用；代价是 daemon 侧工作量最大，由 P1a 先行消化。方案 2 违反"CLI 非执行体"既定定位且覆盖不了登记盲区；方案 3 放弃 zcode/裸会话覆盖，G-1 达不成

## D-004@v1 : 状态展示两层——会话列表小灯+悬浮卡，完整总览放工作台
状态：implemented
变更：2026-09-07-agent-liveness-states
锚点：未记录
最近确认：e76e191d9
理由：A。会话列表每行行尾只加 ~18px 状态小灯（五态色+呼吸闪烁，不新增列不改布局），悬停弹详情小卡（静默时长/关联 ctx/证据摘要）；完整「Agent 状态总览」卡片（分组计数+等人跳转）放工作台首页。用户原话背景：会话列表没那么大空间展示这些信息

## D-009@v1
状态：rejected
变更：2026-09-11-agent-log-attribution-refactor
锚点：未记录
最近确认：353eb11b0
理由：否——用户明确「不应该限制 agent 类型」，跨 harness 同变更挂接是需求而非缺陷
否决理由：与「同变更就挂」需求直接冲突
复潮条件：未来出现同变更跨 harness 归属仍需区分展示的需求

## D-010@v1
状态：rejected
变更：2026-09-11-agent-log-attribution-refactor
锚点：未记录
最近确认：353eb11b0
理由：否——首次错标仍会发生、subagent 归属仍靠 cwd 猜，治标不治本
否决理由：治标；不满足 FR-01
复潮条件：锚定方案在某个 harness 上不可实施时的局部回退

## D-011@v1
状态：rejected
变更：2026-09-11-agent-log-attribution-refactor
锚点：未记录
最近确认：353eb11b0
理由：否——动表结构与 D-005 冲突；现有 change/quicklog links 表已能表达「会话↔ctx」登记
否决理由：违反已确认的「不动表结构」决策；现有 links 表能力足够
复潮条件：ctx owner 解析出现性能问题或需要显式管理界面
