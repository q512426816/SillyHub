---
author: qinyi
created_at: 2026-08-16 08:02:00
plan_level: full
---

# 实现计划（Plan）— 责任人来源 token + 履历事件时间线

## Wave 1（后端数据模型与写入侧，内串行：task-01 → task-02）
- [x] task-01: `ChangeEventORM` 模型（change_events 表：event_type/detail JSONB/workspace 隔离/复合索引）+ 建表 migration（migration 落 **backend/migrations/versions/**（alembic.ini script_location=migrations，非 alembic/）；**execute 时实测 `alembic heads` 定 down_revision，防并行变更撞号**）（覆盖：FR-02, D-002@v1）
- [x] task-02: platform_sync 写入侧——router `push_progress` 传真实 User id（`_user` 不再丢弃）+ service `_sync_change_owner`（savepoint 原子：SELECT 重查行 + UPDATE owner + INSERT 事件；None 首填不记事件 / 不同则更新+记事件 / 相同幂等零写；**幂等口径=owner_id 现值复查，不加唯一约束（Grill note①）**；失败仅回滚 savepoint+log）+ 测试 test_owner_sync.py（首填/变化/幂等含 A→B→A/占位行 race-lost/失败容错）（覆盖：FR-01, D-001@v1；依赖 task-01）

## Wave 2（契约层，依赖 Wave 1）
- [x] task-03: schema 增量——StepTimelineEntry 加 kind("step"|"event")/event_type、ChangeSummary/ChangeRead 加 owner_name（全 optional）+ gen:types 重生成（backend/openapi.json + frontend/src/lib/api-types.ts 同 commit；design §6 漏列 openapi.json 由本 task 认领）（覆盖：FR-03/FR-04 契约层；依赖 task-01,02）

## Wave 3（读侧投影 ∥ 前端，均依赖 task-03 契约，文件不相交可真并行）
- [x] task-04: 读侧投影（backend）——enrich 两函数批量一次 IN 查 users 填 owner_name（display_name 优先，R-03 禁 N+1 测试锚定查询次数）；时间线合成事件（change_events IN 查询→事件条目转换 name=责任人变更 output=A→B/stage 用 stages.started_at 归一化近似/混合序列统一重编 ordering 保证 key 唯一）；**Phase 2.4：output 截断点从明细透传处（service.py:1688）挪到列表摘要 current_step_desc 赋值处——明细全量/摘要仍 ~200 截断两层分离（同步修 schema.py:55 与 timeline 注释中的"截断 200 字"旧表述）**+ 测试（合成排序/事件转换/stage 近似/**长文本全量透传+摘要仍截断用例（Grill note②）**）（覆盖：FR-03/FR-04/FR-05, D-003@v1, D-004@v1；依赖 task-03）
- [x] task-05: 前端——列表 owner 列 owner_name 优先（fallback UUID 8 位/—）+ ChangeStepTimeline 支持 kind=event 条目（👤 紫色 chip 样式，emoji dot）+ **明细 line-clamp-2 移除改自然换行 break-words（max-h 容器滚动兜底）**+ 测试（事件渲染/混合排序回归/纯 steps 零变化/**长文本不 clamp 用例（Grill note②）**）（覆盖：FR-03/FR-04/FR-05, D-003@v1, D-004@v1；依赖 task-03）

## Wave 4（回归收口，依赖 Wave 3）
- [x] task-06: 全量回归——backend pytest 全量 + frontend vitest 全量 + tsc 0 + 双用户上行冒烟（经 POST /api/workspaces/{id}/platform-sync-tokens（workspace_router.py:87-114）为两个用户各签一枚 shpsync_ token，先后上行同一变更→owner 为后者+时间线出现 A→B 事件；同用户重复上行零新事件）（覆盖：FR-01~05 集成验证；依赖 task-04, task-05）

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 模型+migration | W1 | P0 | — | FR-02, D-002 | 新表+两索引；heads 实测 |
| task-02 | 写入侧+测试 | W1 | P0 | task-01 | FR-01, D-001 | savepoint 范式；幂等=现值复查 |
| task-03 | schema+gen:types | W2 | P0 | task-01,02 | FR-03/04 | 全 optional；两产物同 commit |
| task-04 | 读侧投影+测试 | W3 | P0 | task-03 | FR-03/04/05 | users/events 两次 IN；截断挪摘要赋值处两层分离；长文本用例 |
| task-05 | 前端+测试 | W3 | P0 | task-03 | FR-03/04/05 | 事件样式；不 clamp；长文本用例；与 task-04 并行 |
| task-06 | 全量回归+冒烟 | W4 | P0 | task-04,05 | FR-01~05 | 双 token 冒烟清单 |

## 关键路径
task-01 → task-02 → task-03 → task-04 ∥ task-05 → task-06（W3 真并行缩短关键路径）

## 全局验收标准
- [ ] 双用户上行：owner 对齐最新 token 用户 + 时间线出现 owner_change 事件（detail 含 from/to）
- [ ] 同用户重复上行零新事件（幂等）；首填（None）无事件
- [ ] 列表/详情显示用户名（display_name 优先）；未上行变更降级 —
- [ ] 时间线事件条目专属样式 + 按时间序插入 + key 无撞车
- [ ] 履历明细全量展示（长文本用例过）；列表摘要仍截断
- [ ] backend 全量 pytest + frontend vitest 全绿 + tsc 0 + gen:types 重生成
- [ ] （brownfield）X-SillySpec-User/last_pusher 行为零变化；kind 默认 step 旧契约不受影响

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-02, task-06 | 写入侧三分支测试 + 双 token 冒烟 |
| D-002@v1 | task-01 | 表结构通用（event_type+detail）|
| D-003@v1 | task-04, task-05 | 合成排序测试 + 事件样式渲染测试 |
| D-004@v1 | task-04, task-05 | 后端全量透传/摘要截断分离测试 + 前端不 clamp 用例 |
| FR-01 | task-02, task-06 | 三分支测试 + 冒烟 |
| FR-02 | task-01 | 表结构 + migration |
| FR-03 | task-03, task-04, task-05 | 契约+合成+渲染三层 |
| FR-04 | task-03, task-04, task-05 | owner_name 契约+投影+展示 |
| FR-05 | task-04, task-05 | 截断分离测试 + 不 clamp 测试 |
