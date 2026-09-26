---
author: flow-machine-draft
created_at: 2026-09-26T06:04:26.691Z
---
# 决策记录（Decisions）— 2026-09-26-change-detail-restore-assets

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：恢复的挂载再次被并行会话夹带覆盖（本次事故根因即此）。缓解：新增页面级钉子测试断言资产卡与观测事件卡并存，下次任何提交删挂载会被聚焦测试拦下（CI 层面）。试过但放弃：把 aside 卡片清单抽成数组配置防漏挂——放弃，卡片间挂载条件与注释各不相同（quicklog 卡需 change_key、对账卡带 archived 语义），抽象后反而丢语义，收益不成比例。线上已部署旧镜像的窗口期：需重新部署前端镜像才能让用户看到恢复，代码层无风险。
