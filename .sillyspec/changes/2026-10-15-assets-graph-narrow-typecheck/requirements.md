---
author: flow-machine-draft
created_at: 2026-10-15T05:48:35.592Z
---
# 需求规格（Requirements）— 2026-10-15-assets-graph-narrow-typecheck

## 功能需求

### FR-01: 前端 pnpm exec tsc --noEmit 0 错（ci-fast-gate typecheck 可过）

- 前端工作树必须满足 `pnpm exec tsc --noEmit` 零错误（退出码 0），pre-push ci-fast-gate 的 typecheck 环节必须通过；change-assets-graph.tsx 禁止保留对联合类型裸 `"anchor" in` 收窄后的 `nodes`/`edges` 属性访问（实证：该写法对经 `env.data ?? null` 推断链产生的联合不收窄，非 neighbors 成员被保留并交叉 `Record<"anchor", unknown>`，TS2339）。

#### 场景：主路径

- Given 含 2026-10-15-change-assets-graph 交付代码的前端工作树
- When 在 frontend/ 运行 `pnpm exec tsc --noEmit`
- Then 输出零错误、退出码 0，pre-push 闸门 typecheck 环节通过

### FR-02: change-assets-graph 组件既有用例全绿，收窄语义（非 neighbors 分型/空数据隐藏分区）不变

- 守卫化收窄必须保持组件既有行为：信封 `available=false`、请求失败、节点集为空、非 neighbors 分型（data 缺 `anchor` 字段）四类情形整区静默隐藏（不显示错误卡）；既有用例必须全绿且断言零改动。

#### 场景：非 neighbors 分型降级

- Given graph query 信封 data 为 node_not_found 等缺 `anchor` 字段的降级形态
- When ChangeAssetsGraph 组件渲染
- Then 图谱分区整体隐藏，不渲染错误卡，不影响资产卡其余分组

#### 场景：neighbors 正常切片

- Given 信封 data 为含 `anchor`/`nodes`/`edges` 的 neighbors 形态且节点集非空
- When 组件渲染
- Then 画布渲染 nodes/edges，详情栏以锚点节点兜底选中

### FR-03: 守卫落在 knowledge.ts 紧邻 getKnowledgeGraphQuery，带中文注释说明为何不用裸 in 收窄

- frontend/src/lib/knowledge.ts 必须新增并导出类型守卫 `isGraphNeighborsData(d: GraphQueryOut["data"]): d is GraphNeighborsData`，定义位置必须紧邻 `getKnowledgeGraphQuery`，且必须带中文注释说明「裸 `in` 收窄对 `?? null` 推断链联合失效」的实证背景；调用方 change-assets-graph.tsx 必须改用该守卫收窄。

#### 场景：主路径

- Given knowledge.ts 模块源码
- When 查看导出面与定义位置
- Then `isGraphNeighborsData` 以类型谓词签名存在、紧邻 `getKnowledgeGraphQuery`、注释含实证背景说明

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：编译面闸门（ci-fast-gate typecheck×2）非单用例面，flow done 测试对账亲测留痕
FR-02: frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx「全文件既有用例回归」
FR-03: frontend/src/lib/__tests__/knowledge-graph-guard.test.ts「守卫三分型：neighbors 通过/缺 anchor 降级形态拒绝/null 拒绝」
