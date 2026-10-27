---
author: qinyi
created_at: 2026-10-26T23:05:00
---
# 需求规格（Requirements）— 2026-10-26-mobile-four-page-layout-fix

## 功能需求

### FR-01: 会话对话页运行状态条不再溢出（TurnLiveMarquee mobile 分支）

- variant="mobile" 宿主下，状态胶囊（「等待模型响应 · 23.1s · ↑78,489 ↓2,170」）完整落在视口内：次要信息（token 计数/tok/s）收窄或并入跑马灯轨道，主信息保证可读；desktop 宿主形态不变（锚定用例）。

#### 场景：mobile 宿主

- Given SessionPanel variant="mobile" 且轮次处于运行中
- When 渲染 TurnLiveMarquee
- Then 胶囊无横向溢出（容器不超出视口宽），主状态文本完整可读

#### 场景：desktop 锚定

- Given SessionPanel variant="desktop"
- Then TurnLiveMarquee 渲染形态与改动前一致（desktop 用例断言）

### FR-02: 轮次信息胶囊不再溢出（RoundDivider mobile 分支）

- mobile 下轮次 meta（`↑78,489 ↓2,170 · 53 tok/s · 开始 22:29`）允许折行且数字缩写（≥10000 → 78.5k）；desktop 不缩写不折行（锚定用例）。

#### 场景：mobile 长数字

- Given RoundDivider meta 含 ↑78,489 ↓2,170
- When mobile=true 渲染
- Then 显示 78.5k 缩写且胶囊不超出容器宽

### FR-03: 输入占位排队态短句

- variant="mobile" 且会话处于排队态时，输入框占位显示 mobile 短句（不截断）；desktop 占位文案不变。

### FR-04: 底部供应商/模型行不再拥挤截断

- mobile 下 SessionConfigBar 模型名截断策略收紧（消除「glm-5.3-fla…」观感：放宽截断宽或换行式布局），用量徽章排列不挤压；desktop 不变（锚定用例）。

### FR-05: 「平台同步」卡标题禁竖排（PlatformSyncSection mobile 分支）

- mobile 下标题「平台同步」单行不折行，右侧统计信息（未决冲突/ghost/数据源机器/更新时间）折行排列；desktop compact 形态不变（锚定用例）。

#### 场景：mobile 窄视口

- Given PlatformSyncSection mobile=true 于 480px 视口
- Then 标题单行显示「平台同步」，统计块在下一行完整可读

### FR-06: 变更中心搜索行两行化

- /m/ 变更中心页搜索框独占一行（placeholder「搜索 Key / 标题 / 描述 / 组件…」完整可见），搜索/筛选/重新扫描按钮第二行；桌面变更中心页布局不变。

### FR-07: 底部悬浮元素不再遮挡列表内容

- 外壳内容区底部避让 = TabBar 胶囊高 + 底距 + safe-area + 缓冲（env 带 fallback）；TabBar 胶囊不透明底；会话列表末尾预留 FAB 让位空间——滚动到底时最后一条内容完整可见。

#### 场景：列表滚到底

- Given 会话列表/工作区列表滚动到底部
- Then 最后一条卡片完整可见，不被 TabBar 或 FAB 遮挡

### FR-08: 工作区选择页密度收敛

- /m/workspaces 创建按钮/搜索框/筛选器/卡片密度收紧（参照 design §Wave 3），单屏（430×932 视口）可见工作区卡片 ≥3 个；信息（路径/负责人）不换行丢失。

### FR-09: 会话列表页头部与 FAB 收敛

- mobile-workspace-header「变更中心/会话」双按钮高度收紧；列表末尾 FAB 让位——最后一条会话卡片不被 FAB 压字。

### FR-10: PC 端零回归（硬验收）

- 全部共用组件 desktop 分支样式不变；PC 端变更中心页、会话面板（dashboard 路由 + dialog/悬浮宿主）相关既有测试零回归。

#### 场景：desktop 宿主全链

- Given 任一共用组件以 desktop / dialog / 悬浮宿主形态渲染
- Then DOM 结构与样式类与改动前一致（各组件 desktop 锚定用例 + 既有测试全绿）

## 非功能需求

- NFR-01: 三端兼容——safe-area 用 env() + fallback，不依赖仅 iOS 的特性；改动不引入平台相关 API。
- NFR-02: 仅跑相关测试面（daemon sessions / changes / mobile 套件 + tsc + eslint），全量归 CI。
- NFR-03: 用户真机（iPhone Safari，crrcdt.ppdmq.top）复验四页面为最终视觉验收。

## 决策覆盖矩阵

| 决策 | 覆盖的 FR/章节 | 归属说明 |
|---|---|---|
| D-001@v1 | FR-01~09 全部（mobile 分支机制为技术前提） | 已采纳路线 |
| D-002@v1 | 非目标第 2 条、FR-10（不引入断点样式是 PC 零回归的前提之一） | 落选方案，防复潮登记 |
| D-003@v1 | 非目标第 1 条 | 落选方案，防复潮登记 |

无未覆盖决策。剩余风险见 design.md 风险登记 R-01~R-05。

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「TurnLiveMarquee 手机端窄视口分支——mobile=true 隐藏右缘 LIVE 徽标」+ frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx「variant 透传链端到端」
FR-02: frontend/src/components/chat/__tests__/round-divider.test.tsx「mobile=true：meta 中 ↑/↓ 大数缩写（78,489→78.5k）」+ turn-timeline-token-speed.test.tsx「variant=mobile 端到端：RoundDivider meta 大数缩写真实生效」
FR-03: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx「running+mobile → 短句『已排队，结束后自动发送…』」
FR-04: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「mobile 下模型 select 宽度放宽至 150px」
FR-05: frontend/src/components/changes/__tests__/platform-sync-section.test.tsx「mobile=true：卡头统计块纵向堆叠（flex-col）」
FR-06: frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx 全套件（28 用例，搜索框 w-full 结构改动后全绿；布局断言由类名评审锚 visual-evidence.md）
FR-07: frontend/src/components/mobile/mobile-tab-bar.test.tsx「悬浮胶囊形态——实底不透明」+ mobile-app-shell.tsx:56 calc 避让（代码评审锚）
FR-08: frontend/src/app/m/workspaces/__tests__/page.m-workspaces.test.tsx 全套件（7 用例，密度改动后全绿）
FR-09: frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx 全套件（13 用例，FAB spacer 后全绿）+ mobile-workspace-header.test.tsx（23 用例触控断言）
FR-10: 上述全部 desktop 锚用例（marquee「desktop 锚：缺省 LIVE 照旧」/round-divider「desktop 锚：原样不缩写」/session-config-bar「desktop 锚：150px 不变」/platform-sync「desktop 锚：flex-wrap 照旧」/page.test「desktop 占位逐字符不变」）+ session-panel-variant.test.tsx 22 用例（悬浮宿主形态零变化）
