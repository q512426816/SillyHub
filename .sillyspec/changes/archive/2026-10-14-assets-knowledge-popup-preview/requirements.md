---
author: flow-machine-draft
created_at: 2026-10-14T07:54:34.800Z
---
# 需求规格（Requirements）— 2026-10-14-assets-knowledge-popup-preview

## 功能需求

### FR-01: FR 索引与决策蒸馏条目行点击不再整页跳转，打开条目内容预览弹窗（弹窗内以条目卡渲染所在文件内容并定位到该条目）

- 变更详情「沉淀资产」卡中「需求规则（FR 索引）」与「决策蒸馏」两组的每个条目行必须改为点击打开条目内容预览弹窗，禁止再整页跳转知识库；弹窗内必须以条目卡（EntryCardList）渲染该条目所在知识文件的内容，并把目标条目卡滚动定位到可视区。

#### 场景：主路径

- Given 已归档变更的沉淀资产卡返回 fr_entries=[{id: FR-auto-x-001, file: knowledge/fr/x.md, ...}]
- When 用户点击该条目行
- Then 弹窗打开，getKnowledge 按 file 归一后的 fr/x.md 取数，弹窗内渲染条目卡且存在 data-entry-anchor="fr/x.md#FR-auto-x-001" 的目标卡片

### FR-02: 知识触达的整文件 chip、文件组头与锚点条目行同样弹窗打开（无锚点时文件级展示）

- 「知识触达」组的整文件 chip、文件组头与锚点条目行必须同样改为点击打开条目内容预览弹窗，禁止整页跳转；无锚点目标（整文件 chip / 文件组头）必须按文件级展示（弹窗内不滚动定位）。

#### 场景：主路径

- Given 知识触达数据含整文件条目（id==file，如 fr/daemon.md）与锚点条目（file=conventions.md, id=slug-a）
- When 用户分别点击整文件 chip 与 slug-a 条目行
- Then 两次均弹窗打开且不发生整页跳转；chip 场景 getKnowledge 收到 fr/daemon.md 且无定位动作，条目行场景定位到 conventions.md#slug-a

### FR-03: 知识类弹窗内提供「在知识库中打开」链接，href 沿用原 file+anchor 深链

- 条目内容预览弹窗头部必须提供「在知识库中打开」链接，href 必须沿用改造前的深链格式（`/workspaces/{id}/knowledge?file=<spec 树相对路径>&anchor=<条目 id>`，无锚点时省略 anchor 参数），保证从弹窗仍可一键跳到知识库页并定位。

#### 场景：主路径

- Given 用户从 FR 行打开预览弹窗（file=knowledge/fr/x.md, anchor=FR-auto-x-001）
- When 查看弹窗头部
- Then 存在文案「在知识库中打开」的链接，其 href 解码后为 /workspaces/ws-1/knowledge?file=knowledge/fr/x.md&anchor=FR-auto-x-001

### FR-04: 测试绑定/模块触达/归档留档维持既有弹窗交互不回退

- 「测试绑定」（测试文件预览弹窗）、「模块触达」（模块文档预览弹窗）、「归档留档」（单文件 diff 弹窗）三组的既有点击弹窗交互必须保持不变，本变更禁止改动其触发方式与弹窗内容。

#### 场景：主路径

- Given 沉淀资产卡含测试绑定/模块触达/归档留档数据
- When 分别点击测试文件、模块 chip、留档文件
- Then 三者仍各自打开原有弹窗（FilePreview / 模块文档 / DiffView），交互与改造前一致

### FR-05: change-assets-card.test.tsx 同步更新并通过

- 组件测试 frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx 必须同步覆盖新弹窗交互（原「href 深链」断言改写为弹窗断言），且该文件在 vitest 下必须全绿；条目内容取数失败时弹窗内必须就近展示错误文案而非空白。

#### 场景：主路径

- Given getKnowledge mock 抛错
- When 用户点击条目行打开弹窗
- Then 弹窗内展示错误文案，且弹窗头部的「在知识库中打开」链接仍然可见

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「FR/决策索引行：点击弹窗预览条目内容并定位，弹窗内含知识库深链」
FR-02: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「知识触达：整文件 chip 与锚点条目行点击弹窗打开（chip 文件级无定位）」
FR-03: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「FR/决策索引行：点击弹窗预览条目内容并定位，弹窗内含知识库深链」
FR-04: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「测试绑定行：锚点标注「变更内」且测试文件可点开预览（FR-03）」
FR-05: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「知识条目预览弹窗：取数失败就近展示错误文案，深链仍可见」
