---
author: flow-machine-draft
created_at: 2026-10-15T03:40:08.077Z
---
# 决策记录（Decisions）— 2026-10-15-change-assets-graph

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- 风险一：在途变更（未注册图节点）neighbors 查询锚点未命中——可能形态为 available=false 或 data.nodes 空；双态都收敛到「整区隐藏」，实测时用归档变更核对。缓解：空 nodes 与 unavailable 同走隐藏分支，不出现半渲染。 - 风险二：资产卡测试既有 fixture 未 mock getKnowledgeGraphQuery——jsdom fetch 报错 → react-query error → 隐藏，既有用例不受扰；显式在新组件测试中 mock 全两态（可用/不可用）。 - 试过放弃：①把图谱分区做成弹窗（点「查看图谱」再开 Dialog）——用户原话是「图放卡片中」，弹窗多一步且复刻了被用户否掉的「点了看不到东西」反模式；②复用图谱页整页三栏（左表单/右结果 tab）——资产卡内只需要画布+节点详情两块，表单/图例属图谱页职责，嵌入会撑爆卡片。
