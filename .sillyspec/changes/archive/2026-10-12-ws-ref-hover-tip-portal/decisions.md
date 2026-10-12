---
author: flow-machine-draft
created_at: 2026-10-12T03:26:09.381Z
---
# 决策记录（Decisions）— 2026-10-12-ws-ref-hover-tip-portal

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：风险：body 直挂元素的测试断言路径变化——已同步改 document.querySelector 并隔离用例（unmount 后断言）。放弃的方案：向上排查移除页面祖先的 transform（根在布局容器/动画库，影响面大且布局再变会复发）；portal 是标准免疫方案。
