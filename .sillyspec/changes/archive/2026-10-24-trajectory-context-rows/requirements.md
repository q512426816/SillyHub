---
author: flow-machine-draft
created_at: 2026-10-24T16:08:34.422Z
---
# 需求规格（Requirements）— 2026-10-24-trajectory-context-rows

## 功能需求

### FR-01: turn_trigger 段在轨迹账本显示为「上下文」类型行（kind=system + meta.contextEvent），摘要为段 text，锚点取段 ts（缺失用轮首，不伪造）

- `rowKindOf` **必须**把 `turn_trigger` 段（后台任务通知 / 自动续跑 / 群聊影子直聊来源 / 定时到点等轮触发源）映射为 `system` 行并置 `meta.contextEvent=true`（账本标签「上下文」），**禁止**再映射为 `user`；行摘要 **必须** 为段 `text`；起始锚点 **必须** 取段 `ts`（缺失落到轮首，禁止伪造）。

#### 场景：主路径

Given 一轮含 `turn_trigger` 段（trigger=task_wakeup，text="[后台任务通知] 任务完成"，ts=轮中段）；When 打开轨迹；Then 账本出现「上下文」行，摘要为通知原文，按 ts 排在正确位置。

#### 场景：零回归

Given 一轮不含 turn_trigger 段；When 派生；Then 行集合与改动前一致（user_msg 仍为「用户」行）。

### FR-02: 段锚点统一「先 startedAt 再 ts」读取

- `segmentStart` **必须** 对所有段先读 `startedAt`、再回退 `ts`（数字才采用），使 `user_msg`/`turn_trigger`/`stderr` 等 ts 系段的锚点生效；**禁止** 改变 thinking/tool 既有锚点语义。

#### 场景：主路径

Given user_msg 段 ts=轮中段时刻；When 派生；Then 该行 startedAt=ts（不再挤在轮首）。

### FR-03: processItems.system_event 派生保留（回放路径零回归）

- 上一变更引入的 `system_event → 上下文行` 派生 **必须** 原样保留；既有轨迹测试 **禁止** 放宽或删除；`frontend` 的 `tsc --noEmit` **必须** 退出 0。

#### 场景：主路径

Given 变更落盘；When 跑轨迹目录测试与 tsc；Then 全部通过。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: `frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts`「turn_trigger 段派生为上下文行：通知原文 + ts 锚点 + 不再标用户」
FR-02: `frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts`「user_msg 段锚点取 ts（不挤轮首）」
FR-03: `frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts`（system_event 既有用例零回归）+ 不适用：类型检查无测试面，`pnpm exec tsc --noEmit` 直接验证退出码
