---
author: qinyi
created_at: 2026-08-16 15:10:00
---

# 验证报告 — 2026-08-16-change-owner-from-token

## 结论
PASS WITH NOTES（无 integration/deployment-critical 关键词——纯后端写入扩展+读侧投影+前端展示，不涉 daemon/session/lease/lifecycle 状态转换；3 条 P2 观察不阻断）

## 任务完成度
6/6 task 完成（execute 7 commit 526f4f8f..e159a8d2，主仓交付 e592eb5c 29 文件）。plan 全局验收 7 条逐条实证：
1. 双用户上行 owner 对齐 B + 恰 1 事件 detail from/to 逐字（冒烟 e2e 四断言）→ PASS
2. 同用户幂等零事件 + A→B→A 交替仅 2 事件 + 首填无事件（test_owner_sync 三分支）→ PASS
3. 列表/详情用户名（display_name 优先）+ 未上行降级 —（后端 2 测试 + 前端三态）→ PASS
4. 事件条目样式 + 时间序插入 + ordering 重编 key 无撞车（test_merge_event_entries + 前端三用例）→ PASS
5. 明细全量 + 摘要截断（500/200 字两层分离用例）+ 前端不 clamp → PASS
6. 全量 pytest + vitest + tsc 0 + gen:types 一致 → PASS
7. brownfield：last_pusher=header 字符串、kind 默认 step、六旧字段形状不变 → PASS

## 设计一致性
design §5/§6/§7 与实现逐字一致：_sync_change_owner 三分支+savepoint 范式；ChangeEventORM 七字段+两索引无唯一约束+migration 单 head（20260816120000 接 d7a1f5c2b9e4）；_merge_event_entries 合成（stage 归一化近似+组内插序+统一重编 ordering）；owner_name 批量一次 IN（查询次数锚定：列表 users 1/events 0，详情 users 1/events 1）；截断两层分离（明细全量/摘要 200）；前端 owner 三态+事件专属渲染（data-kind=event 锚点）+ 无 line-clamp 滚动兜底。D-001~D-004 全落地。

## 探针结果
双用户上行冒烟以真实鉴权链 e2e 测试交付（A→B→B 三次 POST /api/changes/{name}/progress）：owner 对齐/事件留痕/幂等/brownfield 四断言全过。迁移预检：upgrade/downgrade 对称跑通（临时 SQLite，已清理）。

## 测试结果
- backend 目标套：40 passed（test_owner_sync 5 + 冒烟 e2e 1 + step_progress 34，verify 实跑复现）
- backend 模块级：platform_sync + change 424 passed/2 skip（verify 实跑，含查询次数锚定）
- backend 全量：4397 passed/6 skip/3 xfail（task-06 execute 实跑，当日基线）
- frontend：timeline 12 + page 26 = 38 passed（verify 实跑）+ 全量 1588（task-06）+ tsc 0

## 变更风险等级
低。新表 append-only 无破坏；写入侧 best-effort（savepoint 失败不阻断上行）；读侧全 additive optional；header 语义零变化；migration 单头。

## Runtime Evidence
不适用（非 integration/deployment-critical）。迁移在真实 PG 的首次执行验证留部署后（`\d change_events` 抽验 JSON 列），execute 已用 SQLite 预检 upgrade/downgrade。

## P2 备注（不阻断，随部署/后续收敛）
1. api-types.ts kind 生成必填（openapi-typescript 对 default 字段惯例，运行恒输出、组件判空兜底，非手写）。
2. R-01 并发双发短期重复事件（design 已声明可接受，现值复查拦截同值重试）。
3. _sync_change_owner 末尾 commit 在 try/except 外（与 _ensure_change_row 既有范式同构，非新增风险）。
