---
author: flow-machine-draft
created_at: 2026-10-15T09:22:53.271Z
---
# 需求规格（Requirements）— 2026-10-15-assets-graph-depth

## 功能需求

### FR-01: 图谱分区卡头新增层级选择器（1跳/2跳/3跳 三档 chips），默认 1 跳；点击切换按所选深度重新发起 neighbors 查询（depth 参数进 query key，getKnowledgeGraphQuery 既有 depth 参数直通，零后端改动）；

- ChangeAssetsGraph 卡头必须渲染「层级」三档切换 chips（1跳/2跳/3跳，aria-pressed 标注激活档），默认激活 1 跳；点击某档必须以该深度重新发起 getKnowledgeGraphQuery(workspaceId,"neighbors",{anchor:changeKey,depth})（depth 必须进 query key 区分缓存）；标题文案「本变更一跳邻域」必须改为「本变更邻域」（深度可变后「一跳」失真）。

#### 场景：切换深度重查询

- Given 分区已按 1 跳渲染；When 点击「2跳」chip；然后点击「3跳」chip；Then 依次发起 depth=2、depth=3 的 neighbors 查询（调用参数与 query key 均含 depth）。

### FR-02: 切换层级时用 keepPreviousData 保持上一份图渲染不闪空（仓内 changes 列表页先例）；深度切换后选中态回退锚点节点（原选中节点不在新切片时自然兜底，无悬空引用）；

- 层级切换拉取新深度数据期间必须启用 react-query placeholderData: keepPreviousData（上一深度切片持续渲染，分区不闪为加载占位）；用户已选节点不在新深度切片时选中态必须自然回退（selectedId 查不到 → 锚点兜底 → 首节点），禁止渲染悬空选中。

#### 场景：切换不闪空

- Given 已按 1 跳渲染完成；When 点击「3跳」且新查询在途；Then 分区保持渲染上一份切片（无 loading 整区替换），新数据到达后原位更新。

### FR-03: fail-open 语义随深度保持：新深度查询失败/空结果 → 整区隐藏（与既有口径一致）；

- 新深度查询 isError 或信封 available=false 或节点集为空时必须整区隐藏（return null），禁止渲染错误卡或半空态；既有 fail-open 用例（不可用/失败/空三态）必须保持绿。

#### 场景：新深度失败隐藏

- Given 已按 1 跳渲染；When 切 3 跳且该查询 reject；Then 分区整区隐藏。

### FR-04: 仅跑本改动相关测试（change-assets-graph + change-assets-card），全量留给 CI。

- 本次验证仅运行 change-assets-graph.test.tsx 与 change-assets-card.test.tsx 两文件；既有 6 用例的调用断言必须随 depth 参数同步改写（depth: 1），其余断言禁止修改。

#### 场景：相关面全绿

- Given 实现与测试改写完成；When 运行两文件；Then 全部用例通过（0 fail）。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx「层级选择器：默认 1 跳，点击 2跳/3跳 按所选深度重新发起 neighbors 查询」
FR-02: frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx「层级切换不闪空：keepPreviousData 保持上一份渲染」
FR-03: frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx 既有「fail-open」三用例（不改断言）
FR-04: frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx 全文件 + frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx 全文件
