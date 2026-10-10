---
author: flow-machine-draft
created_at: 2026-10-10T01:34:52.725Z
---
# 决策记录（Decisions）— 2026-10-10-att-ref-badge-hover

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：角标显示后指针移向角标本体——离开 span 原始矩形瞬间若命中测试失败会闪灭循环。缓解：命中矩形外扩 8px 覆盖角标外挂区（-right-1.5 -top-1 = 6px）。放弃的方案：①纯 CSS group-hover——span 被 textarea 覆盖，:hover 永不触发（可行性死路）；②给 span 开 pointer-events-auto——挡住下方 textarea 的点击/选字，违反 FR-02；③mousemove 监听 textarea——指针移到角标（sibling）后事件不再冒泡到 textarea，同样闪灭。
