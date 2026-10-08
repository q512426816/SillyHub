---
author: flow-machine-draft
created_at: 2026-10-08T17:38:11.159Z
---
# 需求规格（Requirements）— 2026-10-09-frontend-risk-fixes

## 功能需求

### FR-01: 知识库页选择 fetch 失败时内容区显示可判定的错误态（不再永久「正在加载」占位），后续重新选择可恢复

- 知识库页条目详情 fetch 失败时，内容区必须进入就近错误分支（`entry-error`，含错误文案与重试入口），禁止停留在「正在加载」占位；新一次选择或重试必须清除错误态并正常恢复渲染。

#### 场景：fetch 失败 → 错误态 → 重试恢复

- Given 用户点选文件后 getKnowledge 拒绝（非 ApiError 走通用文案）
- When 失败落地
- Then 内容区显示 `entry-error`（含「加载文档失败」文案与文件名）、`entry-loading` 消失；点击「重试」重发 selectEntry，成功后条目卡渲染且 `entry-error` 消失

### FR-02: 锚点复制按真实结果反馈：复制成功才提示成功，clipboard 不可用/失败提示失败（对齐 governance-cards copyPrompt 既有范式）

- 锚点复制按钮的提示必须以 `copyText` 的真实结果为准：返回真才 `message.success`；clipboard 为 undefined（不安全上下文）或 writeText 抛错时必须 `message.error` 失败文案，禁止无条件假成功。

#### 场景：不安全上下文

- Given http 非 localhost 下 `navigator.clipboard === undefined`
- When 点击锚点复制按钮
- Then 出现「复制失败：剪贴板不可用」，不出现「锚点已复制」

#### 场景：复制成功

- Given clipboard.writeText 正常 resolve
- When 点击锚点复制按钮
- Then 出现「锚点已复制」

### FR-03: 知识图谱 overview 与 query 请求前端超时对齐服务端 RPC 预算（显式 timeoutMs ≥ 服务端最坏情形），大仓不再恒超时

- `getKnowledgeGraphOverview` 必须显式传 `timeoutMs=200_000`（三连 RPC 最坏 180s + 余量）、`getKnowledgeGraphQuery` 必须显式传 `timeoutMs=90_000`（单 RPC 60s + 余量），禁止回落 apiFetch GET 缺省 30s。

#### 场景：大仓慢查询不再前端先死

- Given overview 服务端耗时 40s（> 30s 缺省、< 180s 最坏）
- When 前端发起请求
- Then 客户端不 abort，服务端逐条容错语义生效（reason 分支而非恒 rpc_error 降级）

### FR-04: 图谱画布 pointer 按下（拖拽/平移）与滚轮同样置位用户交互标记，自动 re-fit 跟随即停（兑现提交声明「拖拽/缩放即停」）

- 图谱画布 `onPointerDown` 必须与 `onWheel` 同样置位 `userTouchedRef`（自动 re-fit 判定 `shouldAutoRefit` 一律返回 false），禁止仅滚轮置位导致拖拽被 refit 抢回视口。

#### 场景：数据到达后拖拽不被抢视口

- Given 力场收敛期（前 360 tick 内）用户 pointer 按下拖节点/平移
- When 90/180/270/360 tick 到点
- Then `shouldAutoRefit` 判 false，fitView 不执行（视口不被拽回）

### FR-05: 既有相关面测试保持绿；四处修复各有用例钉住（先红后绿或行为断言）

- 本变更必须保持四个相关测试文件既有用例全绿（entry-card-list / graph-canvas / knowledge-page / 新增 knowledge-graph-timeout），且四处修复各有新用例断言行为。

#### 场景：相关面双绿

- Given 实现完成
- When 运行四个测试文件
- Then 全部通过（本次实测 entry-card-list 25 + graph-canvas 22 + knowledge-page 27 + knowledge-graph-timeout 2 = 76 绿，tsc 0 error、eslint 0 error）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx「条目详情 fetch 失败 → 内容区就近错误态 + 重试恢复（不再永久加载占位）」
FR-02: test/frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx「剪贴板不可用（不安全上下文 clipboard=undefined）→ 失败反馈，不再假成功」
FR-02: test/frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx「复制成功 → 成功提示按真实结果出现」
FR-03: test/frontend/src/lib/__tests__/knowledge-graph-timeout.test.ts「overview 显式 200s（三连 RPC 最坏 180s + 余量），不吃 GET 缺省 30s」
FR-03: test/frontend/src/lib/__tests__/knowledge-graph-timeout.test.ts「query 显式 90s（单 RPC 60s + 余量）」
FR-04: test/frontend/src/components/knowledge/__tests__/graph-canvas.test.ts「用户交互置位（滚轮缩放/指针按下拖拽双源）后一律停跟随，refit 不再抢视口」
FR-05: test/frontend 四文件既有用例全绿「entry-card-list 25 + graph-canvas 22 + knowledge-page 27 + knowledge-graph-timeout 2」
