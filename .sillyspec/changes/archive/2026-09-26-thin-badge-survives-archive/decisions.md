---
author: flow-machine-draft
created_at: 2026-09-26T13:56:10.915Z
---
# 决策记录（Decisions）— 2026-09-26-thin-badge-survives-archive

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：时间窗边界误判——若数据库存在 created_at 异常（时钟漂移/手工导入）的边界数据，可能误标/漏标出身；误标代价仅是多显示一个徽章（低危展示层），且 thin 分流上线后 quick 类型不再新增，窗口语义单调。试过但放弃：①镜像 flow-state.yaml tier==thin 精确投影——需后端详情读侧加文件系统读取，读放大不成比例；②列表页徽章同改——列表行徽章走 ChangeStepBadge（另一组件），用户诉求在详情页标题，列表另行跟进不夹带。
