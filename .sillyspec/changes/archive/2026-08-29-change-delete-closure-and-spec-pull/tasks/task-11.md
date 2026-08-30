---
id: task-11
title: 'backend 活动投影（ChangeSummary + last_pushed_at + enrich 顺带取值 + 两态单测）'
title_zh: 'backend 活动投影（ChangeSummary + last_pushed_at + enrich 顺带取值 + 两态单测）'
author: 'qinyi'
created_at: 2026-08-29 12:57:58
priority: P1
depends_on: []
blocks: ['task-12']
requirement_ids: [FR-09]
decision_ids: [D-007@v1]
provides:
  - 'ChangeSummary DTO 新增可空字段 last_pushed_at（str | None，客户端 ISO 原文透传）——task-12 活动徽标消费'
allowed_paths:
  - 'backend/app/modules/change/schema.py'
  - 'backend/app/modules/change/service.py'
  - 'backend/app/modules/change/tests/test_enrich_projection.py'
  - 'backend/openapi.json'
  - 'frontend/src/lib/api-types.ts'
goal: >
  列表接口把 platform_change_progress.last_pushed_at（既有列，从未投影到前端）
  透传到 ChangeSummary，为前端活动徽标（task-12）提供「最后信号」数据源；
  零 migration、零新增查询（design §8.1 Layer 1，纯 CLI 变更进行中可见性）。
implementation:
  - 'schema.py ChangeSummary（:108-138）加 last_pushed_at: str | None = None——计算字段（DTO 层），非 changes 表列，零 migration；optional default None（brownfield 安全，旧客户端不读不受影响）；注释注明数据源=progress 行既有列（platform_sync/model.py:90-93，String ISO 原文）'
  - 'service.py _project_current_stage（:1910-1943）：既有复合 IN join 的 SELECT 列表顺带加 PlatformChangeProgressORM.last_pushed_at，返回映射的值扩为携带该字段（stage, completed, latest_progress 之后追加）；既有消费点 _resolve_pending_change_keys（:1890-1908，现丢弃尾元）等解包处同步适配，行为不变'
  - 'service.py enrich_summaries（:1581-1628）：stage_info 命中处顺带 summary.last_pushed_at = 取值；join 不命中（无 progress 行）保持 None fallback（D-003 范式，与 current_stage 同款）'
  - '不做任何服务端时间解析/校验：ISO 原文 String 透传（畸形串防御解析归 task-12 前端，design §8.1）'
  - '跑 pnpm gen:types 并提交 frontend/src/lib/api-types.ts + backend/openapi.json（CLAUDE.md 规则 21；先确认前端 node_modules 健康：pnpm exec tsc --version 能跑，半坏先 pnpm install --force）'
  - 'test_enrich_projection.py 加两态单测：①progress 行带 last_pushed_at → summary 投影该值；②无 progress 行（或列值为 None）→ summary.last_pushed_at 为 None'
acceptance:
  - 'ChangeSummary 响应含 last_pushed_at（可空 ISO 字符串，原文透传）；openapi.json 与 frontend/src/lib/api-types.ts 已再生成并同步提交'
  - 'enrich 路径零新增 SQL 查询——仅扩 _project_current_stage 既有 SELECT 列（R-03 禁 N+1 不破）'
  - '两态单测（有值/无 progress 行）通过；既有 enrich 投影测试零回归'
verify:
  - 'cd backend && python -m pytest app/modules/change/tests/test_enrich_projection.py -q'
  - 'cd frontend && pnpm gen:types && pnpm exec tsc --noEmit'
constraints:
  - '零 migration、零新列：复用 platform_change_progress.last_pushed_at 既有字段（design §9 明确波 4 无新列）'
  - '禁新增查询/新 join：只在既有 join 的 SELECT 列表加列'
  - '不做服务端时间解析、不推导「停滞/进行中」——展示层关注点不进后端 DTO（阈值判断归 task-12）'
  - '只跑本任务相关测试，全量留 CI（CLAUDE.md 规则 0）'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
