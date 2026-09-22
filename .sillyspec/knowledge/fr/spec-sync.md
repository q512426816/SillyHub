---
author: sillyspec-fr-index
created_at: 2026-09-22T17:27:13.449Z
---

# FR 索引 — spec-sync

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/spec-sync.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-spec-sync-001 hits 多端汇聚上行
变更：2026-09-20-knowledge-effect-panel
状态：active
摘要：默认场景
依据决策：D-003@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 多用户各自机器的 daemon 对同一 workspace 产生本地 hits 文件；When daemon spec 同步流程触发；Then 豁免读取 `.runtime/knowledge-hits.jsonl` 按本地 offset 完整行断点增量上报（≤2000 行/批）；服务器按 (works
全文：.sillyspec/changes/archive/2026-09-20-knowledge-effect-panel/requirements.md#FR-01
最近确认：095869924

## FR-spec-sync-002 运营指标仪表盘
变更：2026-09-20-knowledge-effect-panel
状态：active
摘要：默认场景
依据决策：D-009@v1
场景正文：
- 场景：默认场景 — Given workspace 已有 hits 数据；When 打开知识库页；Then 顶部四指标卡：知识覆盖率（被命中条目/全部条目+按周趋势迷你图）、死条目（90 天零命中，点击展开清单抽屉）、每任务命中密度（inject 按 change 去
全文：.sillyspec/changes/archive/2026-09-20-knowledge-effect-panel/requirements.md#FR-02
最近确认：095869924

## FR-spec-sync-003 使用率榜
变更：2026-09-20-knowledge-effect-panel
状态：active
摘要：默认场景
依据决策：D-008@v3
场景正文：
- 场景：默认场景 — Given 条目命中计数与条目存在期间任务总数（任务=inject 行 change_name 去重，含变更与 quick）；When 渲染使用率榜；Then 全量条目按每任务触发率降序滚动展示（主数值 % 格式：<10% 两位小数、≥10% 一位小数，D-008@v3），绝对次数作副信息，不截断条数
全文：.sillyspec/changes/archive/2026-09-20-knowledge-effect-panel/requirements.md#FR-03
最近确认：095869924

## FR-spec-sync-004 全 zone 统一条目渲染器
变更：2026-09-20-knowledge-effect-panel
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 知识库任一文件（手册/decisions/fr/generated/INDEX）；When 用户点开；Then 默认卡片流按文件形态分发：手册=## 小节逐条正文卡（条目级 🔥 徽标）；决策/FR=结构化字段卡（ID/标题/状态徽标/字段行/理由摘要/取代链/依据决策跳
全文：.sillyspec/changes/archive/2026-09-20-knowledge-effect-panel/requirements.md#FR-04
最近确认：095869924

## FR-spec-sync-005 fr 独立 zone
变更：2026-09-20-knowledge-effect-panel
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given knowledge/fr/ 目录存在条目；When 知识库列表加载；Then fr 条目归「需求规则」组独立展示（决策库组后），zone 值 "fr" 透传
全文：.sillyspec/changes/archive/2026-09-20-knowledge-effect-panel/requirements.md#FR-05
最近确认：095869924

## FR-spec-sync-006 使用徽标
变更：2026-09-20-knowledge-effect-panel
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 命中聚合计数；When 列表与卡片渲染；Then 文件行挂文件级 🔥 徽标；手册小节卡挂条目级徽标（锚点=文件#小节标题对齐）
全文：.sillyspec/changes/archive/2026-09-20-knowledge-effect-panel/requirements.md#FR-06
最近确认：095869924
