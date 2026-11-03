---
author: qinyi
created_at: 2026-11-03 10:54:48
generated_by: sillyspec-design-init
scale: small  # Step 8 精判：单上下文可吞吐（backend 单模块编排改造 + 前端契约小改，无 Wave 真并行需求）——flow start 收编轻量道
---

# 设计文档（Design）— 2026-11-03-knowledge-search-async-refresh

<!-- 引用规范：全文源码位置写仓根相对全路径+行号 -->

## 背景

知识搜索的懒同步（切块+嵌入）内联在搜索请求里：`backend/app/modules/knowledge/search.py:759` 的 `search_sync` 在语料指纹与 `knowledge_search_state` 失配时同步执行差量/全量嵌入。生产实证（2026-11-03 诊断）：工作区日常变更后首搜 63-81s（入口日志 slow.request），期间用户只见等待文案；历史叠加 worker cgroup OOM 打断同步（10 月 40 次）。用户已拍板 A1 路线（decisions.md D-001）：读路径彻底去嵌入化，同步后台化，搜索立即返回存量索引结果（stale-while-revalidate）。

## 设计目标

1. 搜索响应时间与嵌入计算彻底解耦：任何同步需求（差量/全量/首建）都不阻塞响应。
2. 结果新鲜度语义显式化：响应携带 `index_sync` 可选字段（fresh/scheduled/building），前端可轻提示「存量索引结果，新变更后台同步中」。
3. 同步触发保持懒触发+事件驱动：无定时器、无持久化队列、失败不自动重试（下次搜索自愈），与 D-backend-023 否决理由（防周期空转）对齐。
4. `server_build=False`（禁建库）语义完全不变：只读、不调度、无索引词面降级 `reason=index_not_built`。

## 非目标

- 不做 daemon 事件预建端点（A2，D-001 落选方向）。
- 不改检索打分/融合口径（0.6*vec+0.4*word+保底 0.9 等全部不动）。
- 不改切块、指纹算法、`knowledge_search_chunks/state` 表结构（零 schema 迁移）。
- 不引入跨进程任务队列/持久化（单 uvicorn worker 前提沿用，扩容前提见既有 design 声明）。
- 不做查询向量预热（查询向量嵌入单条 ~ms、子进程冷启 1-2s 留在响应路径，R-06 接受）。

## 拆分判断

单一模块内聚改造（backend knowledge search 编排）+ 前端契约小改，一次单上下文可完整吞吐，无真并行任务簇（Wave 证据不成立），不走批量模式、不拆多变更。

## 总体方案

**Phase 1 读路径去嵌入化（backend/app/modules/knowledge/search.py）**

`search_sync`（:759）重构：

- 新增 `_sync_needed(session, ws_id, fp_norm, model_name) -> str`：只读 SELECT `knowledge_search_state`，返回 `"missing"`（无行）| `"stale"`（model_version 或指纹失配）| `"fresh"`——替代现 `_ensure_synced`（:415）的快路径判定用于读路径决策，不做任何写。
- `server_build=True` 分支（:796）改为：
  - `"fresh"` → 直接走查询（现快路径行为），`index_sync="fresh"`；
  - `"stale"` → 调度后台同步（见 Phase 2）后**继续用存量行查询**（词面 ILIKE + 向量 KNN 候选照旧），`index_sync="scheduled"`；
  - `"missing"` → 调度后台同步后走 `_fallback_word_scan`（:883，词面内存直查，不落库），`index_sync="building"`。
- `server_build=False` 分支语义逐字不变（无行 → 词面降级 + `reason="index_not_built"`，不调度任何任务）；该分支响应不设 `index_sync`（None，`reason` 已表意）。
- 调度动作放在 try 块内（DB 可达才调度）；DB 异常降级链（:824 附近 except → `_fallback_word_scan`）不变，异常路径不调度。
- 查询向量嵌入（`to_thread(embedder.embed,[q])`）保留内联——单条查询、响应必需。

**Phase 2 后台同步任务（同文件）**

- 模块级注册表 `_bg_sync_tasks: dict[str, asyncio.Task]`（key=workspace_key）——同时充当去重判据与 **create_task 强引用**（asyncio 事件循环只持弱引用，不持会被 GC 静默吞，decisions.md D-005）。
- `_schedule_background_sync(spec_root, workspace_key, ws_id, fp_now, model_name, embedder, session_factory)`：在途即跳过；否则 `asyncio.create_task(_bg_sync(...))` 入注册表。
- 任务体 `_bg_sync`：独立开 DB session → 持 per-ws 锁（`_get_sync_lock` :382，与历史口径一致防同进程并发写）→ 复用现有 `_ensure_synced`（:415，全量/差量逻辑零改动）→ finally 从注册表移除自身；异常 catch 记 structlog 结构化事件（`knowledge_search.bg_sync_failed`），不重试（D-003）。
- 进程重启注册表即空：自愈=下次搜索重触发（D-003）。
- 测试出口：新增 `await_background_syncs_for_tests()`（gather 注册表全部任务并清空），生产勿调，与 `reset_index_for_tests`（:699）同族。

**Phase 3 契约与前端**

- `backend/app/modules/knowledge/schema.py:671` `KnowledgeSearchOut` 增 `index_sync: str | None = None`（可选，缺省 None，旧客户端忽略）。
- `router.py` `search_knowledge` 透传 `out["index_sync"]`。
- `frontend/src/lib/api-types.ts` 经 `pnpm gen:types` 再生成（producer=backend schema.py → OpenAPI → gen-api-types.mjs → api-types.ts → lib/knowledge.ts 返回类型透传 → page.tsx 消费）。
- `page.tsx` 搜索框下方轻提示：`index_sync==="scheduled"` → 「知识库有新变更，已后台同步，当前为存量索引结果」；`==="building"` → 「知识索引后台建设中，当前为关键词匹配结果」。纯文案行，无布局/交互变更。

**Phase 4 测试面适配（R-03，主要工作量）**

- 既有 35 用例依赖「搜索即同步完成」语义：统一改为 `out = await search_sync(...)` → `await await_background_syncs_for_tests()` → 按需二次 `search_sync` 断言最终态；首搜断言改判 `index_sync` 值。
- 新增用例：失配首搜不等嵌入（fake embedder 请求路径计数=0）+ 后台任务 drain 后二次搜索全语义；stale 调度去重（并发两次搜索仅一任务）；missing→building 词面降级；任务失败后注册表清理可再触发；`server_build=False` 零调度（回归锁）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/knowledge/search.py | 新增 `_sync_needed`/`_schedule_background_sync`/`_bg_sync`/`_bg_sync_tasks` 注册表/`await_background_syncs_for_tests`；`search_sync` 读路径去嵌入化（内部函数，无对外签名变化，返回 dict 增 `index_sync` 键） |
| 修改 | backend/app/modules/knowledge/schema.py | `KnowledgeSearchOut` 增可选字段 `index_sync`；producer=backend 该 schema → OpenAPI → 消费=frontend api-types/knowledge.ts/page.tsx |
| 修改 | backend/app/modules/knowledge/router.py | `search_knowledge` 透传 `index_sync` 到响应（producer=search_sync 返回 dict → router 组装 → consumer=前端） |
| 修改 | backend/app/modules/knowledge/tests/test_knowledge_search.py | 既有 35 用例适配 drain helper；新增调度/去重/失败清理/禁建零调度用例 |
| 修改 | frontend/src/lib/api-types.ts | `pnpm gen:types` 再生成（producer=backend OpenAPI 契约 → 消费=lib/knowledge.ts） |
| 修改 | frontend/src/lib/knowledge.ts | `searchKnowledge` 返回类型与字段透传 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx | `index_sync` 轻提示文案行（纯展示） |

## 接口定义

```python
# search_sync 返回 dict 增键（内部契约）：
{"results": [...], "model_ready": bool, "reason": str | None, "index_sync": "fresh" | "scheduled" | "building" | None}

# schema.py
class KnowledgeSearchOut(BaseModel):
    ...  # 既有字段不动
    index_sync: str | None = None  # fresh=存量索引即最新；scheduled=失配已后台同步；building=无索引后台首建；None=server_build=False 且无索引（reason=index_not_built 已表意）

# search.py 新增内部函数（模块私有，非对外 API）：
def _sync_needed(session, ws_id, fp_norm, model_name) -> str: ...          # "missing"|"stale"|"fresh"
def _schedule_background_sync(spec_root, workspace_key, ws_id, fp_now, model_name, embedder, session_factory) -> None: ...
async def _bg_sync(...) -> None: ...
def await_background_syncs_for_tests() -> None: ...  # 同步包装 asyncio.gather（测试面）
```

HTTP 端点路径/方法/鉴权不变；响应仅增可选字段。

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| schedule sync | search_sync 读路径 | `_bg_sync_tasks` 注册表 + 后台任务 | workspace_key, spec_root, fp_now, model_name, embedder, session_factory | 无任务 → 在途（注册表登记；在途重复调度被去重跳过） |
| sync success | 后台任务 | `knowledge_search_state` 行 | workspace_id, corpus_fingerprint, model_version | 在途 → 完成（注册表移除；state.updated_at 经 onupdate 刷新） |
| sync failure | 后台任务 | structlog 日志 + 注册表 | workspace_key, 异常摘要 | 在途 → 失败（注册表移除；无自动重试，下次搜索重触发） |
| process restart | uvicorn | 注册表 | — | 注册表随进程消亡（无跨进程态；自愈=下次搜索重触发） |

**非功能生命周期**：本变更引入的后台任务是进程内 asyncio task——自灭条件=任务体 return/raise（finally 移除注册表），无定时器、无外部资源句柄、无子进程；父环境（事件循环）消失任务随之消亡，无孤儿面。长驻进程/外部资源：不涉及。

## 数据模型

无 schema 变更：`knowledge_search_chunks`/`knowledge_search_state` 表结构与迁移链零改动（state 行写入仍走既有 `_ensure_synced`）。

## 兼容策略（brownfield 必填）

- 未触发同步（fresh）时响应与现版逐字段一致，`index_sync` 缺省 None，旧客户端零感知（additive）。
- 回退路径：后台调度/执行任何异常都不影响读路径（读路径代码不再触碰嵌入）；极端情况下退化为「索引不更新但搜索始终可用」，`state.updated_at` 不动即失败信号（2026-11-03-knowledge-search-hardening 已可观测）。
- 不改变的 API：端点路径/方法/鉴权/既有响应字段；不改变的表结构：两表 DDL。
- `server_build=False` 部署（本地 dev `.env` 现状）行为逐字不变。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 既有 35 用例依赖「搜索即同步完成」，适配面大、回归风险高 | P1 | 统一 drain helper（`await_background_syncs_for_tests`）改写；knowledge 全套件跑绿 + flow 收口 CLI 亲测对账 |
| R-02 | 后台任务异常静默、索引停更无人知 | P1 | structlog 事件 `knowledge_search.bg_sync_failed`；失败即 updated_at 不动（可观测信号）；D-003 明确不自愈重试的语义边界 |
| R-03 | create_task 弱引用被 GC 静默吞任务 | P2 | 注册表持强引用，finally 移除（D-005 故障面条款） |
| R-04 | 跨进程并发写库（扩 workers/多实例） | P2 | 单 uvicorn worker 前提沿用既有声明（search.py 模块注释）；扩容前须补 DB 唯一约束——既有风险继承，本变更不新增面 |
| R-05 | 前端轻提示属 UI 变更但无原型管线产物 | P2 | 接受：纯文案行、零布局/交互变更（复用既有 muted-foreground 文本样式），原型跳过理由在本行留痕 |
| R-06 | 查询向量嵌入冷启 1-2s 留在响应路径 | P2 | 接受：单条查询必需计算、低频触发；预热超出本变更非目标 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | A1 路线 → 总体方案全部 Phase；复潮裁决（D-backend-023/024）记录在案 | 已覆盖 |
| D-002@v1 | 无索引首搜后台化 → Phase 1 `"missing"` 分支 + Phase 2 首建 | 已覆盖 |
| D-003@v1 | 懒触发自愈/无重试 → Phase 2 任务体 + 生命周期契约表 failure 行 | 已覆盖 |
| D-004@v1 | `index_sync` 字段 → Phase 3 + 接口定义（None 语义补足 server_build=False 场景） | 已覆盖 |
| D-005@v1 | 内联调度/注册表强引用 → Phase 2 + R-03 | 已覆盖 |

剩余风险：无未归属决策；R-01/R-02 为执行期重点验收面。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=small，Step 8 精判落值）
- [x] 引用所有当前版本 D-xxx@vN（D-001~D-005 决策追踪表全覆盖）
- [x] 涉及生命周期关键词（后台任务/状态变化）→ 含「生命周期契约表」+ 非功能生命周期段
- [x] UI 原型分级核对：前端改动为纯文案提示行（R-05 留痕跳过原型）
- [x] 不确定的问题标注：无「⚠️ 自审存疑」残留项
