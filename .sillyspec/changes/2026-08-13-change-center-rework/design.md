---
author: qinyi
created_at: 2026-08-13 09:41:17
scale: large
tier: independent
risk_level: unit-sufficient
---

# 设计文档（Design）— 变更中心列表页整体重做

> change: `2026-08-13-change-center-rework`
> 模块：`backend/app/modules/change` + `frontend/.../changes`
> 决策台账：见 `decisions.md`（D-001@v1 ~ D-008@v1）

## 1. 背景

变更中心列表页（`/workspaces/[id]/changes`）是用户管理 SillySpec 变更全生命周期的入口。经两个独立代理交叉核验 + 用户确认 + Design Grill 审查，当前页面存在以下问题（按收益排序）：

- **A（最高价值）「待我处理」信号缺失**：用户来这页最想问"哪些变更该轮到我处理了"（等 AI 跑完→人审核门控→触发下一步），但页面只有一个表格，得逐行扫"阶段"列猜。代码里预留了 `GATE_LABELS`（`page.tsx:48-59`）审核标签映射却从未接线——列表数据 `ChangeSummary` 不带 `pending_review`，`GATE_LABELS` 是详情侧误拷的孤儿死代码（注：详情 `ChangeRead.pending_review` 字段虽定义但实际恒 None，详情 READ 路径 `enrich_with_workspace_ids` 不调投影，详见 §8/D-008）。
- **B（纯前端高杠杆）**：① 默认排序是 `change_key` 字母序（`service.py:149`，无业务意义）；② 空状态（`page.tsx:420-424`）无引导 CTA。
- **C（低成本扫尾 6 项）**：进行中/已归档 tab 无计数；查询区 grid-cols-4 只填 2 格右半留白；"状态"列与"阶段"列信息冗余；"+新建变更"被降级为 outline 小按钮；表格无负责人列（`owner_id` 有字段没用）；副标题"← 组件列表"语义怪。
- **title 真空**：实测 sillyspec.db 105 条变更 title 82% 为空（仅 quick 有），列表大面积显示英文 change_key——但根因是 proposal.md 缺中文标题（sillyspec 流程问题），非平台问题（见 D-006）。

核验后**明确不做**的过度设计：顶部阶段分布统计看板（业界 Linear/GitHub/Jira/Vercel 列表页均不挂仪表盘）、每行 5 步进度条（列表行不画 stepper，且 `sillyspec-step-progress.tsx` 画的是单 stage 内子步骤不可复用）。

## 2. 设计目标

- **G1**：进变更中心第一眼就能看到"哪些变更待我处理"（球在用户这边的），按最近活动排序，每行标清待哪种审核。
- **G2**：列表信息架构维度统一、不混淆（待我处理 ⊂ 进行中，不并列 tab）。
- **G3**：清理 6 项低成本毛病 + 删死代码，提升可扫描性与信噪比。
- **G4**：后端给列表层喂 `pending_review`，零数据库 migration，**走 PG 进度镜像 `latest_progress` + 复用 `_map` 纯函数**（D-008，不读 sillyspec.db）。

## 3. 非目标

- **NG-01**：不做顶部阶段分布统计看板 / KPI 仪表盘（过度设计）。
- **NG-02**：不做每行 5 步进度条 / stepper（详情页职责）。
- **NG-03**：不改详情页 `changes/[cid]/page.tsx` 及其子组件（审核/触发仍走详情页，D-001）。
- **NG-04**：平台不加工/兜底/编造 title（D-006，title 归 sillyspec/proposal.md）。
- **NG-05**：不引入 assignee 指派审核人（D-002，现有模型无此概念，属另一 change）。
- **NG-06**：不做行内就地审核/触发（D-001，仍点进详情页）。
- **NG-07**：不收敛 StatCard 公共组件（本次不引入统计卡，YAGNI）。

## 4. 拆分判断

单一 change，不拆分、不走批量。理由：所有改动围绕"变更中心列表"这一内聚主题，前后端联动但范围明确（列表投影 + 列表页重做）。虽跨 backend/frontend 两子项目，但无 3+ 独立可交付模块、无多角色权限视图、无跨页面状态流转，不满足拆分阈值。

## 5. 总体方案

分 4 个 Phase（execute 阶段映射为 Wave）：

### Phase 1 · 后端：ChangeSummary 加 pending_review + 排序（零 migration，走 PG 镜像）
- `ChangeSummary` schema 加 `pending_review: str | None`。
- **走 PG 镜像路线（D-008，不读 sillyspec.db）**：列表 `_project_current_stage`（`service.py:1266`）已在批量 join `platform_change_progress.latest_progress`（serializeForSync 六表 JSON）读 current_stage；本次扩展为**同时解析该 JSON 的 `stages` 表 → 收集 `status=completed` 集合**，配合 current_stage 调 `StageProjectionService._map`（`projection.py:175` 纯函数静态方法）算 pending_review，填进 ChangeSummary。**pending_review 与 current_stage 同源自洽**（都来自 latest_progress），且**不依赖 sillyspec.db 可达性**（消除原 R-03）。
- list service 默认排序改 `updated_at DESC`，支持 `sort` 参数。
- list 支持 `pending_review` 非空筛选（待我处理）。

### Phase 2 · 前端 API + 类型
- `pnpm gen:types` 重生成 `api-types.ts`（ChangeSummary 多 pending_review）+ 同步 `openapi.json`。
- `lib/changes.ts` `listChanges` 加 `sort` + `pending_review` 筛选参数。
- 删 `page.tsx` 死代码 `GATE_LABELS`。

### Phase 3 · 前端列表页重做（核心，对齐原型方案①）
- 主 tab 维度统一为 location：**进行中 / 已归档**（D-007）。
- 「进行中」视图顶部一个聚焦开关 `☑ 只看待我处理(N)`，**默认勾上**（D-007）。
- 每行「待办状态」徽标（proposal_review/plan_review/human_test/archive_confirm/blocked），删冗余"状态"列。
- 排序：默认最近活动优先，列头可切。
- 加「负责人」列（owner_id）。
- 查询区 grid-cols-4 → grid-cols-2 消留白。
- 标题区："+新建变更"升主按钮；副标题改 workspace 名 + 计数。
- 空状态：分场景文案 + CTA。
- tab 挂计数。

### Phase 4 · 验收
- 后端 pytest（change 模块）：`_project_current_stage` 解析 latest_progress.stages + `_map` 算 pending_review、list 排序/筛选、ChangeSummary 字段。
- 前端 vitest：视图切换、徽标、空状态、tab 计数、聚焦开关；tsc 0。
- gen:types 同步核验。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/change/schema.py` | `ChangeSummary` 加 `pending_review: PendingReview \| None = None`。**数据流**：producer=`platform_change_progress.latest_progress`（PG 镜像，platform_sync 上行的 serializeForSync 六表 JSON）→ `service._project_current_stage` 批量 join 解析(current_stage+completed_stages) → `_map` 算 pending_review → `enrich_summaries` 填 ChangeSummary → router list_changes → consumer=`api-types.ts`（gen:types）→ `changes/page.tsx` 渲染徽标 |
| 修改 | `backend/app/modules/change/service.py` | `list`（~:149）默认排序 `change_key ASC` → `updated_at DESC`；加 `sort` 参数；扩展 `_project_current_stage`/新增 `_extract_completed_stages`（对齐 `_extract_current_stage:1298` 的防御式解析）从 latest_progress 解析 stages 表 completed 集合，`enrich_summaries` 调 `StageProjectionService._map` 填 pending_review；支持 `pending_review_only` 筛选 |
| 复用（不改） | `backend/app/modules/change/projection.py` | 仅复用 `StageProjectionService._map`（:175 纯函数静态方法）做 (current_stage, completed_stages)→pending_review 映射；**不新增 sillyspec.db 读取**（`compute_pending_review`/`_read_stage_progress_sync` 不用于列表 READ） |
| 修改 | `backend/app/modules/change/router.py` | list 端点加 `sort`、`pending_review_only` query 参数透传 service |
| 修改 | `backend/app/modules/change/tests/test_service.py` | `_project_current_stage` 解析 latest_progress.stages + `_map` 算 pending_review 的单元测试 |
| 修改 | `backend/app/modules/change/tests/test_router.py` | list 排序/筛选/pending_review 字段测试 |
| 重新生成 | `frontend/src/lib/api-types.ts` | `pnpm gen:types`，ChangeSummary 多 pending_review。**数据流**：backend dump openapi → openapi-typescript 生成 → 前端消费 |
| 修改 | `backend/openapi.json` | gen:types 同步产出，随本 change 提交 |
| 修改 | `frontend/src/lib/changes.ts` | `listChanges` 加 `sort?` / `pendingReviewOnly?` 参数透传 query |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx` | 重做：主 tab 进行中/已归档 + 待我处理聚焦开关(默认勾) + 待办徽标 + 排序 + 负责人列 + 查询区2格 + 空状态CTA + 新建主按钮 + 副标题；删 GATE_LABELS 死代码 |
| 修改/新增 | `frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/*.test.tsx` | 视图/徽标/聚焦开关/空状态测试；更新既有 page-team-toggle 测试 |

## 7. 接口定义

### 后端

```python
# projection.py — 仅复用，不改
StageProjectionService._map(current_stage: str | None, completed_stages: set[str]) -> PendingReview | None
# 纯函数 staticmethod（projection.py:175），按 D-004@v2 映射算 pending_review，不读 db

# service.py — 扩展现有 PG 镜像解析（对齐 _extract_current_stage:1298 防御式风格）
@staticmethod
def _extract_completed_stages(latest_progress: dict | None) -> set[str]:
    """从 latest_progress 的 stages 表解析 status='completed' 的 stage 集合。
    结构缺失/类型异常 → 返回空 set（调用方 fallback，不抛）。"""
# enrich_summaries：复用 _project_current_stage 批量 join 得 latest_progress，
# 解析 (current_stage, completed_stages)，调 StageProjectionService._map 算 pending_review。
# 零 sillyspec.db 依赖。
```

```python
# schema.py
class ChangeSummary(BaseModel):
    # ... 现有字段 ...
    pending_review: PendingReview | None = None  # 新增

# service.py list 签名增量
async def list(
    self, workspace_id, *, location, search, current_stage,
    sort: str = "updated_at_desc",  # 新增，默认最近活动优先
    pending_review_only: bool = False,  # 新增，待我处理筛选
    page, page_size,
) -> ChangeList:
    # ORDER BY updated_at DESC（默认）；构建后批量填 pending_review（PG 镜像+_map）
```

### 前端

```ts
// lib/changes.ts
listChanges(workspaceId, {
  location, search, currentStage,
  sort?,            // 新增 "updated_at_desc" 等
  pendingReviewOnly?,  // 新增
  page, pageSize,
})
```

### pending_review 取值与徽标映射（前端，替代死代码 GATE_LABELS）

| pending_review | 徽标 | 色 |
|---|---|---|
| `proposal_review` | 待提案审核 | warning |
| `plan_review` | 待计划审核 | warning |
| `human_test` | 待人工测试 | warning |
| `archive_confirm` | 待归档确认 | warning |
| (status=blocked) | 阻塞中 | error |
| None | （不显示徽标） | — |

## 7.5 生命周期契约表

**不涉及生命周期契约。** 本变更不新增/修改 session / lease / agent_run / daemon / lifecycle / state_transition / claim / heartbeat 任何事件。`pending_review` 是对 PG `platform_change_progress.latest_progress`（platform_sync 上行的 serializeForSync 六表镜像）的**只读解析 + `_map` 纯函数映射**，不改变任何运行时状态机；列表排序/筛选是只读查询。变更推进、审核提交仍走既有详情页 review 端点（不在本变更范围）。

## 8. 数据模型

- **`changes` 表（PostgreSQL）：不变。** 零 migration。`pending_review` 是计算字段（DTO 层），非持久化列。
- **`ChangeSummary` DTO：** 新增 `pending_review: PendingReview | None = None`（optional，brownfield 安全）。
- **数据源 = PG `platform_change_progress.latest_progress`（进度镜像）**：列表算 pending_review **不读 sillyspec.db**，读 platform_sync 上行的 `latest_progress`（serializeForSync 六表 JSON，含 `changes[0].current_stage` + `stages` 表；`platform_sync/model.py:39`、`service.py:1306`）。current_stage 列表早就在读这份镜像（`_project_current_stage:1266` / `_extract_current_stage:1298`），本次扩展解析 stages + `_map` 算 pending_review。**pending_review 与 current_stage 同源自洽**，且**消除 sillyspec.db 服务器可达性问题**（backend 列表路径不再需要 sillyspec.db 文件）。
- **sillyspec.db 不参与列表 READ**：`compute_pending_review` / `_read_stage_progress_sync`（sillyspec.db 直读）仅服务于 review 提交门禁 `_assert_pending_review`（`service.py:1382`）与 MCP `get_change_stage`，**不在列表或详情 READ 路径**。Design Grill 查证：详情 `enrich_with_workspace_ids`（`service.py:1225`）不调投影，故 `ChangeRead.pending_review` 恒 None——本变更不修复详情页此现象（NG-03 不改详情页），仅列表层接通真实投影。

## 9. 兼容策略（brownfield）

- **未配置/旧客户端**：`ChangeSummary.pending_review` 为 optional（default None），旧前端不读此字段不受影响；后端列表 API 不传 `sort`/`pending_review_only` 时，`sort` 默认 `updated_at_desc`、`pending_review_only` 默认 False。
- **行为变化（有意）**：默认排序从 `change_key ASC` 改为 `updated_at DESC`——更合理，但属可见行为变化，需在测试与 release note 体现。
- **降级路径**：`latest_progress` 缺失/解析失败/stages 表缺时，对应变更 pending_review 返回 None（继承 `_extract_current_stage` 的防御式 fail-closed），列表该行不显示待办徽标、不计入"待我处理"——不报错、不阻断列表。
- **不变的 API/表**：changes 表结构、详情页 API、review 端点、dispatch 链路均不动。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 批量解析 latest_progress + `_map`，pageSize=100 时性能 | P2 | 复用现有 `_project_current_stage` 单次 PG join（已在读 latest_progress），仅多解析 stages 字段（内存操作）+ `_map` 纯函数；分页上限 100 |
| R-02 | `gen:types` 跨仓/worktree 坑（历史 memory 记录） | P1 | execute 在主仓库根目录跑 gen:types；先确认 frontend node_modules 健康（`pnpm exec tsc --version`）；同步提交 api-types.ts + openapi.json |
| R-03 | ~~服务器 sillyspec.db 可达性~~ → **改走 PG 镜像后该风险消除**；残余=latest_progress 同步时效 | P2 | 走 PG 镜像后 backend 列表不再需要 sillyspec.db 文件，原 R-03（spec-sync 副本可达）消除；pending_review 依赖 platform_sync 上行的 latest_progress 快照，可能与实时 sillyspec.db 有同步延迟，但与 current_stage 同源自洽；门禁 `_assert_pending_review` 仍读实时 sillyspec.db 保证提交准确；列表展示用快照可接受 |
| R-04 | 「待我处理」默认勾上，用户可能困惑"怎么只剩几条" | P2 | 聚焦开关醒目 + 显示计数 "(N)" + 副标题"3 个变更待你处理（共 20 个进行中）"；一键取消看全部 |
| R-05 | 默认排序改变影响既有测试/习惯 | P2 | 更新 list 测试断言；排序更合理，可接受 |
| R-06 | 列表页重做触及既有 `page-team-toggle.test.tsx` 等测试 | P2 | 重做时同步迁移/更新测试 |
| R-07 | `latest_progress` 的 stages 表结构（serializeForSync）未在 design 强类型化 | P2 | execute 时读 platform_sync serializeForSync 确认 stages 在 JSON 的确切路径（顶层 `stages` vs `changes[0].stages`），`_extract_completed_stages` 防御式解析兼容；`_extract_current_stage` 已示范该 JSON 的 `changes[0].current_stage` 路径 |

## 11. 决策追踪

| 决策 | 被覆盖处 | 状态 |
|---|---|---|
| D-001@v1 范围=列表层做透 | FR-01、NG-03、§5 Phase3、文件清单（不含详情页） | accepted |
| D-002@v1 待我处理=全局待人工 | FR-02、§7（pending_review_only 筛选）、NG-05 | accepted |
| D-003@v1 ChangeSummary 加 pending_review 零 migration | §5 Phase1、§8、文件清单 schema/service | accepted（数据源走 D-008） |
| D-004@v1 默认排序 updated_at desc | FR-04、§5 Phase1、§9、R-05 | accepted |
| D-005@v1 方案B 批量投影 | §5 Phase1 | 部分修正：呈现→D-007、数据源 sillyspec.db→PG 镜像→D-008 |
| D-006@v1 title 归 sillyspec 不加工 | NG-04、§1 title 段 | accepted |
| D-007@v1 待我处理=进行中聚焦筛选 | FR-01/FR-02、§5 Phase3、§7、R-04 | accepted，supersede D-005 呈现部分 |
| D-008@v1 pending_review 走 PG 镜像（非 sillyspec.db），与 current_stage 同源 | §5 Phase1、§6、§7、§8、R-03/R-07；supersede D-005 数据源部分 | accepted |

无未解决决策。

## 12. 自审

逐项核验：

- **章节齐全**：背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/数据模型/兼容策略/风险登记/决策追踪/自审——全 ✓。
- **数据源正确性（Design Grill 修正）**：已纠正原"复用详情页 compute_pending_review / 风险不新增"的错误论据（详情 READ 不调投影、ChangeRead.pending_review 恒 None）；改为走 PG `latest_progress` 镜像 + `_map`，证据 `service.py:1225/1266/1298`、`platform_sync/model.py:39` ✓。
- **文件变更清单数据流**：pending_review producer（latest_progress PG 镜像）→ _project_current_stage 解析 → _map → enrich_summaries → router → api-types.ts → page.tsx 全链路标注 ✓；gen:types 链路标注 ✓。无 dormant 字段。
- **生命周期契约**：本变更只读 PG 镜像、不改 session/lease/agent_run/daemon，已用豁免短语「不涉及生命周期契约」声明（§7.5）✓。
- **零 migration 核验**：pending_review 是计算字段非列，changes 表不动，与 D-003 一致 ✓。
- **信息架构一致性**：主 tab 进行中/已归档（location 维度）+ 待我处理聚焦筛选（D-007），与「待我处理 ⊂ 进行中」的集合关系一致，无并列混淆 ✓。
- **YAGNI**：NG-01~NG-07 明确排除看板/stepper/行内审核/title加工/assignee/StatCard 收敛 ✓。
- **brownfield**：pending_review optional、sort/pending_review_only 有默认值、latest_progress 缺失降级 None ✓。
- **风险**：R-01~R-07 覆盖性能/gen:types/(R-03 消除)/默认勾选/排序变更/测试迁移/stages 结构 ✓。
- ⚠️ **自审存疑（留 execute）**：`latest_progress` 的 stages 表在 serializeForSync JSON 里的确切路径（顶层 `stages` vs `changes[0].stages`）未强类型化（R-07），execute 读 platform_sync serializeForSync 确认，`_extract_completed_stages` 防御式解析兼容。
- **测试覆盖**：service 解析 latest_progress.stages + _map、list 排序/筛选/字段、前端视图/徽标/开关/空状态均有对应测试任务 ✓。

自审通过（已纳入 Design Grill 修正），进入 Design Grill 续审。
