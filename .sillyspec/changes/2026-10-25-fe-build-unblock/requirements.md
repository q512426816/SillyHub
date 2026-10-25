---
author: flow-machine-draft
created_at: "2026-10-25T12:36:00Z"
---
# 需求规格（Requirements）— 2026-10-25-fe-build-unblock

## 功能需求

### FR-01: pnpm build 成功（Type error 归零）

- 修复后 `pnpm build` **必须**成功退出（page-helpers.tsx:435 TS2532 与 session-panel-variant.test.tsx:238 TS2322 归零）；修复**必须**为纯类型层面（`?.` 可选链收窄 + `as never[]` 断言收口），**禁止**任何行为变化。

#### 场景：主路径

- Given main 红态（next build Failed to compile）When 应用两处类型修复 Then pnpm build 成功

### FR-02: 行为零变化：首轮 configChangeLine 前轮传 null 语义不变

- `buildConfigChangeLine` 的前轮参数在 i=0 时**必须**仍为 null（ordered[-1] 经 `?.` 收窄后 `?? null` 回 null，与原三元 i>0 判定等值）；session-panel-variant.test.tsx 既有 13 用例**必须**全绿。

#### 场景：零回归

- Given 修复合入 When 跑 session-panel-variant.test.tsx Then 13 用例全绿

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：构建门本身即验证面（pnpm build 退出码）——收口实测覆盖，无单测可绑
FR-02: frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx「全部 13 用例（既有回归面）」
