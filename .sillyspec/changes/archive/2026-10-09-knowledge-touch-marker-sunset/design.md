---
author: flow-machine-draft
created_at: 2026-10-09T04:12:25.717Z
---
# 设计记录（Design Record）— 2026-10-09-knowledge-touch-marker-sunset

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

CLI 自 2026-09-29-rot-retire-inject-cap 起不再落盘「待复核」标记（371 条零消费实证，持久化已拆），平台侧 change assets 聚合的标记反查面恒空成为死面——归档前后触达列表恒等（实测 48→48），归档态文案「以标记为准」失真。本变更：backend 摘除 `_REVIEW_MARK_RE` 标记反查与 `owner_line_re` 死参数，knowledge_touch 单一来源 = `_live_touch_rows`（knowledge_hits inject 遥测）；frontend 统一文案为「注入命中留痕」口径并修渲染（同 slug 的 id/title 只显示一个、整文件路由收拢 chip 行、锚点条目按文件分组）。

不选「恢复 CLI 标记落盘」（被零消费实证否决的旧路）也不选「新建权威收窄面」（无真实消费者，重蹈覆辙风险高）；展示层修复低风险且直接解决噪声投诉。若未来要「受影响 FR」窄视图，应消费既有 fr-rot-suspect 遥测（自带条目级 frIds），不属本变更。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- API 响应形状不变：`ChangeKnowledgeTouch`（id/title/file 三字段）结构不动；仅 schema docstring 措辞更新 → openapi.json description 变化 → 按仓规 `pnpm gen:types` 重生成并提交 openapi.json + api-types.ts（类型结构无变化，gen:types:check 零漂移）。
- `assets.py` 私有纯函数 `_parse_entries_owned_by`/`_scan_domain_files` 删除 `owner_line_re` 可选参（grep 核实无外部消费方，仅本模块与自身测试引用）；默认 `变更：` 归属语义逐字保留。
- `get_change_assets`：gather 从四路减为三路（fr 扫描 / decisions 扫描 / live 触达），`_merge_touch` 合并与 `seen_touch` 去重集合删除（live 行内部已按 (file, ident) 去重并帽 100）。
- 前端组件无 props/取数变化，纯渲染段重写；data-testid `change-assets-knowledge-touch` 保留，新增组级 testid `change-assets-touch-group-<file>`。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。live 行按 occurred_at 排序、matched_anchors 首见序展开去重；daemon 周期上行迟到的新行只追加新锚点，不依赖标记面，无乱序假设需要成立。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   聚合纯只读（SELECT knowledge_hits + 读镜像文件），无写面；knowledge_hits 的幂等上行（行 sha256 唯一约束）是既有机制，不动。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。在途→归档只是 Change.location/status 翻转，触达面持续可查；归档后 CLI 不再产生新 inject 行，列表自然定格——文案如实陈述该生命周期。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会。查询按 workspace_id + change_name 过滤（既有约束保留）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：归档态语义预期错位——用户若期待「归档后收窄为权威面」，本变更是明示不收窄（文案诚实化对冲：口径写清是注入命中留痕）。放弃的方案：① 恢复 CLI 待复核标记落盘（2026-09-29 已实证否决，反向开倒车）；② 平台按域收窄 live 数据面（改的是数据口径，会连带影响 knowledge-stats 运营指标消费，超出本变更范围且无消费者支撑）。

## 文件变更清单

- backend/app/modules/change/assets.py —— 摘除标记反查面与 owner_line_re 死参数，knowledge_touch 单一来源 _live_touch_rows
- backend/app/modules/change/schema.py —— ChangeKnowledgeTouch docstring 口径措辞更新
- backend/app/modules/change/tests/test_assets.py —— 标记反查用例改写为标记无视/同源断言
- backend/openapi.json —— schema 描述变更再生成（pnpm gen:types）
- frontend/src/lib/api-types.ts —— 同上再生成，类型结构零变化
- frontend/src/components/changes/detail/change-assets-card.tsx —— 统一文案 + 分组渲染（chip/按文件分组/同 slug 单份）
- frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx —— 触达用例更新与分组用例新增

