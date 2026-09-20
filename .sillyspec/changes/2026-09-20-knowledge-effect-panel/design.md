---
author: qinyi
created_at: 2026-09-20 21:14:35
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-09-20-knowledge-effect-panel

## 背景

知识库页（2026-09-17-knowledge-precipitation 交付）解决了「能看到」——zone 分组、写入审核、蒸馏沉淀全链已上线。但三类知识资产的价值**看不见**：

1. **无运营视角**：不知道沉淀的知识有没有被用、用得怎样。sillyspec CLI 每次任务注入知识时在本地 `.sillyspec/.runtime/knowledge-hits.jsonl` 记录命中遥测（本仓实证 2597 条），但 `.runtime` 在 spec 同步排除集（sillyhub-daemon/src/spec-sync.ts `UPLOAD_EXCLUDE_TOP_BASE`）——数据永远留在各开发者本机，平台侧不可见。
2. **决策库/FR 索引展示是裸文件**：decisions/（13 文件 100+ 条 D-xxx）与 fr/（fr-index 新产物，随归档持续增长）的结构化价值（状态/取代链/防复潮/场景）全埋在 md 正文里；fr/ 甚至不在独立 zone（parser ZONE_SUBDIRS 仅 {decisions,generated,proposed}，backend/app/modules/knowledge/parser.py:15）。
3. **手册文件不可导航**：conventions/known-issues 等一文件二十多个 `## 小节`，INDEX.md 的路由目录页是纯文本不可点。

用户明确要求运营口径（命中率/使用率类），非纯次数（开发量混叠意义不大，D-009）。

## 设计目标

1. **hits 多端汇聚上行**：daemon 豁免单文件断点增量上报 → backend `knowledge_hits` 落库（行 hash 幂等去重，多用户单工作区零重复，D-007）。
2. **运营指标仪表盘**：知识覆盖率（+趋势）/死条目（90 天零命中清单）/每任务命中密度/新知识生效速度——剥离开发活跃度的健康度指标（D-009）。
3. **使用率榜**：全量按每任务触发率排序，% 格式显示（<10% 两位小数/≥10% 一位小数，D-008@v3），绝对次数作副信息。
4. **全 zone 统一条目渲染器**：三形态（手册 ## 小节正文卡/决策+FR 结构化字段卡/INDEX 目录导航卡），条目级使用徽标，superseded/rejected 沉降，防复潮横幅（D-004@v2）。
5. **fr 独立 zone**：「需求规则」组（D-005）。

## 非目标

- 不做人工网页浏览计数（D-002@v3 口径=agent 注入 {inject, fr-inject}）。
- 不改 sillyspec CLI（上行走 daemon 豁免通道，D-003）。
- 不做按人视图（数据层留 daemon 归属，展示默认聚合；按人视图留后续）。
- 不做决策条目级热度（第一期文件级；hits 中 decisions 命中为文件级锚点）。
- 不做日历热力图（用户亲答删除，D-009）。
- 不做知识条目自动清理/降级动作（死条目仅清单引导，清理动作人工）。

## 拆分判断

单变更分 Wave 交付：三件套共享 hits 数据底座（表/上行/聚合）与统一渲染器组件，拆多 change 产生跨变更契约债；批量模式不适用。规模 large（跨 daemon/backend/frontend 三端+新表+新端点）。

## 总体方案

**Wave 1 · 数据底座（backend+daemon）**
- 新表 `knowledge_hits`（migration）：id/workspace_id/line_hash（唯一约束 uq (workspace_id, line_hash)）/daemon_id（归属，可关联注册用户）/type（五型白名单：inject/fr-inject/fr-duplicate-warning/fr-supersede/fr-unreferenced；仅 {inject, fr-inject} 进使用计数，其余存档）/daemon_local_id（body 显式携带的 daemon 实例 id，原样落库不 FK）/change_name/query_text/matched_anchors（JSONB 数组）/occurred_at（行内 at）/received_at。
- backend 新端点 `POST /knowledge/hits/batch`（daemon 鉴权轨道）：body {lines: [原始 jsonl 行]}，逐行 sha256 去重 INSERT ON CONFLICT DO NOTHING；坏行跳过计数返回。
- daemon（sillyhub-daemon/src/spec-sync.ts 旁新模块）：spec 同步流程中读 spec 目录 `.runtime/knowledge-hits.jsonl`，按本地状态文件（daemon 家目录，不落 spec 树）记的 offset 增量上报（按完整行断点，尾行不完整留下次）；上报走既有 hub-client（daemon 鉴权自带身份）。
- 聚合端点 `GET /knowledge/stats`（KNOWLEDGE_READ）：输出四指标+趋势序列+条目使用率榜全量。条目全集从 parser（手册 ## 小节+decisions/fr 条目+generated 文件；**INDEX.md 显式排除**——自带 ## 分类段防误计），命中锚点对齐 `文件#锚` 粒度。
**锚点 slug 归一化（Grill CLK-02，救命项）**：hits 实测锚点为 slug 形态（`backend-模块分层与基类异常约定routerserviceschema--basemodel--apperror`——标题原文经 CLI anchor 规则：小写/空格转-/去括号标点），非标题原文。匹配键双端归一：parser helper 生成条目 slug（复刻 CLI anchor 规则）与 hits 锚点同域比对；无 # 的裸文件锚（decisions/fr）按文件级匹配（实测零跨形态混存，口径天然二分）。
**type 白名单（Grill CLK-03）**：实数据五型 inject/fr-inject/fr-duplicate-warning/fr-supersede/fr-unreferenced（无 classify）。ingest 白名单=五型全收；使用计数仅 type∈{inject, fr-inject}（均为 agent 注入语义）；其余存档。
条目存在期任务数=该条目首见后（frontmatter created_at 优先/无 frontmatter 的 decisions 落 hits 首见时间兜底/mtime 末位兜底）的 inject 行 change_name 去重计数（D-008@v3/v3 口径：任务分母=inject 行；fr-inject 行不进分母，仅其锚点计数——口径注记统一；分母=有命中任务，零命中任务不进 hits，次/任务系统性偏高为口径固有）。

**Wave 2 · 运营仪表盘+使用率榜（frontend）**
- 知识库页顶部运营指标卡组（覆盖率大卡+迷你趋势/死条目可点开清单抽屉/密度/生效速度）+ 使用率榜卡（全量滚动，触发率 % 主显示——<10% 两位小数/≥10% 一位小数（D-008@v3）+绝对次数副显）。react-query 消费 stats 端点。

**Wave 3 · 统一条目渲染器 + fr zone**
- parser：ZONE_SUBDIRS 增 `fr`（backend/app/modules/knowledge/parser.py:15）+ 前端 ZONE_GROUPS 增「需求规则」组。
- 新组件 `EntryCardList`（统一渲染器）：按文件形态分发——手册（`## 小节` 逐条正文卡+条目级 🔥 徽标，锚点=文件#小节标题）/ 决策与 FR（结构化字段卡：ID/标题/状态徽标/字段行/理由摘要块/取代链/依据决策↔决策库互跳/全文→归档 requirements/最近确认 commit/文件级热度）/ INDEX（分类段+路由行渲染为可点击导航→选中目标条目）/ generated（单条目卡）。
- 每文件「卡片/原文」双 tab（原文=现有 md 阅读视图零改动）；rejected 决策置顶+防复潮横幅；superseded 折叠置灰。

**数据流**：matched_anchors 落库逐锚点拆条（`文件#锚` 字符串数组原样存 JSONB，聚合时拆）；使用计数=type∈{inject, fr-inject} 行的锚点出现次数（fr-inject 实测 matchedFiles 全空，仅进密度/任务分母）；条目徽标=该锚点计数；文件级徽标=锚点前缀文件名计数和。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/knowledge/parser.py | ZONE_SUBDIRS 增 "fr"；新增条目提取 helper（## 小节/## D-xxx/## FR-xxx 解析，供 stats 聚合条目全集；producer=parser → stats 端点 → consumer=前端） |
| 新增 | NEW:backend/app/modules/knowledge/hits.py | 命中接收（batch 落库幂等）+ 聚合（四指标/趋势/使用率榜/条目徽标计数）服务 |
| 修改 | backend/app/modules/knowledge/schema.py | HitsBatchIn/HitsBatchOut/KnowledgeStatsOut（指标+榜+趋势 DTO）+ KnowledgeEntryRead 增文件级 use_count（producer=stats 聚合 → consumer=前端徽标） |
| 修改 | backend/app/modules/knowledge/router.py | POST /knowledge/hits/batch（daemon 轨道鉴权）+ GET /knowledge/stats（KNOWLEDGE_READ）；字面量路由先于 {filename:path} 通配 |
| 新增 | NEW:backend/migrations/versions/<执行时定号>_create_knowledge_hits.py | knowledge_hits 表 + uq(workspace_id, line_hash) 唯一约束 |
| 修改 | backend/app/modules/knowledge/service.py | list 透传文件级 use_count（join 聚合，低频可接受） |
| 修改 | sillyhub-daemon/src/spec-sync.ts | 同步流程挂 hits 增量上报钩子（豁免单文件，不动 .runtime 整体排除语义） |
| 新增 | NEW:sillyhub-daemon/src/knowledge-hits-upload.ts | hits 文件读取/offset 状态（daemon 家目录）/完整行断点/上报 |
| 修改 | backend/openapi.json + frontend/src/lib/api-types.ts | gen:types 再生成 |
| 修改 | frontend/src/lib/knowledge.ts | getKnowledgeStats 封装 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx | 顶部运营卡组+榜；fr zone 组；文件点开双 tab 分发 EntryCardList |
| 新增 | NEW:frontend/src/components/knowledge/ops-dashboard.tsx | 运营指标卡组+死条目抽屉+使用率榜 |
| 新增 | NEW:frontend/src/components/knowledge/entry-card-list.tsx | 统一条目渲染器（三形态配置化） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | zone 组/mock/双 tab 适配 |
| 新增 | NEW:frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | 指标卡/死条目抽屉/榜渲染 |
| 新增 | NEW:frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx | 三形态渲染/状态徽标/互跳/防复潮 |
| 修改 | backend/conftest.py | 执行期合理偏差（task-03）：KnowledgeHit 模型 metadata 根注册，防单跑 test_router 缺表 |
| 修改 | sillyhub-daemon/src/hub-client.ts | 执行期合理偏差（task-02）：postKnowledgeHitsBatch 公共方法+runtime_id 身份记录（HubClient 无既有公共 POST 面） |

## 接口定义

```python
# hits.py
class HitsService:
    async def ingest_batch(self, workspace_id, daemon_id, lines: list[str]) -> HitsBatchOut
        # body 含 daemon_local_id（daemon 实例 id，原样落库）；逐行 json.loads → sha256 → INSERT ON CONFLICT (workspace_id, line_hash) DO NOTHING
        # 坏行跳过计数；type∈五型白名单校验（外型仍落库 type 原值但不进计数）；matched_anchors 原样 JSONB
    async def stats(self, workspace_id) -> KnowledgeStatsOut
        # 条目全集（parser helper）× 命中聚合（{inject, fr-inject} 拆锚点）→ 覆盖率/死条目/密度/生效速度/榜/条目计数

# stats 输出（KnowledgeStatsOut 摘要）
coverage: {used_entries, total_entries, trend: [{week, pct}]}   # 趋势按周回溯（历史命中按 occurred_at 归周重算覆盖率分子）
dead_entries: [{anchor, last_hit_at | never}]                   # 90 天零命中，锚点可定位
density: {per_task_avg, trend}                                  # inject 行按 change_name 去重任务数
freshness: {recent_new, recent_used}                            # 近 30 天新增条目（created_at 优先/hits 首见/mtime 兜底）中已被命中数
usage_board: [{anchor, per_task, total, task_count, first_hit, last_hit}]  # 全量按 per_task 降序（次/任务归一；前端 % 格式显示 D-008@v3）
entry_counts: [{file, count}]                                   # 文件级徽标
```

REST：`POST /api/workspaces/{ws}/knowledge/hits/batch`（daemon 轨道）；`GET /api/workspaces/{ws}/knowledge/stats`（KNOWLEDGE_READ，字面量先于通配注册）。

## 生命周期契约表

不适用 lifecycle contract——本变更不新增 session/lease/agent_run 状态机事件；hits 上行为 daemon→backend 单向数据面（复用既有 daemon 鉴权与同步流程挂点），不触碰 lease/session 生命周期。

## 数据模型

- 新表 `knowledge_hits`（唯一变更）：如总体方案 Wave 1 所列；索引 ix (workspace_id, occurred_at) 支撑趋势/死条目查询。
- 无其它新表；聚合实时计算（条目千级×命中万级可接受，不做物化）。

## 兼容策略（brownfield 必填）

- 未部署新 daemon 的端：hits 不上行，stats 端点返回零值指标（前端显示「暂无使用数据」态），既有功能零影响。
- 新端点全为增量；parser 增 "fr" 仅新增 zone 值，旧前端忽略。
- daemon 上报失败不阻塞 spec 同步主流程（best-effort，下次重试；offset 不进则重报由 hash 去重兜底）。
- 回退：隐藏运营卡组入口即可；hits 表对既有读路径零耦合。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | hits 文件行截断（上报时本地正 append） | P1 | 按完整行断点（最后无 \n 的尾行不报），下次补 |
| R-02 | 多端并发 INSERT 同 hash 竞态 | P1 | uq 唯一约束+ON CONFLICT DO NOTHING（数据库级幂等，D-007） |
| R-03 | 锚点对齐歧义（手册小节标题=锚点，标题改即断链） | P1 | 计数 misses 容忍（锚点不命中计入死条目口径的一部分）；统计非记账不追求强一致 |
| R-04 | stats 实时聚合量级增长 | P2 | 当前量级（条目百级×行万级）实时可接受；超阈值再物化（记模块卡债） |
| R-05 | daemon 改动引入同步主流程回归 | P0 | 上报钩子独立 try/catch best-effort；daemon 测试面全量跑（4306 用例基线） |
| R-06 | 大 hits 文件首次全量上报体量 | P2 | 分批（每批 ≤2000 行）多次上报；服务器端批量 INSERT 单事务 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 全文（三件套范围） | 已覆盖 |
| D-002@v3 | 总体方案 Wave 1（口径={inject, fr-inject}）+ 非目标（不做浏览计数） | 已覆盖 |
| D-003@v1 | Wave 1 daemon 上行通道 + 非目标（不改 CLI） | 已覆盖 |
| D-004@v2 | Wave 3 统一渲染器三形态 | 已覆盖 |
| D-005@v1 | Wave 3 fr zone | 已覆盖 |
| D-006@v2 | 总体方案整体（方案 A） | 已覆盖 |
| D-007@v1 | Wave 1 落库（hash 去重/daemon 归属）+ R-01/R-02 | 已覆盖 |
| D-008@v3 | Wave 2 使用率榜全量（次/任务归一+%格式显示） | 已覆盖 |
| D-009@v1 | Wave 2 四指标仪表盘 + 非目标（热力图删除；榜排序口径以 D-008@v3 为准） | 已覆盖 |

## 自审

- [x] 章节齐全（背景/目标/非目标/总体方案/清单/接口/风险/兼容）
- [x] frontmatter（author/created_at/scale=large）
- [x] 引用全部当前版本决策（D-001@v1、D-002@v3、D-003@v1、D-004@v2、D-005@v1、D-006@v2、D-007@v1、D-008@v3、D-009@v1、D-002@v3；取代链完整）
- [x] 生命周期关键词豁免短语（本变更不触碰 session/lease/agent_run 状态机）
- [x] UI 原型：prototype-effect-panel.html（经用户五轮反馈迭代至运营仪表盘形态）
- [x] 字段数据流标注（matched_anchors→stats→徽标；use_count→api-types→前端；hits lines→ingest→表）
- [⚠️ 自审存疑] daemon 鉴权轨道具体形态（hits/batch 走 daemon WS token 还是 API key 轨）——execute 前核 spec-sync 既有上报的鉴权先例（postSpecSync 同款），以先例为准
- [⚠️ 自审存疑] 死条目「条目全集」中 generated/ 单条目文件的条目粒度（文件级）与手册小节粒度混排的口径——按锚点形态自然区分（有 # 为小节级，无 # 为文件级），execute 时在 stats 聚合注释钉死
