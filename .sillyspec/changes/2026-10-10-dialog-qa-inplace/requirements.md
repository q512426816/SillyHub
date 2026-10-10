---
author: flow-machine-draft
created_at: 2026-10-10T15:03:59.680Z
---
# 需求规格（Requirements）— 2026-10-10-dialog-qa-inplace

## 功能需求

### FR-01: 对话视图 ❓ 提问记录按时间戳穿插进对话流（不再整组前置轮头部）

- `SegmentedTurnBody`（v2 段路径）的「对话」视图必须把该轮 ❓ 提问记录卡（dialogHistory 按 run_id 过滤）与对话段合并：dialog 以 `created_at`、段以既有 `segmentTsOf` 时刻为键，稳定排序（缺 ts 视为 0，与「全部」视图时间线同约定）后穿插渲染——两段之间的提问必须渲染在两段之间，晚于全部段的提问必须渲染在末段之后。

#### 场景：一轮多问时序还原

- Given 一轮含 text 段 A（t=1000）、text 段 B（t=3000），期间 agent 在 t=2000 提问一次（已答）
- When 对话视图渲染该轮
- Then DOM 顺序为 段A → ❓ 块 → 段B（不再 ❓ 块整组出现在 agent 回复之前）

#### 场景：仅有提问无对话段

- Given 一轮无对话段但有已答提问
- Then ❓ 块仍渲染（旧行为的块不依赖段存在）

### FR-02: 问答块视觉样式逐字不变（复用同一标记），仅位置变化

- ❓ 块的标记（类名/文案/❓ → 作答格式/待答未答文案）必须与原实现逐字一致（抽出 `DialogQaBlock` 组件复用，新增 `data-testid="dialog-qa-block"` 供测试定位不改视觉）；旧回退路径（`segments === undefined` 的孤儿轮/旧数据）必须保持旧行为渲染同款块。

#### 场景：回退路径不回归

- Given segments undefined 的旧数据轮 + 已答提问
- Then ❓ 块按旧位置渲染，块样式与 v2 路径一致

### FR-03: 全部视图穿插行为零改动

- 「全部」视图既有 AskUser 工具卡时间线穿插（`timeline` memo）必须零改动；对话视图的轻量 ❓ 块不得在「全部」视图双画。

#### 场景：全部视图无双画

- Given 同一轮在「全部」视图渲染
- Then 无 `dialog-qa-block`（AskUser 走工具卡路径）

### FR-04: 既有对话/弹窗相关测试全部保持通过

- `session-panel-dialog.test.tsx`（含 AC-10-01b「按 run_id 穿插到对应 turn」、AC-10-01c 视图切换）、`turn-timeline-dialog-minimize.test.tsx`、`turn-timeline-conversation-file-card.test.tsx`、`turn-time-display.test.tsx`、`session-history-scroll.test.tsx` 必须全部通过；前端 `tsc --noEmit` 必须零错。

#### 场景：回归

- Given 本次改动合入
- When 运行上述测试文件与类型检查
- Then 全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/turn-timeline-dialog-inplace.test.tsx「两段之间的提问渲染在两段之间（created_at 落在段时刻中间）」
FR-02: frontend/src/components/daemon/__tests__/turn-timeline-dialog-inplace.test.tsx「旧回退路径（segments undefined）：❓ 块仍渲染，不回归」
FR-03: frontend/src/components/daemon/__tests__/turn-timeline-dialog-inplace.test.tsx「「全部」视图：轻量 ❓ 块不双画（AskUser 走工具卡路径）」
FR-04: frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx「AC-10-01b 提问记录按 run_id 穿插到对应 turn（不堆顶）(ql-20260802-001)」
