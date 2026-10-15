---
author: flow-machine-draft
created_at: 2026-10-15T05:57:25.723Z
---
# 决策记录（Decisions）— 2026-10-15-assets-graph-narrow-typecheck

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：未来 TS 升级改变 `in` 收窄行为，使守卫显得冗余——守卫语义自包含（谓词显式声明判定结果），行为不随编译器版本漂移，可接受且可随时简化。已试并放弃的方案：① 探断链污点用标注洗净（`const dataA2: GraphQueryOut["data"] = dataA`）——探针实测仍 TS2339，推断链污点标注洗不掉；② 组件内 `as GraphNeighborsData` 断言——绕过判型丢类型安全，违反仓库禁手写类型精神；③ 把组件收窄重构成 page.tsx 同款参数化路径——扩大爆炸半径，page.tsx 现路径编译健康，不动。
