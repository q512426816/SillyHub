---
author: flow-machine-draft
created_at: 2026-10-15T03:09:55.835Z
---
# 需求规格（Requirements）— 2026-10-15-change-assets-graph

## 功能需求

### FR-01: 沉淀资产卡内新增知识图谱分区：本变更一跳邻域切片（neighbors 锚点=change_key）+ 右侧节点详情栏（类型/ID/出入邻居分组，行点击跳选，默认选中变更锚点节点）；图不可用/请求失败/无数据时整区静默隐藏（fail-open 与资产卡逐组同口径）；

- 沉淀资产卡展开态必须在资产分组网格上方渲染「知识图谱」分区：复用 GraphCanvas 以 slice 模式渲染本变更 neighbors 一跳切片（getKnowledgeGraphQuery 锚点=changeKey），右侧必须并排节点详情栏（节点类型中文标签 + 色点 + ID + 按边型分组的出入邻居行）；详情栏行点击必须跳选该节点，画布节点点击必须选中并在详情栏呈现；初始必须选中锚点（变更节点）。信封 available=false / 请求失败 / 节点集为空时整区禁止渲染（静默隐藏，不显示错误卡）。

#### 场景：主路径

- Given daemon 图可用且 change_key 已注册图节点；When 用户展开沉淀资产卡；Then 知识图谱分区显示画布与右侧详情栏，详情栏默认呈现变更锚点节点的类型/ID/邻居分组。

#### 场景：降级隐藏

- Given 查询信封 available=false 或请求失败或 nodes 为空；When 分区渲染；Then 整区不出现（资产卡其余分组不受影响）。

### FR-02: 详情页主栏顺序变为：审批卡 → 沉淀资产 → 步骤时间线 → 真实留痕时间线；

- 变更详情页主栏（main）挂载顺序必须为 ChangeStageActions → ChangeAssetsCard → 步骤时间线卡 → ChangeTimelineCard；沉淀资产卡禁止再出现在真实留痕时间线之后。

#### 场景：主路径

- Given 厚变更（有 steps 与留痕观测数据）；When 渲染详情页；Then DOM 顺序中沉淀资产卡位于步骤时间线卡之前、审批卡之后。

### FR-03: 步骤时间线卡头有展开/收起切换，默认收起；上方阶段步骤条节点点击联动时自动展开；thin 出身整卡隐藏语义不变；

- 步骤时间线卡必须默认收起（ChangeStepTimeline 组件体不渲染），卡头必须有展开/收起切换按钮；点击切换必须展开/收起组件体；focusStage 联动（阶段步骤条节点点击）必须在收起态自动展开；thin 出身（isThinLineageChange）整卡不渲染语义必须保持。

#### 场景：默认收起与联动展开

- Given 厚变更 steps 非空且用户未操作；When 渲染详情页；Then 卡体（change-step-timeline）不出现、卡头出现；When 点击阶段节点（focusStage 置位）；Then 卡体自动展开。

### FR-04: ChangeStageActions 无待审事项（pending_review 空）时不渲染任何占位卡；有待审面板/quick 存量说明/thin 拦截三类既有分支行为不变。

- pending_review 为空且非 quick 阶段时组件必须返回 null（「当前无可审批事项」占位卡禁止再渲染）；pending_review 命中 APPROVAL_PANELS 的审批面板、quick 阶段存量说明卡、thin 出身拦截（返回 null）三支行为必须与现状逐字一致。

#### 场景：无待审不渲染

- Given pending_review=null 且 current_stage 非 quick/thin；When 渲染 ChangeStageActions；Then 根元素为 null，「当前无可审批事项」文案不出现。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx「渲染一跳切片并默认选中锚点」「不可用时整区隐藏」
FR-02: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx「FR-02：沉淀资产卡上移——主栏顺序钉死（审批卡→沉淀资产→步骤时间线→留痕时间线）」
FR-03: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx「change.steps 有明细 → 默认收起，点开展开渲染 ChangeStepTimeline 区块」
FR-04: frontend/src/components/changes/detail/__tests__/change-stage-actions.test.tsx「无待审阶段：不渲染占位卡（返回 null）」
