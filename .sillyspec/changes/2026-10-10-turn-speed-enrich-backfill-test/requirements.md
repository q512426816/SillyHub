---
author: flow-machine-draft
created_at: 2026-10-10T19:06:00.000Z
---
# 需求规格（Requirements）— 2026-10-10-turn-speed-enrich-backfill-test

## 功能需求

### FR-01: enrichDisplayTurns 的 apiDurationMs 回填语义必须有行为测试锁定（上变更评审 P3）

page-helpers.tsx `enrichDisplayTurns` 对 `apiDurationMs` 的历史回填（?? 链只补缺：
turn 实时值优先、快照只补缺、快照缺失回填 null）与身份稳定守卫（字段一致返回原
对象引用、仅 apiDurationMs 变化返回新对象）**必须**有 vitest 行为测试覆盖；
**禁止**为通过测试修改实现逻辑（本变更为纯测试补充，实现零改动）。

#### 场景：历史轮回填

- Given：历史 turn 无 apiDurationMs，runsMeta 快照 duration_api_ms=12500
- When：enrichDisplayTurns 回填
- Then：turn.apiDurationMs === 12500

#### 场景：实时值优先

- Given：turn.apiDurationMs=999（实时 turn_completed 已写入），快照 12500
- When：回填
- Then：保持 999（?? 链不覆盖）

### FR-02: 测试全绿（不跑全量）

新增测试文件 vitest **必须**全部通过；**禁止**运行全量测试套件（CI 职责）。

#### 场景：相关测试绿

- When：运行新增测试文件
- Then：全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/page-helpers-enrich-api-duration.test.ts「全部用例（回填/优先/缺失/null/未命中/引用稳定/新对象）」
FR-02: frontend/src/components/daemon/__tests__/page-helpers-enrich-api-duration.test.ts（vitest run 全绿）
