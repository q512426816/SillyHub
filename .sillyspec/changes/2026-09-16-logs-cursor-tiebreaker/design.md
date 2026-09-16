---
author: qinyi
created_at: 2026-09-16 08:06:44
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-09-16-logs-cursor-tiebreaker

## 背景

c318553a6（2026-09-15）把会话日志向上翻页游标从 `timestamp < before` 放宽为 `timestamp <= before`（同批日志共用同一 timestamp，严格小于会永久跳过边界批次）。但游标仍是纯 timestamp、无 id tiebreaker。前端页大小 HISTORY_PAGE_SIZE=100（session-panel-page.tsx），`handleLoadEarlier` 的下一游标取 `older[0]?.timestamp`（返回页最旧行）——当**单事务批量写入 ≥100 行同 timestamp** 时（docstring 自证「submit_messages 同批日志共用同一 timestamp」）：

1. 游标不再前进（下一页 `ts <= 游标` 仍命中同批最后 100 行）→ `hasEarlier` 恒真 → 触顶重拉同页；
2. `setTurnState` prepend 不去重且 pageKey 由游标数字派生（同页同 key）→ 重复轮次 + React key 撞号；
3. 同 ts 批次超 100 行的**批内前段行永久不可达**（每页都取该批 id 最大的 100 行，永远翻不到更小 id 的行）。

既有缓解：跳转循环无进度 break（`loadEarlierOnce` :1128-1131 / :1312）、视口自动补拉上限 10 次（:1139）——只防无限循环，不修可达性。

排序事实（设计前提，已核源码）：`get_agent_session_logs` ORDER BY 是 **run 块序** `run_anchor.anchor_ts DESC → AgentRunLog.timestamp DESC → id DESC`（read_model.py:409-414，保「同 run 连续、跨 run 按起始序」），而 WHERE 按裸 `timestamp` 过滤——两键不对齐是既有已接受局限（跨 run 时间交叠时可跳行；顺序会话一会话一活跃轮不受影响）。前端 `logsToTurns` 按 run_id Map **首见序**定轮序（runtime-session-helpers.tsx:324-334），因此不能改全局 (ts,id) 排序（轮序会随分页窗口漂移）。同 ts 大批次来自单 run 事务，run 块内序恰为 (ts,id)——**块内复合游标天然对齐**。

## 设计目标

- 同 ts 批次（任意行数）逐页可达：游标在 (ts,id) 字典序上严格前进。
- 边界行零重叠：复合严格小于使下一页不再包含已加载行（`<=` 的单行重叠顺带消除）。
- 旧客户端零回归：不传 `before_id` 时行为与现行 `ts <= before` 完全一致。
- run 块序与前端轮序派生零影响：ORDER BY 不动。

## 非目标

- 不做不透明 cursor token（before 参数形态不变）。
- 不改全局排序/轮序派生（logsToTurns 首见序机制不动）。
- 不动 `after` 增量路径与 `q` 搜索路径（无游标/无本缺陷）。
- 不调整 HISTORY_PAGE_SIZE / runs 上限等容量参数。
- 不建前端全量 log-id 去重索引（严格复合过滤已保证零重叠；pageKey 后缀仅作 key 撞号防御）。

## 拆分判断

单变更不拆：backend 过滤与前端游标是同一 API 契约的两面，拆开会出现中间态（后端支持前前端停摆，或反之）。不批量：与其它活跃变更零文件交集（session_insights/read_model/sessions.ts/session-panel-page 均无在途变更占用）。

## 总体方案

### Wave 1（backend）

1. `session_insights.py` 日志端点新增可选 `before_id: uuid.UUID | None = Query(None, ...)`（描述：与 before 组合的复合游标 id tiebreaker；与 before 二选一校验——**单独传 before_id 无 before → 422 fail-explicit**），透传 service。
2. `read_model.py` `get_agent_session_logs` 新参 `before_id: uuid.UUID | None = None`：

```python
if before is not None:
    if before_id is not None:
        stmt = stmt.where(
            or_(
                AgentRunLog.timestamp < before,
                and_(AgentRunLog.timestamp == before, AgentRunLog.id < before_id),
            )
        )
    else:
        stmt = stmt.where(AgentRunLog.timestamp <= before)  # 现行语义，旧客户端
```

ORDER BY（:409-414）与 limit/reverse 语义零改动；docstring 游标段同步复合语义（含 D-001 排序前提：run 块序与过滤键不对齐的既有局限不扩大）。
3. openapi.json 重导出 + 前端 `pnpm gen:types`（rule 21：schema 变更同 quick/change 内同步，不欠类型债）。

### Wave 2（frontend）

4. `sessions.ts` `getAgentSessionLogs` opts 加 `beforeId?: string` → `params.set("before_id", v)`（有 before 才带，防 422）。
5. `session-panel-page.tsx` `handleLoadEarlier`：
   - 游标二元组化：`historyCursorRef`（ts）旁新增 `historyCursorIdRef`（id），**两个写点均需同步设 id**——翻页写点取 `older[0]`（返回升序首行=最旧行，:1074），初始加载写点取 `logs[0]`（:689 现只设 ts——Grill 补：漏设则首次翻页 beforeId=undefined 走旧 `<=` 分支，同 ts 满 100 行批首页整页重复）；
   - 请求带 `beforeId: historyCursorIdRef.current ?? undefined`；
   - `pageKey` 追加 id 短后缀（`cursor 数字串 + '-' + 游标 id 前 8 位`）保跨页唯一（防 key 撞号的防御位）；
   - `loadEarlierOnce` 进度判定改二元组比较（ts 同 id 变 = 有进度——同 ts 批次翻页正靠 id 前进，跳转循环的 break 条件随之正确）；
   - 换会话重置点（:662）同步清 `historyCursorIdRef`。

**效果核验（同 ts 150 行批，页 100）**：页1 取该批 id 最大 100 行（DESC），边界=批内第 100 小 id；页2 复合过滤取 id 更小的 50 行 + 更早历史——批内前段行可达，零重叠，游标严格前进。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/router/session_insights.py | 新增 before_id Query 参数（单独传无 before → 422），:379/:424 接线透传 |
| 修改 | backend/app/modules/daemon/session/service/read_model.py | get_agent_session_logs 新参 before_id + 复合过滤分支（:405-406 处），docstring 同步 |
| 修改 | backend/openapi.json | 重导出（新查询参数入 OpenAPI） |
| 修改 | frontend/src/lib/api-types.ts | `pnpm gen:types` 生成（新 before_id 参数类型） |
| 修改 | frontend/src/lib/daemon/sessions.ts | getAgentSessionLogs opts+params 加 beforeId（:647/:655） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 游标二元组（新 ref；翻页 :1074 与初始加载 :689 两写点均设 id、换会话重置 :662 同步清）、请求透传 :1053、pageKey 后缀 :1093、loadEarlierOnce 二元组进度判定 :1129-1131 |
| 修改 | backend/app/modules/daemon/tests/test_group_logs_pagination.py | 新增复合游标用例：同 ts 150 行批两页可达/缺省 before_id 行为回归/单独 before_id 422 |
| 修改 | frontend session-panel 相关测试文件 | 游标二元组前进/before_id 透传用例 |

**字段数据流标注**（新增对外字段 before_id）：producer=前端游标 id（初始加载 `logs[0].id`（:689）与翻页 `older[0].id`（:1074）两写点）→ getAgentSessionLogs params 序列化为 query `before_id`（uuid 字符串）→ backend FastAPI Query 反序列化 uuid.UUID → service 复合过滤消费（AgentRunLog.id 同为 uuid，PG 全序比较）→ 响应体无新字段（消费在过滤层终止）。

## 接口定义

```python
# backend read_model.py（签名增量）
async def get_agent_session_logs(
    svc, session_id: uuid.UUID, user_id: uuid.UUID, *,
    limit: int = 5000,
    after: datetime | None = None,
    before: datetime | None = None,
    before_id: uuid.UUID | None = None,   # 新增：与 before 组合的复合游标
    q: str | None = None,
) -> list[AgentRunLog]: ...

# 过滤语义
before_id is None → timestamp <= before（现行）
before_id 非 None → (timestamp < before) OR (timestamp == before AND id < before_id)
```

```ts
// frontend sessions.ts（opts 增量）
beforeId?: string;  // uuid；仅与 before 同时传
```

## 生命周期契约表

不涉及生命周期契约（日志读路径分页参数增量，无 session/lease/agent_run 状态转移；背景中 run 块序为既有查询语义非状态机）。

## 数据模型

无 schema 变更（纯查询参数与过滤条件；AgentRunLog.timestamp/id 既有列）。

## 兼容策略（brownfield 必填）

- `before_id` 缺省分支保持 `ts <= before` 现行语义——旧前端/外部调用方零感知（行为逐字节一致）。
- 单独传 before_id（无 before）→ 422 显式报错（新参数无既有消费方，fail-explicit 优于静默忽略）。
- 回退路径：前端不传 beforeId 即整体回退现行行为（二元组游标仅在传入时生效）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | WHERE 裸 ts/复合过滤与 run 块序排序键不对齐（跨 run 时间交叠跳行）——既有局限 | P2（继承，非新增） | 顺序会话（一会话一活跃轮）块序=全局 ts 序不受影响；本变更仅在块内收紧不扩大；设计背景已记录，超范围不动 |
| R-02 | 复合过滤 (ts=?,id<?) 在大表上的执行计划退化（同 ts 等值 + uuid 范围无索引支撑） | P2 | 现查询本就对全匹配行排序（无 keyset 索引），过滤只是减少进入排序的行数——方向是变快不变慢；测试面加 150 行批用例验正确性；索引优化留后续（非目标） |
| R-03 | 前端游标二元组漏改某个重置/消费点（换会话残留旧 id） | P2 | 换会话重置点与 historyCursorRef 同点同步清；测试覆盖换会话后翻页 |
| R-04 | 用户跳过方案确认（step3/5），设计为 AI 代确认 | P2 | 透明记录于 D-001 evidence；verify 阶段验收关卡兜底；行为向后兼容可整体回退（兼容策略节） |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1（方案 A：before_id 复合过滤） | FR-01（可达）/FR-02（零重叠）/FR-03（零回归）/FR-04（轮序零影响）+ 总体方案 Wave1/2 + 兼容策略 | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large——跨 backend/frontend 两模块、API 契约变更、8 文件）
- [x] 引用所有当前版本 D-xxx@vN（D-001@v1 唯一决策，已入决策追踪）
- [x] 涉及生命周期关键词时含紧邻豁免短语（「不涉及生命周期契约」）
- [x] UI 原型分级核对：无 UI/界面变化（翻页逻辑层），无需原型
- [x] 数据流标注已交代 before_id 全链（producer→序列化→反序列化→过滤消费）
- [ ] ⚠️ 自审存疑：R-02 执行计划断言「过滤只减不增排序行数」基于读代码推理，未跑 EXPLAIN——execute 阶段若 pagination 测试显著变慢需回看
