# 决策知识 — api-types

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-09-daemon-api-types-regen
锚点：未记录
最近确认：7bb24ca69504433c6dafc0230047ffaadefd903a
理由：最大风险：大 diff（5625+/1591-）可能携带生成器版本差异噪音（openapi-typescript 7.13.0 与上次生成版本的输出形态差）——已由 daemon tsc 0 error 消解编译面疑虑；类型联合收缩理论上可能破坏穷举 switch，但 grep 实证 daemon 源码零处按值消费被删键。试过放弃：(a) 手改 Permission 联合一处——放弃，其余多轮落后面仍在且手改生成物必漂移；(b) 顺带把 gen:types:check 接进 CI workflow——放弃，超出本变更（审查风险收口）范围，留作后续建议。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-09-daemon-ci-types-gate
锚点：未记录
最近确认：58cf516f41f5a4a03bcdd85b8f52dca555bdbb4f
理由：最大风险：drift check 在 CI 上重生成时 openapi-typescript 版本与本地不一致会导致输出形态差误红——已由 frozen-lockfile（Install --frozen-lockfile）钉住同版本消解；本地实测同命令绿态通过。次风险：路径增补后 backend 独改也会触发 daemon-ci 全量测试，CI 时长略增（分钟级，可接受）。试过放弃：(a) 单独开一个轻量 drift workflow——放弃，daemon-ci 已有 Node/pnpm 环境，复用零成本；(b) 在 frontend-ci 里顺带守 daemon 类型——放弃，职责域错位（daemon 生成物归 daemon-ci）。
