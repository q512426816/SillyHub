---
author: qinyi
created_at: 2026-09-22 20:11:04
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机

sillyspec CLI 侧 watcher/哨兵（detached 观测旁路，3.29.x 起）已向 `{platform.url}/api/changes/{name}/events` 持续推送 provisional 事件（POST JSON：kind/stage/detail/ts/provisional:true 等字段，Bearer shpsync_ token 鉴权），但平台侧端点不存在，推送恒 404 静默丢失。变更执行期的旁路观测信号（产物出现/checkbox 翻格/新提交/质量扫描/规则告警）在平台面板上没有展示面，用户在面板侧看不到执行期动态与 warning 线索。

## 关键问题

1. 推送 404：watcher 是 best-effort（本地 jsonl 兜底），平台端点缺失导致观测信号只在 CLI 本机留档，面板零感知。
2. 无消费端存储：平台没有事件类 append-only 表，无法支撑幂等去重与增量拉取。
3. 无展示面：变更详情页只有流程真相区（步骤时间线/审批卡），没有旁路观测信号的只读展示区。

## 变更范围

- 后端（backend/app/modules/platform_sync/）：新表 `platform_change_events` + alembic 迁移 + `POST /api/changes/{name}/events`（批量收+去重+上限修剪，仅 shpsync_ 可写）+ `GET /api/changes/{name}/events?since=<iso>`（正序+增量，读 scope）+ pytest 五组。
- 前端（frontend/）：变更详情页 aside 新增「观测事件」折叠区组件（30s 轮询、warning 琥珀高亮、provisional 徽标、角标计数）+ vitest 四组 + gen:types 产物。

## 不在范围内（显式清单）

- 不做 SSE 推送通道（/sessions/events 先例留作后续可选升级）
- 不做事件触发的通知/告警联动/审批门控（provisional 只展示不消费，红线）
- 不改 sillyspec 工具侧任何代码（只动平台仓）
- 不做跨变更事件聚合页/事件检索

## 成功标准（可验证）

- 本地 dev 后端 curl 模拟 watcher 推 5 条（含 2 条 severity=warning）→ GET 回来时间正序且去重；面板显示告警琥珀高亮与 provisional 徽标。
- pytest 五组（收/取/去重/鉴权/上限）通过；vitest 四组（渲染/告警高亮/空态/角标计数）通过；tsc/mypy/ruff 全绿。
- 事件全链路（存储/读取/展示）零业务判定逻辑。
