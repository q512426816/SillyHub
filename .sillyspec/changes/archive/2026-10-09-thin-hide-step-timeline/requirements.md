---
author: flow-machine-draft
created_at: 2026-10-09T04:10:52.133Z
---
# 需求规格（Requirements）— 2026-10-09-thin-hide-step-timeline

## 功能需求

### FR-01: thin 出身变更（isThinLineageChange 判定）详情页不再渲染「步骤时间线」卡，含归档补种 steps 场景

- thin 出身变更的详情页（桌面 `changes/[cid]/page.tsx` 与移动端 `mobile-change-detail.tsx`）必须不渲染「步骤时间线」卡——thin 流程子步不落 sillyspec.db，steps 里唯一的 数据是归档时 CLI `unregisterChange` 终态一致化补种的 3 行同一时间戳步骤（decision-distill / extract-module-impact / 确认归档），对 thin 属零信息量噪音；判定必须复用页面既有单一谓词 `isThinLineageChange`（与顶部轻量流程条、后端 `_is_thin_lineage` 三分支口径一致），禁止另造「补种行特征」启发式。

#### 场景：归档 thin 补种 steps

- Given 归档后的 thin 出身变更（current_stage=archived / change_type=feature、steps 为 3 行 stage=archive 补种步骤、created_at ≥ 2026-09-25）
- When 打开变更详情页
- Then 「步骤时间线」卡整卡不渲染；「真实留痕时间线」卡照常渲染（事件轴 × 任务面 × 墙钟）

#### 场景：在途 thin

- Given 在途 thin 变更（current_stage=thin、steps 为空或缺失）
- When 打开变更详情页
- Then 「步骤时间线」卡不渲染（原有 steps 空降级语义自然覆盖，行为不变）

### FR-02: 非 thin 厚变更步骤时间线卡行为不变，仍正常渲染 steps 明细

- 非 thin 出身的厚变更（steps 含标准四阶段痕迹 / current_stage 为标准阶段 / 分流时间窗外）详情页「步骤时间线」卡必须保持既有行为：steps 非空即渲染明细，steps 缺失或空数组降级不渲染；本变更禁止影响厚变更任何既有渲染路径。

#### 场景：厚变更带 steps

- Given 厚变更（steps 含 stage=brainstorm/execute 等标准阶段明细）
- When 打开变更详情页
- Then 「步骤时间线」卡照常渲染 steps 明细（与 2026-08-15-change-step-visibility task-07 行为一致）

### FR-03: 真实留痕时间线卡恒挂载行为不变（2026-09-27-timeline-coexist 共存语义保留）

- 「真实留痕时间线」卡（ChangeTimelineCard）必须保持恒挂载语义（2026-09-27-timeline-coexist）：组件自身 events/tasks/born 全空时静默隐藏；本变更只隐藏「步骤时间线」卡，禁止改动真实留痕卡的挂载条件与取数行为。

#### 场景：厚变更归档双卡共存

- Given 归档厚变更（steps 非空含标准阶段痕迹 + 观测事件流有数据）
- When 打开变更详情页
- Then 「步骤时间线」卡与「真实留痕时间线」卡两卡同时渲染（共存语义不回潮互斥）

### FR-04: 相关前端测试更新并通过（仅跑改动相关测试，不跑全量）

- 本变更必须更新受语义影响的既有测试（page-restore-assets 共存用例按新语义翻转）并补充薄厚两侧钉子用例；测试运行必须仅覆盖改动相关文件（本页测试 + 移动端详情页测试 + 步骤时间线组件测试），禁止跑全量（全量留给 CI）。

#### 场景：定向测试

- When 实现完成后运行改动相关 vitest 文件
- Then 全部用例通过，且既有厚变更用例（page-team-toggle / page-last-signal）零改动零回归

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx「共存→隐藏（2026-10-09-thin-hide-step-timeline）：归档补种 steps 的 thin 变更步骤时间线卡不渲染，真实留痕时间线卡保留」
FR-01: frontend/src/components/mobile/mobile-change-detail.test.tsx「归档 thin（stage=archived + steps 无标准四阶段痕迹）→ 轻量说明卡而非「无可审批」（+ 阶段时间线卡缺席断言）」
FR-02: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx「change.steps 有明细 → 渲染 ChangeStepTimeline 区块（时间线卡片 + 组件挂载）」（零改动零回归钉子）
FR-02: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx「共存（厚变更）：steps 含标准阶段痕迹 + 观测数据 → 步骤时间线卡与真实留痕时间线卡双卡渲染」
FR-03: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx「FR-03（2026-09-26-change-real-timeline）：steps 为空时主线挂载真实留痕时间线卡」（零改动零回归钉子）
FR-04: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx「本文件全部用例（vitest run 定向）」
