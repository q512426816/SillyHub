---
author: flow-machine-draft
created_at: 2026-10-15T00:42:33.492Z
---
# 需求规格（Requirements）— 2026-10-14-decision-anchor-change-qualified

## 功能需求

### FR-01: 决策/FR 结构化条目卡在带「变更：」字段时输出 data-entry-anchor-qualified=文件#变更号#决策号（既有 data-entry-anchor 裸锚保留不破坏旧深链）

- 决策/FR 结构化条目卡（EntryCardList DecisionCard）在条目同时具备 id 与「变更：」字段时，必须额外输出 `data-entry-anchor-qualified="<文件>#<变更号>#<条目id>"` 属性；既有 `data-entry-anchor="<文件>#<条目id>"` 裸锚必须原样保留（旧深链/旧消费方不破坏）；缺 id 或缺「变更：」字段时禁止输出复合属性。

#### 场景：主路径

- Given decisions 文件含两个同 id 条目（D-003@v1，变更号分别为 change-a / change-b）
- When 渲染 EntryCardList（structured 形态）
- Then 两张卡的 data-entry-anchor 均为 `decisions/x.md#D-003@v1`，而 data-entry-anchor-qualified 分别为 `decisions/x.md#change-a#D-003@v1` 与 `decisions/x.md#change-b#D-003@v1`，互不冲突

### FR-02: 沉淀资产卡弹窗定位优先按复合锚精确匹配，查无再退裸锚（FR/决策/触达/手册各形态均不回退）

- 沉淀资产卡知识条目预览弹窗的锚点定位必须优先按 `文件#<变更号>#<决策号>` 复合属性精确匹配（变更号取卡片的 changeKey），仅当复合属性查无时才回退既有裸锚 `文件#<id>`；无 changeKey 或目标文件条目无「变更：」字段（手册/触达等）时必须走裸锚路径不回退。

#### 场景：主路径

- Given 决策文件含 change-a 与 change-b 两个同 id 条目（D-003@v1），资产卡 changeKey=change-b
- When 用户点击 change-b 的 D-003@v1 行打开弹窗
- Then 弹窗滚动定位落在 data-entry-anchor-qualified="decisions/x.md#change-b#D-003@v1" 的卡片，而不是文件序在前的 change-a 同号卡

### FR-03: 沉淀资产卡 FR/决策行的知识库深链 anchor 参数带变更号前缀，知识库页深链滚动对含 # 的 anchor 先试复合锚再退裸锚

- 沉淀资产卡 FR 索引与决策蒸馏行的「在知识库中打开」深链 anchor 参数必须携带变更号前缀（`<变更号>#<条目id>`，changeKey 缺省时退化为裸 id）；知识库页深链滚动在 anchor 含 `#` 时必须先按复合属性匹配、查无再按裸锚匹配，保证跨页跳转同样精确落卡。

#### 场景：主路径

- Given 资产卡 changeKey=change-b，用户点击其 D-003@v1 行弹窗头部的「在知识库中打开」
- Then 跳转 URL 的 anchor 参数解码后为 `change-b#D-003@v1`；知识库页加载该文件后滚动定位到复合属性为 `decisions/x.md#change-b#D-003@v1` 的卡片

### FR-04: 知识触达行与手册/INDEX 锚点行为不变

- 知识触达组（整文件 chip / 文件组头 / 锚点条目行）的弹窗打开与深链行为、手册小节卡与 INDEX 路由行的锚点形态必须保持不变，本变更禁止改动其 anchor 取值与匹配路径。

#### 场景：主路径

- Given 资产卡含知识触达数据与手册文件（manual 形态）
- When 点击触达锚点条目行 / 遍历手册小节卡锚点
- Then 触达行仍以裸 slug 锚打开弹窗并按 `文件#slug` 定位；手册小节卡仍只输出 `data-entry-anchor="文件#slug"`，不出现复合属性

### FR-05: 相关组件测试同步更新并通过（entry-card-list / change-assets-card / knowledge-page）

- 三个组件测试文件必须同步覆盖复合锚契约（属性输出 / 弹窗定位优选 / 深链滚动优选），且三个文件在 vitest 下必须全绿；同 id 跨变更场景必须有显式用例钉死「复合锚命中正确卡片」。

#### 场景：主路径

- Given 三个测试文件按新契约更新
- When vitest 运行三个文件
- Then 全部用例通过，其中至少一条用例覆盖「同 id 跨变更、复合锚命中变更号对应卡片」

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx「结构化卡：带变更字段输出复合锚属性，裸锚保留」
FR-02: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「决策行弹窗定位：同 id 跨变更按变更号+决策号复合锚精确命中」
FR-03: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx「anchor 含变更号前缀（变更号#决策号）：先试复合锚精确落卡」
FR-04: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「知识触达：锚点条目行点击弹窗打开，弹窗深链沿用 file+anchor（不整页跳转）」
FR-05: frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx「结构化卡：带变更字段输出复合锚属性，裸锚保留」
