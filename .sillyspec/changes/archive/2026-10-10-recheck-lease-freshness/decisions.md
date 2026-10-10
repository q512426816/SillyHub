---
author: flow-machine-draft
created_at: 2026-10-10T00:41:06.378Z
---
# 决策记录（Decisions）— 2026-10-10-recheck-lease-freshness

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：daemon 续约线程被长任务饿死超 10 分钟（宽限窗）导致健康 run 被误判死——缓解：lease 心跳在 daemon 独立定时器（task-runner 5s 间隔，与任务执行线程解耦）+ FR-02 回正兜底；极端饥饿 10 分钟本身已属病态，判死后回正比永卡合理。边界取舍：`last_heartbeat_at is None` 分支保持保守 True 不引入 lease 核验（从未心跳的实例语义模糊，patrol 同款跳过，不扩大本变更判死面）。试过但放弃：豁免轮数上限（dict 簿记 tracked→轮数）——放弃理由：按时间盲猜，对合法等用户应答的长静默轮有误杀面且需改 _recheck_deferred_runs 签名与全部既有用例；lease 续约是直接证据且零簿记。
