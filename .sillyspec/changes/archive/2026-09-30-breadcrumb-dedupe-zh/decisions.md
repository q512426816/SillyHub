---
author: flow-machine-draft
created_at: 2026-09-30T08:37:49.506Z
---
# 决策记录（Decisions）— 2026-09-30-breadcrumb-dedupe-zh

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：中文命名与用户心智不一致（如 changes 译「变更中心」而页签叫「变更」）——以侧边栏 menuLabel 为第一权威、页签 label 为工作区语境补充，两侧本来就有「变更中心/变更」粒度差，面包屑取菜单级「变更中心」与被删页内面包屑文案一致。试过放弃的方案：把动态 id 段也替换为业务名（changeKey/task_key）——需要 TopBar 拉工作区数据引入请求依赖，超出本次「去重复+中文化」范围，放弃；id 段维持现状原样显示。
