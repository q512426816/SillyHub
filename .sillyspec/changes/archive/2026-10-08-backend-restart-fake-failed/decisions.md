---
author: flow-machine-draft
created_at: 2026-10-08T04:26:00.846Z
---
# 决策记录（Decisions）— 2026-10-08-backend-restart-fake-failed

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：宽限窗选小了误杀仍发生（长安静期轮被复扫判死）——但此时 FR-02 兜底回正，最坏 结果是徽标先失败后自动变回完成；窗选大了 daemon 真死时 UI 多挂一会儿"运行中"（10 分钟上 限，可接受）。放弃的方案：(a) 启动清理时探测 daemon WS 在线状态——backend 重启瞬间 daemon 往往尚未重连（实证重启后 41 秒才恢复上报），启动时点探测必假阴性，且"daemon 在线" ≠"该轮还在跑"，信号弱于日志 recency；(b) 迟到结果一律允许重放终态——会破坏既有幂等语义 （失败轮被重复 result 触发重复 auto-recover/事件），风险面大，收窄到误杀标记+成功这一种 组合。
