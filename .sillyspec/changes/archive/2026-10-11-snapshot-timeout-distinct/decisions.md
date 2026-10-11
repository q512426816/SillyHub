---
author: flow-machine-draft
created_at: 2026-10-11T05:30:37.854Z
---
# 决策记录（Decisions）— 2026-10-11-snapshot-timeout-distinct

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-11-snapshot-timeout-distinct 留痕重锚 --> <!-- MACHINE-DRAFT:design-risks:end --> 最大风险：timeout 语义不止「进程未重启」一种（daemon 忙碌/网络劣化也超时）——文案用「若刚更新过请重启」条件句而非断言根因。放弃的方案：①daemon 自更新后自动重启进程——会中断活跃会话，留独立变更评估；②超时归入 unsupported——语义错误（unsupported=版本不支持，timeout=无响应），会把「忙」误报成「需升级」。
