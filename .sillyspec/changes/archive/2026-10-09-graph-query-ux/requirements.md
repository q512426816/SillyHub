---
author: flow-machine-draft
created_at: 2026-10-09T00:59:09.043Z
---
# 需求规格（Requirements）— 2026-10-09-graph-query-ux

## 功能需求

### FR-01: neighbors/impact/path 查询执行后，若结果节点集中含锚点节点（id 精确或 CLI 模糊解析回填的 query.key/anchor），该节点自动为选中态（选中环+一跳邻域高亮+右栏切节点详情）

- 带锚点的 neighbors 查询结果到达后锚点节点必须自动选中并切详情 tab；impact/path 必须保持结果面（仅画布选中）；sub 七类型必须有人话说明（title+动态行双通道）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-02: 锚点不在结果集中时不报错不高亮（如 node_not_found 降级提示沿既有）

- 带锚点的 neighbors 查询结果到达后锚点节点必须自动选中并切详情 tab；impact/path 必须保持结果面（仅画布选中）；sub 七类型必须有人话说明（title+动态行双通道）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-03: sub 下拉每个选项悬浮（title）显示人话说明（孤儿节点=没人引用的知识条目…七条）

- 带锚点的 neighbors 查询结果到达后锚点节点必须自动选中并切详情 tab；impact/path 必须保持结果面（仅画布选中）；sub 七类型必须有人话说明（title+动态行双通道）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-04: 选中 sub 后下拉下方显示一行动态说明文案（同 tooltip 内容）

- 带锚点的 neighbors 查询结果到达后锚点节点必须自动选中并切详情 tab；impact/path 必须保持结果面（仅画布选中）；sub 七类型必须有人话说明（title+动态行双通道）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-05: 既有 16 页面用例零回归+新增用例（自动选中断言+说明文案断言）；tsc/eslint 零错

- 带锚点的 neighbors 查询结果到达后锚点节点必须自动选中并切详情 tab；impact/path 必须保持结果面（仅画布选中）；sub 七类型必须有人话说明（title+动态行双通道）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: knowledge-graph-page.test.tsx「锚点自动选中」用例（文件反查预置→详情断言）+path 预置回归守不抢结果面
FR-02: knowledge-graph-page.test.tsx「sub 人话说明」用例（sub-description testid）
FR-03: 不适用：title 悬浮与动态行同源 SUB_DESCRIPTIONS，一行断言覆盖双通道
FR-04: 不适用：FR-03 同源（同映射常量）
FR-05: knowledge 域 182 用例回归全绿（tsc/eslint 零错）
