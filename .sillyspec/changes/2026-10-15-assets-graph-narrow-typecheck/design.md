---
author: flow-machine-draft
created_at: 2026-10-15T05:48:35.592Z
---
# 设计记录（Design Record）— 2026-10-15-assets-graph-narrow-typecheck

## 做法概述

问题实证（探针法钉死）：`"anchor" in data` 联合收窄在 data 类型经 `env?.available ? env.data ?? null : null` 推断链产生时失效——TS 5.5.4 把非 neighbors 成员保留在真值分支并交叉 `Record<"anchor", unknown>`，导致 change-assets-graph.tsx 对 `data.nodes`/`data.edges` 的访问报 TS2339（pre-push ci-fast-gate 首次拦下；同文件同模式的图谱页 page.tsx 因 data 走 `GraphQueryOut["data"]` 参数标注路径而幸免）。与其依赖 `in` 收窄行为怪癖，改为显式类型谓词守卫：knowledge.ts 新增 `isGraphNeighborsData`，change-assets-graph.tsx 改用守卫收窄——谓词收窄不依赖 `in` 语义，行为判定面（`!!d && "anchor" in d`）与原写法等价，组件运行时语义零变化。

## 接口契约

新增导出：frontend/src/lib/knowledge.ts `isGraphNeighborsData(d: GraphQueryOut["data"]): d is GraphNeighborsData`——纯类型谓词函数，运行时实现即 `!!d && "anchor" in d`。改动调用方：frontend/src/components/changes/detail/change-assets-graph.tsx 第 58-61 行收窄写法替换为守卫调用。端点/存储/组件对外 props 签名均无变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：不适用——纯类型面 + 同步纯函数判型，无事件流/时序语义。
2. 并发写：不适用——守卫只读判型无共享可变状态；组件侧查询参数（retry:false 等）原样未动。
3. 切换/生命周期：不适用——不引入新副作用与新状态；信封 null/undefined 在守卫内先行短路。
4. 作用域：守卫按信封 data 形状判型，不含 workspace 维度输入，无跨工作区串台面。

## 风险与死路

最大风险：未来 TS 升级改变 `in` 收窄行为，使守卫显得冗余——守卫语义自包含（谓词显式声明判定结果），行为不随编译器版本漂移，可接受且可随时简化。已试并放弃的方案：① 探断链污点用标注洗净（`const dataA2: GraphQueryOut["data"] = dataA`）——探针实测仍 TS2339，推断链污点标注洗不掉；② 组件内 `as GraphNeighborsData` 断言——绕过判型丢类型安全，违反仓库禁手写类型精神；③ 把组件收窄重构成 page.tsx 同款参数化路径——扩大爆炸半径，page.tsx 现路径编译健康，不动。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 改 | frontend/src/lib/knowledge.ts | 新增 isGraphNeighborsData 类型守卫导出（紧邻 getKnowledgeGraphQuery，含实证背景注释） |
| 改 | frontend/src/components/changes/detail/change-assets-graph.tsx | 收窄改用 isGraphNeighborsData，删裸 in 三元写法 |
| 增 | frontend/src/lib/__tests__/knowledge-graph-guard.test.ts | 守卫三分型用例（neighbors 通过/缺 anchor 拒绝/null 拒绝） |
