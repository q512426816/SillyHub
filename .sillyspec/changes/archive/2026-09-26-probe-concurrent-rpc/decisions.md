---
author: flow-machine-draft
created_at: 2026-09-26T15:33:17.647Z
---
# 决策记录（Decisions）— 2026-09-26-probe-concurrent-rpc

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：把 3s 预算设得比真实慢链路还短——daemon 在线但公网高抖动（>3s）时探测会从「慢但有真答」变成「unknown」。权衡依据：探测是三态 UI 展示（unknown 时界面照常显示「未知」并维持现状路径，§5.D），拿不到真答的代价只是显示降级，而 30s 预算下整批探测拖分钟级的代价是用户可感的全局卡顿；且单次 stat 本地执行毫秒级，3s 已含 ~3 个数量级的网络余量。 试过但放弃：给 git_probe 结果加 TTL 缓存（比如 30s 内复用）——被 R-02「每次调用实时探测不缓存」明确否决，且缓存会让「daemon 刚下线/刚变 git 态」的展示滞后，违背探测语义，放弃。 次要风险：gather 不开 return_exceptions，若未来有 git_probe 实现抛异常，并发版会在首个异常时与其余在飞任务一起快速失败——与原串行版「首个异常中断」语义一致，不视为回归。
