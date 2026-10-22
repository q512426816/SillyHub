---
id: task-06
title: 'P3: fix drifted file:line anchors and reconcile design 1b wiring surface'
title_zh: 'P3 锚点漂移修正 + 1b 接线面补口'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-21 14:49:18
priority: P2
depends_on: []
blocks: []
requirement_ids: []
decision_ids: []
allowed_paths:
  - .sillyspec/changes/2026-10-20-session-page-dsh-alignment/design.md
target_files: []
goal: >
  修掉两处 P3 锚点漂移并复核 design 的 1b 接线面与现实一致：`design.md:82` 原指 `turn-timeline.tsx:2117-2122`，
  真实注释块已在 `turn-timeline.tsx:2129-2133`；`tasks.md` 原把「助手列 14px 分区」锚在 `turn-timeline.tsx:2045-2048`，
  真实落点是 `:2052-2054`。锚点错位会让后续执行者按错行号改代码。
implementation:
  - 'plan 阶段已先落两处修正：design.md:82 已改为 `turn-timeline.tsx:2129-2133` 并留「旧值 :2117-2122 已漂移」注记；tasks.md 的对应证据行已改指 `:2052-2054`。本卡负责**复核 + 清残余**，不是只签字'
  - '逐条核 design.md 的 1b 行与真实文件对账：`sillyhub-daemon/src/interactive/session-manager.ts`（现存 2405 行，brief/旧文记 3897 属陈旧口径——annotation 必须按现状写）、`backend/app/modules/daemon/lease/service.py`（AgentRunModelUsage 幂等落库现位于 :1168-1196，`_upsert_batch_model_usage`）、`backend/app/modules/daemon/router/session_insights.py`（model-usage 段 :933-1052）、`frontend/src/components/daemon/file-changes/file-changes-card.tsx`（props 面 :35-56）'
  - '对 design.md 与本变更目录下 .md 里出现的 `file:line` 引用做一次机械核对（行号是否越过文件总行数、指向函数是否存在），把越界/明显错位的条目就地改正并在句尾留「YYYY-MM-DD 校正」'
acceptance:
  - '`design.md` 中 `turn-timeline.tsx` 的两处锚点分别命中 `:2129-2133`（独立时间行删除留痕）与 `:2052-2054`（助手列 14px 分区），且文内不再出现 `:2117-2122` / `:2045-2048` 旧值'
  - 机械核对脚本输出「越界 0 条」；若发现越界项，逐条修正后重跑到 0
  - design.md 的 1b 行提到的文件全部存在于仓内（`Test-Path` 全 True），行号不超过各文件总行数
verify:
  - $f='frontend/src/components/daemon/turn-timeline.tsx'; (Get-Content $f)[2128..2132] -join "`n"; (Get-Content $f)[2051..2053] -join "`n"
  - Select-String -Path .sillyspec/changes/2026-10-20-session-page-dsh-alignment/design.md -Pattern "2117-2122|2045-2048" -SimpleMatch
constraints:
  - 只改文档（design.md / 注释），不改任何源码；源码行号只作为引用目标
  - 不得借此重写 design 的技术结论（锚点校正 ≠ 设计变更）；技术面变化必须回 brainstorm
  - 若发现 design 与源码语义不一致（不只是行号），不要在本卡改设计——登记到 tasks.md 的「剩余风险」并交主代理裁决
related_tests: []
---
