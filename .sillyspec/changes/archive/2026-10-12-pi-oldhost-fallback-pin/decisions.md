---
author: flow-machine-draft
created_at: 2026-10-12T01:14:59.129Z
---
# 决策记录（Decisions）— 2026-10-12-pi-oldhost-fallback-pin

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：- 风险：披露注释与实现漂移（规则 18 万恶之源）——缓解：披露文本与钉子用例同变更落盘，用例红即披露失真，可被常规回归捕获。 - 放弃方案 A：立即代报门改为读运行时注入结果（driver 上报「MCP 未注入」信号）——可省旧版 pi 宿主 90s 延迟，但需 driver→daemon 新增状态通道，复杂度与收益不成比例（mission 本为长耗时流程），且延迟探测已是 claude 未自报形态的既定安全网，双通道徒增双写回归面。 - 放弃方案 B：caps 表按宿主版本参数化——静态表承载运行时事实会破坏「caps 描述机制支持」的既有语义（FR-06 两层门控分工），且 daemon 启动时无法预知所有会话宿主版本。
