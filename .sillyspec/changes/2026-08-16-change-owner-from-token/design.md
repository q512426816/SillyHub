---
author: qinyi
created_at: 2026-08-16 07:22:00
scale: large
risk_level: unit-sufficient
---

# 设计文档（Design）— 变更责任人来源 token 身份 + 履历事件时间线

## 1. 背景

变更中心的责任人（`ux_changes.owner_id`）当前仅 change_writer 代理写路径填充；reparse 建行恒 None（service.py:1744），进度上行不触碰。列表页只显示 owner_id UUID 前 8 位（page.tsx:274-279），无人类可读名字；责任人在多 agent/多用户协作中交接后平台无感知、无记录。

关键实证：进度上行端点 `push_progress` 的鉴权依赖 `require_platform_sync_write` **已经派生出 token 签发人的真实 User 对象**（auth.py:129，shpsync_ token → `(user=created_by, workspace_id)`），但 router 把 `_user` 丢弃（router.py:95），只用 header 字符串写 `last_pusher`。责任人的最可靠来源已经在手里。

用户需求：①每次同步到平台后责任人变了就以最新为准；②在履历进度（步骤时间线）中展示责任人变化信息；③独立建事件表——后续还有很多事件类型要进履历（扩展性为显式要求）。

## 2. 设计目标

1. owner 来源 = 进度上行 token 签发人：每次 push_progress 接受时 diff 更新 `ux_changes.owner_id`，最新为准。
2. 变化留痕：owner 变化写入通用事件表 `change_events`（首类事件 `owner_change`），同事务保证一致。
3. 履历展示：步骤时间线合成事件条目（按时间序插入，专属样式区分），显示"A → B"。
4. 可读展示：列表/详情显示用户名（display_name 优先，username fallback），修掉 UUID 前 8 位问题。
5. 扩展性：`event_type` + JSONB `detail` 通用模型，后续事件类型（审批/阶段推进/归档…）零 schema 变更接入。

## 3. 非目标

- 不改 sillyspec CLI / daemon（token 身份平台侧已可解析）。
- 不做 owner 手工指派 UI（后续需求另立项）。
- 不回填历史 owner（存量变更 owner 仍为 None，首次上行后自然填充）。
- 不做事件表的管理/删除接口（append-only）。
- 不在本变更实现 owner_change 之外的事件类型（只留扩展点）。

## 4. 拆分判断

单一功能横切 backend（platform_sync/change）+ frontend（列表/时间线），一个变更交付；不拆分、无批量模式。

## 5. 总体方案

### Phase 1：数据模型 + 写入侧

1. 新表 `change_events`（SQLModel `ChangeEventORM`，backend/app/modules/change/model.py）：
   - `id` UUID PK / `workspace_id` UUID（隔离，对齐 platform_change_progress 复合键语义）/ `change_id` UUID FK→ux_changes / `event_type` varchar(50) / `detail` JSONB / `created_by` UUID（触发者=token 用户）/ `created_at` timestamptz。
   - 索引：`(change_id, created_at)`（时间线合成查询）、`workspace_id` 普通索引。
   - Alembic migration 一条（新表，无列变更风险）；down_revision 接当前唯一 head（execute 时实测 `alembic heads` 防并行变更撞号）。
2. `PlatformSyncService.push_progress` 链路加 `_sync_change_owner(session, workspace_id, change_name, user_id)`（platform_sync/service.py）。**事务边界（Grill P1-2 修正）**：在 `_apply` 与 `_ensure_change_row` 完成后调用（两者内部各自 commit，现状=独立已提交单元，不强求同事务）；函数体内 `begin_nested` savepoint 内原子执行（SELECT 重查 Change 行拿 id——`_ensure_change_row` race-lost 路径不返回行对象 + UPDATE owner + INSERT event），失败仅回滚 savepoint + log.warning 不阻断（与 `_ensure_change_row` :239-249 范式同构，进度主数据永不被 owner 失败吞掉）：
   - `owner_id is None` → UPDATE 为 token 用户（**不记事件**——占位行首填非"变化"）；
   - `owner_id != token用户` → UPDATE + INSERT `change_events(event_type='owner_change', detail={'from_user_id': old, 'to_user_id': new}, created_by=new)`；
   - 相同 → 幂等跳过（零写，owner_id 现值判据已天然拦截同值重试与 A→B→A 交替中的重复段）。
3. router 层：`push_progress` 把鉴权 tuple 里的真实 User id 传给 service（`_user` 不再丢弃）；`X-SillySpec-User` header → `last_pusher` 既有行为不变（兼容）。

### Phase 2：读侧投影 + 契约

1. `enrich_summaries` / `enrich_with_workspace_ids` 批量填 `owner_name`：owner_id 集合一次 IN 查 users（display_name or username），映射填充（与 `_project_current_stage` 同款批量模式，R-03 禁 N+1）。ChangeSummary/ChangeRead 加 `owner_name: str | None` optional。
2. 时间线合成：`enrich_with_workspace_ids` 在 `_extract_step_progress` 产出 steps 后，批量查 `change_events`（change_id IN），把 `owner_change` 事件转成时间线条目：
   - `StepTimelineEntry` 加 `kind: str = "step"`（"step" | "event"）与 `event_type: str | None = None` optional 字段；
   - 事件条目：`name="责任人变更"`、`output="A → B"`（A/B 为用户名，join users 批量取）、`status="completed"`、`completed_at`=事件时间 ISO、`stage` 取该时刻所属阶段的近似值（用事件 created_at 与 stages started_at 对齐——CLI 六表上行含 started_at（progress.js:453 实证），归一化复用 `_normalize_completed_at`，落在最近一个已开始 stage；无法判定时用当前 stage）；
   - 排序（Grill P1-1）：事件按 `completed_at` 时间序插入 steps 序列后，**对最终混合序列统一重编 ordering**（0..n-1 顺序号）；前端 entry key 沿用 `${stage}-${ordering}` 不撞车（事件 key 由重编后 ordering 保证唯一；排序键三元组 `(stage_group 序, ordering, completed_at)` 稳定排序）。
3. `pnpm gen:types` 重生成（owner_name + kind/event_type 新字段，additive）。

### Phase 2.4：履历内容不截断（用户追加需求，Grill P1-3 归属本变更）

用户要求「履历中内容太长不要截断，有什么展示什么」。现状两层截断均针对时间线条目（step-visibility R-02 决策），修订为：
- 后端：`_extract_step_progress` 的 output 截断 200 字**移除**（StepTimelineEntry.output 全量透传）；**列表页摘要 current_step_desc 截断保留**（~200B/行是列表接口性能契约，本条边界不动）；
- 前端：`change-step-timeline.tsx` 的 `line-clamp-2` 移除，改自然换行 + `break-words`；
- 归属理由：同一组件同一展示面；step-visibility 已归档无法追加；改动文件正落在本变更清单内。step-visibility 的 R-02 由本变更修订（截断仅保留在列表摘要层）。

### Phase 3：前端

1. 列表页 owner 列：`owner_name` 优先，fallback 现状（UUID 前 8 位/—）。
2. `ChangeStepTimeline` 组件支持 `kind="event"` 条目：👤 紫色 chip 样式（对齐原型 .owner-chip/.owner-event），name/output 渲染同现有字段，dot 用 emoji 替代色点；`kind="step"` 走现有渲染零变化。
3. 组件测试：事件条目渲染/混合排序/纯 steps 无事件不渲染事件样式（回归）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/change/model.py | 新增 ChangeEventORM（change_events 表） |
| 新增 | backend/migrations/versions/2026xxxx_add_change_events.py | 建表 migration（表+两索引；migrations 目录为 alembic.ini script_location 实际目录） |
| 修改 | backend/app/modules/platform_sync/service.py | 新增 `_sync_change_owner`（diff+事件写入，best-effort）；upsert_progress 接受分支调用 |
| 修改 | backend/app/modules/platform_sync/router.py | push_progress 传真实 User 给 service（`_user` 不再丢弃） |
| 修改 | backend/app/modules/change/schema.py | StepTimelineEntry 加 kind/event_type；ChangeSummary/ChangeRead 加 owner_name（全 optional） |
| 修改 | backend/app/modules/change/service.py | enrich 两函数批量 join users 填 owner_name；时间线合成事件条目；Phase 2.4 移除明细 output 截断（列表摘要截断保留） |
| 修改 | frontend/src/lib/api-types.ts | gen:types 重生成 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx | owner 列 owner_name 优先渲染 |
| 修改 | frontend/src/components/changes/detail/change-step-timeline.tsx | kind=event 条目专属样式；Phase 2.4 移除 line-clamp-2 改自然换行 |
| 修改 | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | 事件条目测试 |
| 新增 | backend/app/modules/platform_sync/tests/test_owner_sync.py | 写入侧测试（首填/变化/幂等/占位行/失败容错） |
| 新增 | backend/app/modules/platform_sync/tests/test_owner_smoke_e2e.py | 双用户上行冒烟 e2e（task-06 交付物：A→B→B 三连推断言 owner 对齐/事件留痕/幂等/brownfield） |
| 修改 | backend/app/modules/change/tests/test_step_progress.py | 时间线合成测试（混合排序/事件转换/stage 近似） |

## 7. 接口定义

```python
# model.py
class ChangeEventORM(BaseModel, table=True):
    id: uuid.UUID (PK)
    workspace_id: uuid.UUID
    change_id: uuid.UUID (FK ux_changes.id)
    event_type: str          # 'owner_change' | 后续扩展
    detail: dict (JSONB)     # owner_change: {from_user_id, to_user_id}
    created_by: uuid.UUID | None
    created_at: datetime

# schema.py 增量（全 optional）
StepTimelineEntry.kind: str = "step"        # "step" | "event"
StepTimelineEntry.event_type: str | None = None
ChangeSummary.owner_name: str | None = None
ChangeRead.owner_name: str | None = None
```

## 8. 数据模型

仅新增 `change_events` 表（见 §7）；ux_changes 零列变更（owner_id 已存在）；users 零变更。

## 9. 兼容策略（brownfield）

- 存量变更 owner_id=None：首次上行自动填充（不记事件）；无上行的保持 None → 前端降级现状展示（—）。
- 旧前端/旧 api-types：新字段全 optional 零影响；steps 条目 kind 默认 "step"，旧组件不读新字段渲染不变。
- 回退：事件表 append-only 无破坏；回退=前端不渲染事件条目（kind 过滤），后端字段闲置无害。
- `X-SillySpec-User` header / last_pusher 语义完全不变。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | push_progress 并发上行（同变更双发）产生重复 owner_change 事件 | P2 | owner_id 现值判据天然拦截同值重试与 A→B→A 交替中的重复段；并发双发撞 savepoint 由唯一约束/现值复查兜底，短期重复可接受（展示层可去重） |
| R-02 | 时间线合成排序：事件 created_at 与步骤 completed_at 跨时钟源（平台时钟 vs CLI 时钟） | P1 | 事件插序按 ISO 时间近似对齐；stage 归属用 stages started_at（六表上行实证含此字段）归一化对齐；混合序列统一重编 ordering 保证 key 唯一；边界视觉乱序可接受（不阻断） |
| R-07 | 明细 output 放开截断后超长内容拖慢详情接口/撑爆布局 | P2 | 详情接口响应增大可接受（单变更 steps 量级小）；前端自然换行 + max-h 容器滚动兜底；列表摘要层截断不动（性能契约） |
| R-03 | enrich 批量 join users 的 N+1 | P1 | 一次 IN 查询（复用 _project_current_stage 模式），测试锚定查询次数 |
| R-04 | owner 高频抖动（token 轮换/多 agent 不同身份交替上行）刷爆事件表 | P2 | 每次上行最多一条事件；R-01 幂等窗口天然限频；写入侧可再加同 to_user 短窗口去重 |
| R-05 | 占位行 owner 首填与 reparse 并发覆盖 | P2 | reparse `_apply_parsed` 不触碰 owner_id（现状即如此，:1765 注释），无覆盖路径 |
| R-06 | 事件 detail 含用户 ID 需 join users 出名字，两次 join（owner+events）放大查询 | P2 | 合并为一次 users IN 查询（owner_name 与事件 A/B 名字共用映射） |

## 11. 决策追踪

| 决策 | 版本 | 覆盖 |
|---|---|---|
| D-001@v1 owner=上行 token 身份最新为准 | accepted | §5 Phase 1 / §9 |
| D-002@v1 独立通用事件表（扩展性显式要求） | accepted | §5 Phase 1.1 / §2.5 |
| D-003@v1 履历=时间线合成事件条目 | accepted | §5 Phase 2.2 / Phase 3 |
| D-004@v1 履历明细不截断（用户追加；修订 step-visibility R-02） | accepted | §5 Phase 2.4 / R-07 |

## 12. 自审（Self-Review）

- ✅ 章节齐全；文件清单 12 项含数据流标注（token User → service diff → 表 → enrich → API → 前端）。
- ✅ 生命周期契约表：不涉及 session/lease/daemon 状态转换；push_progress 为既有端点行为扩展（同事务写两张表），判定无需该表。
- ✅ 性能：写入侧每次上行最多一次 SELECT + 一次 UPDATE + 一次 INSERT；读侧两次批量 IN（events + users 合并）；零 FS。
- ✅ 兼容：全 additive optional；占位行首填不记事件（语义准确）；header 行为零变。
- ⚠️ 自审存疑一项：R-02 时间对齐的跨时钟源问题——设计选择"近似插入+stage 近似归属"并声明可接受，若 Grill 认为不可接受需升级为专用排序策略（如事件挂载到下一个步骤之前）。
