---
author: flow-machine-draft
created_at: 2026-10-13T21:40:45.988Z
---
# 需求规格（Requirements）— 2026-10-14-ci-flaky-render-anchor-sweep

## 功能需求

### FR-01: 6 处确认脆弱点全部改为渲染锚等待：同步 getByXxx/textContent 断言包进 await waitFor（或等价 findByXxx），断言不再早于渲染提交

- 以下 6 处「mock 调用等待后同步断言渲染」必须改为渲染锚等待（渲染断言本身包进 `await waitFor`，或等价 `await screen.findByXxx`），口径对齐各文件内既有正确写法先例：
  1. `frontend/src/app/(dashboard)/settings/api-keys/__tests__/page.test.tsx:115-118`（execCommand("copy") 等待后同步 getByText("已复制")）——对齐同文件 143-144；
  2. `frontend/src/app/m/workspaces/[id]/changes/[cid]/__tests__/page.m-change-detail.test.tsx:279-284`（writeText 等待后同步读 feedback textContent）——对齐同文件 268-272；
  3. `frontend/src/components/daemon/__tests__/team-task-block.test.tsx:232-233`（cancelMock 计数等待后同步 getByText("取消团队任务失败")）；
  4. `frontend/src/components/knowledge/__tests__/governance-cards.test.tsx:155-158`（writeTextMock 计数等待后同步 getByTestId("copy-ai-prompt-result")）；
  5. `frontend/src/components/ask-user-dialog-card.test.tsx:737-742`（onAlreadyResolved 等待后同步 getByText("已回答，本题已关闭")）；
  6. `frontend/src/components/ask-user-dialog-card.test.tsx:769-772`（同上 409 answered_by=null 变体）；
- 除时序包裹外，断言目标与用例语义必须保持原样，禁止借机改写断言内容。

#### 场景：mock 调用早于渲染提交的慢机形态

- Given：mock 已被调用但 setState 的 promise 续体尚未提交渲染（CI 359 文件并行慢机形态）
- When：用例执行到原同步渲染断言处
- Then：该断言已在 waitFor 内按 50ms 步进重试至渲染提交，不再单拍击穿

### FR-02: 涉及 5 个测试文件本地全量转绿

- 5 个文件（api-keys page / m-change-detail / team-task-block / governance-cards / ask-user-dialog-card 的测试文件）必须 vitest 定向跑全部用例通过。

#### 场景：定向回归

- When：`pnpm vitest run <5 文件>` 本地执行
- Then：全部用例 PASS、退出码 0

### FR-03: 零生产代码改动：仅测试文件时序加固

- 禁止触碰 `frontend/src/` 非测试文件；允许面仅限上述 5 个测试文件与 SillySpec 治理工件。

#### 场景：交付面审查

- Given：flow done 冻结面采集 baseline..HEAD
- When：审查 diff 文件清单
- Then：仅含 5 个测试文件与 .sillyspec 治理工件

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/app/(dashboard)/settings/api-keys/__tests__/page.test.tsx「复制密钥成功反馈（已复制）」（以文件实际用例名为准——断言位置 115-118）
FR-01: frontend/src/app/m/workspaces/[id]/changes/[cid]/__tests__/page.m-change-detail.test.tsx「复制变更名反馈」（断言位置 279-284）
FR-01: frontend/src/components/daemon/__tests__/team-task-block.test.tsx「取消团队任务失败提示」（断言位置 232-233）
FR-01: frontend/src/components/knowledge/__tests__/governance-cards.test.tsx「复制 AI 提示词结果」（断言位置 155-158）
FR-01: frontend/src/components/ask-user-dialog-card.test.tsx「409 已回答关闭提示两变体」（断言位置 737-742、769-772）
FR-02: frontend/src/app/(dashboard)/settings/api-keys/__tests__/page.test.tsx「全文件」（FR-01 绑定的定向回归面）
FR-03: 不适用：负向约束面——由冻结面 diff 文件清单审查保证，非测试可判定
