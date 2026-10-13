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
