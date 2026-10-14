---
author: flow-machine-draft
created_at: 2026-10-14T02:54:10.974Z
---
# 需求规格（Requirements）— 2026-10-14-change-center-lineage-tag-and-filter

## 功能需求

### FR-01: 变更中心列表行：非轻量出身（is_thin=false）的变更显示「完整」标签，轻量出身行仍显示「轻量」标签，两类标签样式可区分

- 桌面变更中心列表（进行中/已归档两 tab）每行必须在标题行渲染出身标签：`is_thin=false` 的行必须显示「完整」标签（neutral 中性胶囊），`is_thin=true` 的行必须显示「轻量」标签（attention 琥珀闪电胶囊），两类标签配色必须可区分。

#### 场景：主路径

- Given 工作区同时存在轻量出身与完整出身变更，When 打开变更中心列表，Then 完整出身行标题旁显示「完整」中性标签、轻量出身行标题旁显示「轻量」琥珀标签，行内其余信息不受影响。

### FR-02: 筛选区新增「分类」下拉（全部分类/完整变更/轻量变更），选择后列表按出身过滤，分页与总数正确

- 桌面变更中心筛选区必须新增独立「分类」下拉，选项为「全部分类 / 完整变更 / 轻量变更」；选择「完整变更」或「轻量变更」时列表必须只显示对应出身行，`total` 必须等于过滤后全局条数（分页正确）。

#### 场景：主路径

- Given 列表含两类出身变更，When 选择「轻量变更」，Then 列表仅剩轻量出身行且分页器总数与轻量出身总数一致；切回「全部分类」恢复全量。

### FR-03: 已归档 tab 下分类筛选同样生效：归档的轻量出身行在「轻量变更」分类下可见

- 「已归档」tab 下分类筛选必须生效：归档的轻量出身行（含归档后阶段翻 archived、仅靠 steps 兜底识别的行）必须出现在「轻量变更」分类结果中；「完整变更」分类必须排除这些行。

#### 场景：主路径

- Given 存在归档的轻量出身变更（投影 stage=archived、steps 无标准四阶段痕迹），When 在已归档 tab 选择「轻量变更」，Then 该行出现在结果中且带「轻量」标签。

### FR-04: 阶段下拉不再含「轻量变更」选项（分类查询职责迁移到分类下拉）

- 桌面与移动端阶段筛选项必须移除「轻量变更」（value=thin）选项，阶段下拉只保留真实阶段值；后端 `current_stage=thin` 参数保留兼容（不删）。

#### 场景：主路径

- When 打开桌面筛选区或移动筛选抽屉的阶段维度，Then 选项为「全部阶段/需求分析/规划/执行/验证/归档」，无「轻量变更」。

### FR-05: 后端 GET /changes 新增 lineage=thin|full 查询参数，筛选口径与 is_thin 投影三分支判定完全一致

- `GET /api/workspaces/{wid}/changes` 必须新增 `lineage` Query 参数：`thin` 时只返回轻量出身行、`full` 时只返回非轻量出身行、缺省或其他值不过滤；判定必须复用 `_is_thin_lineage` 三分支（stage=thin / change_type=quick / 归档 steps 兜底）+ 时间窗口径，与 `ChangeSummary.is_thin` 投影逐行一致。

#### 场景：主路径

- Given 混合出身数据集，When 分别以 `lineage=thin`、`lineage=full`、不传 lineage 调用列表接口，Then 三次响应的行集合与每行 `is_thin` 投影严格互斥且并集为全量。

### FR-06: 移动端变更中心同步：筛选抽屉含分类维度，变更卡片显示出身标签

- 移动变更中心筛选抽屉必须新增「分类」维度（全部/完整变更/轻量变更 chips），选择后列表请求带 `lineage` 参数；移动变更卡片徽标行必须显示出身标签（轻量=琥珀、完整=中性），与桌面口径一致。

#### 场景：主路径

- When 在移动筛选抽屉选择「轻量变更」并确定，Then 列表仅剩轻量出身卡片且每张卡片带「轻量」标签。

### FR-07: 前端 api-types.ts 与 backend/openapi.json 经 pnpm gen:types 同步提交

- 后端 Query 参数落地后必须运行 `pnpm gen:types`，`frontend/src/lib/api-types.ts` 与 `backend/openapi.json` 的同步产物必须随本变更提交，不允许手写接口类型。

#### 场景：主路径

- When 后端路由新增 lineage 参数并重新生成 OpenAPI，Then `pnpm gen:types` 后 `git status` 中两产物均为已同步状态并纳入提交。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx「完整出身行显示完整标签、轻量出身行显示轻量标签」
FR-02: frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx「分类下拉选择轻量变更仅显示轻量出身行」
FR-03: backend/app/modules/change/tests/test_change_lineage_filter.py「lineage thin 命中归档 steps 兜底行」
FR-04: frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx「阶段下拉不含轻量变更选项」
FR-05: backend/app/modules/change/tests/test_change_lineage_filter.py「lineage thin/full 与 is_thin 投影三分支一致」
FR-06: frontend/src/components/mobile/mobile-change-card.test.tsx「移动卡片出身标签」；frontend/src/app/m/workspaces/[id]/changes/__tests__/page.m-changes.test.tsx「筛选抽屉分类维度」
FR-07: 不适用：生成产物步骤——验收方式为 pnpm gen:types 后两产物进 git 提交（执行时验证，无独立测试面）
