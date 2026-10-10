# fourpiece-init 写 UTC 致时间线「变更诞生」锚偏 8 小时（sillyspec CLI）

> 记录时间：2026-10-09 · 来源：平台侧变更详情「真实留痕时间线」显示异常排查（2026-10-09-workspace-init-skill-gate 实证）
> 状态：活跃坑（已修于 sillyspec 仓 `2026-10-09-fourpiece-created-at-local`（commit 8c87cf28，src/index.js fourpiece-init `fpStamp` 改 `datetime.js nowWallClock()`）；待 sillyspec 发版且 daemon 升级门控放行后生效，生效前新初始化产出的骨架仍带 UTC 戳）

## 事实（2026-10-09 实证）

- 平台时间线「🌱 变更诞生」显示 `10-09 02:04:06`，真实诞生为本地 `10:04:06`（watcher 事件流 `requirements.md 出现` @10:04:08 佐证）。
- 同一变更内两种时间基并存：requirements.md / proposal.md（fourpiece-init 产出）`created_at: 2026-10-09 02:04:06`（UTC）；design.md（design-init 产出）`created_at: 2026-10-09 09:58:48`（本地，正确）。

## 根因（sillyspec CLI）

- `sillyspec fourpiece-init` 骨架 frontmatter `created_at` 用 `new Date().toISOString().slice(0,19)` 写 **UTC 数字的裸形状**（无时区标记）。项目约定（sillyspec 仓 `src/datetime.js` 头注，坑 `taskcard-created-at-utc` 2026-08-23）：frontmatter 人读时间字段统一本地墙钟——taskcard 与 design-init 均已改 `nowWallClock()`，fourpiece-init 是漏网点。
- 读取链不自愈：平台 `_read_born_at`（backend timeline.py）原样透传无时区串，前端 `new Date("…")` 按浏览器本地解析 → UTC 值被当本地直接显示，偏时区数（实证机 -8h）。

## 影响面与存量数据

- 生效前所有新 fourpiece 骨架的 `created_at` 均为 UTC；存量变更（含 2026-10-09-workspace-init-skill-gate）时间线 born 锚持续显示偏移值——历史工件不改写（变更事实以 watcher 事件流为准），接受旧值。
- 附带发现（已修于 sillyspec 仓 `2026-10-09-module-card-updated-at-iso`，同样待发版）：`src/module-impact.js:158` 用 `toISOString().slice(0,19) + '+08:00'`——UTC 数字拼 +08:00 偏移后缀，解析瞬间恒早 8h（机器无关），已改全量 `toISOString()`。

## 关联

- 平台侧同源缺陷（勾选时刻推断丢 stage 白名单）已于本仓 `2026-10-09-timeline-tick-stage-filter` 修复——那是平台移植遗漏，非 CLI 缺陷。
