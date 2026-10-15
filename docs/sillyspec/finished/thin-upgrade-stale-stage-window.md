# thin 升厚后上行阶段误标短窗（sillyspec 工具改进点，2026-10-13）

状态：活跃坑（待工具后续处理）

## 现象

sillyspec CLI 的 `serializeForSync`（2026-10-13-thin-sync-stage 起）对 tier=thin 且行 status=active 的变更把上行 `current_stage` 投影为 `'thin'`。但本地行值本身仍可能是历史推拉往返写进来的 `'thin'`（平台 pull import 对 current_stage 零校验，progress.js import() 原样回写）。

若该变更此后**升厚**（flow-state tier 翻 thick，升厚链只改 flow-state 不重置 DB 行值），在首次真实 `run <stage>` 按阶段机重写行值之前，上行载荷会按行值持续报 `'thin'`——平台读侧 `is_thin` 判定把它误标为轻量出身，短窗内归档后徽章也会残留。

## 根因

- progress.js `import()` 对 `changes[].current_stage` 无白名单校验（既有语义，往返透传设计）。
- 升厚动作（`--upgrade-thick`，flow.js）只写 flow-state.yaml，不触碰 DB changes 行。

## 影响

纯展示面（平台「轻量」徽章/筛选），无数据正确性风险。自愈路径：升厚变更跑任一 `run <stage>` 即重置行值。

## 可能的修复方向（供后续变更采纳）

- import() 回写前对 current_stage 做合法值收口（辅助阶段 thin 不回写行值），或
- 升厚链显式重置行值（`current_stage='brainstorm'`）。

## 关联

- 修复变更：sillyspec 仓 `2026-10-13-thin-sync-stage`（已归档，review P3-2 留档）。
- 平台侧消费：`backend/app/modules/change/service.py` `_is_thin_lineage`（分支① stage=thin）。

## 处置记录（2026-10-14）

**已修（方向②）**（sillyspec 仓工作树，未提交）：新增 `resetThinStageRowOnUpgrade`
helper（node:sqlite 直写，零依赖 ProgressManager）并在两个升厚写点接线——verify 实测
失败自动升厚 + distill 异态升厚。行 current_stage='thin' → 'brainstorm'（厚档起点，
与 run 阶段机首写同值）；非 thin 行值不动（不越权重置）；best-effort 不阻断升厚链。
方向①（import() 回写白名单收口）不采纳——往返透传是既有设计语义，动它影响面大。

**测试**：`test/thin-upgrade-stage-reset.test.mjs` 2/2——① e2e（模拟 pull 往返写入
'thin' → lint 门 FAIL 升厚 → 行值重置 + 日志在场）；② resume 路径不碰行值（重置只在
升厚写点）。flow 族回归 33/33 绿。归档。
