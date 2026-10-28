---
author: flow-machine-draft
created_at: 2026-10-28T06:39:43.067Z
---
# 需求规格（Requirements）— 2026-10-28-change-detail-side-assets-scroll

## 功能需求

### FR-01: 变更详情右侧信息栏不再渲染「范围对账」与「产出速览」两组区块及其取数请求（getScopeAudit/getChangeAssets 两 query 随区块一并移除）

- 变更详情右侧信息栏**必须**只保留基本信息 / 执行用量 / 会话三组；「范围对账」「产出速览」两组区块**禁止**渲染，其取数请求（getScopeAudit / getChangeAssets 两 query）**必须**随区块一并移除（侧栏不再发这两类请求）。

#### 场景：侧栏三组形态

- Given：打开任一变更详情页
- When：右侧信息栏渲染
- Then：只出现基本信息 / 执行用量 / 会话三组；「范围对账」「产出速览」标题及其行（计划内/计划外/计划未动/需求规则/决策蒸馏/知识触达/改动文件）必须全部缺席，网络面不再有 scope-audit 与 changeAssets（侧栏侧）请求

### FR-02: 沉淀资产卡全部六组卡片内容区设统一最大高度，超出部分隐藏并显示纵向滚动条

- 沉淀资产卡六组卡片（需求规则 / 决策蒸馏 / 知识触达 / 测试绑定 / 模块触达 / 归档留档）**必须**统一限高（max-h-64=256px）且内容超出在组内纵向滚动；组标题行**必须**钉在卡片顶部不被滚走。

#### 场景：条目多时组内滚动

- Given：某组条目超过卡片高度可容纳的行数
- When：渲染该组卡片
- Then：卡片高度不超过 256px，超出内容隐藏，组内出现纵向滚动条，标题行恒可见

### FR-03: 「展开全部/收起」按钮固定在卡片底部不被滚动带走

- 各组「展开全部 N 条 / 收起」按钮**必须**渲染在滚动区外（卡片层直接子级、卡片底部），**禁止**被滚动容器包裹（用户随时可点，不需要先滚到底）。

#### 场景：展开按钮可达性

- Given：某组条目数超过 5 条（按钮渲染条件成立）
- When：渲染该组
- Then：按钮出现在卡片底部且不属于任何 overflow-y-auto 滚动容器

### FR-04: 既有分组交互（点击弹窗预览/展开全部）行为不回归

- 分组行点击弹窗预览（知识条目 / 测试文件 / 模块文档 / 单文件 diff）与「展开全部 / 收起」切换行为**必须**与改造前一致（DOM 结构调整不改变交互语义）。

#### 场景：展开收起往返

- Given：8 条 FR 只直显 5 条
- When：点「展开全部 8 条」再点「收起」
- Then：分别显示 8 条 / 5 条（既有用例复跑通过即证）

### FR-05: 相关前端测试通过，tsc 与 eslint 0 error

- 触达测试文件（change-overview-side / change-assets-card / change-assets-fallback / change-assets-graph）**必须**全部通过；tsc 与 eslint 对触达文件 0 error（既有 2 条 no-unused-vars warning 为存量债不扩不修）。

#### 场景：验证面

- Given：全部改动落盘
- When：运行触达测试 + tsc --noEmit + eslint
- Then：67 passed / 0 error / 0 error

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx「三组渲染：基本信息 / 执行用量 / 会话（范围对账与产出速览已移除）」
FR-02: test/frontend/src/components/changes/detail/__tests__/change-assets-fallback.test.tsx「分组限高滚动：卡片最大高度固定 + 组内滚动容器（2026-10-28-change-detail-side-assets-scroll 用户裁决，推翻 2026-10-15 自然高度口径）」
FR-03: test/frontend/src/components/changes/detail/__tests__/change-assets-fallback.test.tsx「分组限高滚动…」（同用例第三段断言：toggle.closest(".overflow-y-auto") 为 null）
FR-04: test/frontend/src/components/changes/detail/__tests__/change-assets-fallback.test.tsx「分组上限：8 条 FR 只直接显示 5 行 + 『展开全部 8 条』，展开后全量、可再收起」+ change-assets-card.test.tsx 全量 41 用例
FR-05: test/frontend/src/components/changes/detail/__tests__/（四文件合跑 67 passed）+ tsc 0 error + eslint 0 error（2 warning 为 stash 验证过的存量债）
