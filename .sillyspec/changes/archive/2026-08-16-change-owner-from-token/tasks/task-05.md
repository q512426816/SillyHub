---
id: task-05
title: Frontend owner column username + timeline event styling + no truncation + tests
title_zh: 前端——owner 列用户名 + 时间线事件样式 + 明细不截断 + 测试
author: qinyi
created_at: 2026-08-16 11:40:00
priority: P0
depends_on: [task-03]
blocks: [task-06]
requirement_ids: [FR-03, FR-04, FR-05]
decision_ids: [D-003@v1, D-004@v1]
allowed_paths:
  - "frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx"
  - "frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx"
  - "frontend/src/components/changes/detail/change-step-timeline.tsx"
  - "frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx"
expects_from:
  task-03:
    - contract: "components.schemas.StepTimelineEntry（frontend/src/lib/api-types.ts，pnpm gen:types 产物）"
      needs: ["kind?: string（\"step\" | \"event\"，缺省视为 step）", "event_type?: string | null"]
    - contract: "components.schemas.ChangeSummary"
      needs: ["owner_name?: string | null（display_name 优先 username fallback，enrich 批量填）"]
goal: 列表 owner 列改用户名三态渲染（owner_name 优先 / UUID 前 8 位 / —），ChangeStepTimeline 支持 kind=event 专属样式（👤 emoji dot + 紫色 chip），明细 line-clamp-2 移除改自然换行 + 滚动兜底，配四组组件测试 + owner 三态页测。
implementation:
  - page.tsx renderOwner（:270-282）改三态——owner_name 非空优先展示用户名（小字号，非 mono）；owner_name 空 && owner_id 有值 → 现状 UUID 前 8 位 mono fallback；两者皆空 → —。同步重写注释：旧注释「勿为此加后端字段」已被 task-03 owner_name 契约取代，改注来源=enrich 批量 join users（design §5 Phase 2.1，task-04 落地）
  - change-step-timeline.tsx TimelineItem 按 entry.kind 分支——kind === "event" 走事件渲染；undefined / "step" 走现有 step 渲染零增改（旧数据 kind 缺省兼容，design §9）；stage 归组遍历与 itemKey（:189 `${stage}-${ordering}`）拼法不动——事件条目的 stage 归属与 ordering 唯一性由 task-04 后端混合序列统一重编保证，前端无需改 key 机制
  - 事件专属渲染（对齐原型 .tl-item.owner-event / .owner-chip）——dot 位换 👤 emoji span（定位同现有 dot 位，替代色点与 data-status 色映射）；head 行 = name + 紫色 chip：inline-flex 圆角小 chip（bg-purple-50 / text-violet-600 / border-purple-200），内容 👤 + output（"A → B"，箭头 → 用 violet-400 加粗，原型 .arrow #a78bfa）；事件条目根节点加 data-kind="event" 供测试锚定（step 条目不加新属性，DOM 零增改）；底部 output <p> 在事件分支不再渲染（output 已进 chip，避免 A → B 重复两次）；completed_at 沿用现有 time 元素渲染（事件 status=completed，design §5 Phase 2.2）
  - Phase 2.4 明细不截断（D-004@v1）——step 分支 output <p>（:108-115）line-clamp-2 移除，保留 break-words 自然换行；加 max-h + overflow-y-auto 滚动兜底（R-07 超长不撑爆布局）；随 clamp 移除一并清理冗余的 title 悬停全文属性（全量可见后无意义）
  - 注释同步（CLAUDE.md 规则 18 注释与实现一致）——组件头注释 :17「output 后端已截断 200 字，前端再叠 line-clamp + word-break（R-05）」改写为「output 全量透传（D-004@v1 修订 step-visibility R-02），前端自然换行 + max-h 滚动兜底」；两测试文件头注释中「output 摘要」旧表述同步
  - 测试四组（change-step-timeline.test.tsx）+ 页测三态（page.test.tsx）——①事件渲染：kind=event 条目 → [data-kind="event"] 存在、chip 文本含 "A → B" 与 👤、无 data-status 色点；②混合排序：同 stage 事件与 steps 交错（ordering 已由后端重编）→ DOM 序遵循 entries 顺序、data-key 序列无重复；③纯 steps 零变化回归：全部 kind 缺省 → 现有用例（七值色/分组/key 稳定/waiting）全绿，容器内无 data-kind="event"；④长文本不 clamp：超长 output → 输出 <p> className 不含 line-clamp、含 break-words 与 max-h（原 :141-142 断言按新行为翻转，行为变更由 D-004@v1 明确授权非改测试凑过）；页测 §6 补 owner_name 维度：owner_name="qinyi" → 显示 qinyi / owner_name=null + owner_id → 前 8 位 / 双空 → —
acceptance:
  - 事件条目专属样式渲染（data-kind="event" + 👤 emoji dot + 紫色 chip 含 "A → B"）
  - 纯 steps 数据（kind 缺省/undefined）渲染与现状零变化（现有用例除 clamp 断言按 D-004 翻转外零改动全绿）
  - 长文本自然换行无 clamp（break-words + max-h 滚动兜底）
  - owner 列三态：owner_name 优先 / fallback UUID 前 8 位 / 双空降级 —
verify:
  - cd frontend && pnpm exec vitest run src/components/changes/detail/__tests__/change-step-timeline.test.tsx "src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx"（若 vitest 把路径 [id] 当 glob 字符类误读致 0 命中，退化为 pnpm exec vitest run src/app src/components/changes 或全量跑）
  - cd frontend && pnpm exec tsc --noEmit
constraints: [纯展示层不改数据获取逻辑, "kind 缺省/undefined 走 step 分支（旧数据兼容 design §9）", 样式对齐原型紫 chip（bg-purple-50/text-violet-600/border-purple-200）]
---

# TaskCard — 前端——owner 列用户名 + 时间线事件样式 + 明细不截断 + 测试

## 依据

- design.md §5 Phase 3（前端三点：owner 列 owner_name 优先 / kind=event 专属样式（👤 紫色 chip，dot 用 emoji 替代色点）/ 组件测试）、§5 Phase 2.4（line-clamp-2 移除改自然换行 + break-words）、§6 文件清单（page.tsx / change-step-timeline.tsx / 其测试）、§9 兼容（kind 默认 step 旧数据零影响）、R-07（max-h 容器滚动兜底）
- decisions.md D-003@v1（履历=时间线合成事件条目，kind 区分 + 纯 steps 零变化）、D-004@v1（明细不截断，修订 2026-08-15-change-step-visibility R-02——截断仅保留列表摘要层）
- requirements.md FR-03（事件条目专属样式/纯 steps 零变化）、FR-04（owner_name 展示/空降级 —）、FR-05（明细不 clamp 自然换行/列表摘要截断不动）
- plan.md task-05 行（Wave 3，依赖 task-03 契约，与 task-04 后端读侧并行文件不相交，阻塞 task-06 全量回归）
- 原型 prototype-owner-events.html：①段 owner 列显示用户名（.owner-chip，未上行 —）；②段 .tl-item.owner-event（👤 emoji dot 替代色点）+ .owner-chip（bg #faf5ff / 字 #7c3aed / 边 #e9d5ff）+ .arrow（#a78bfa 加粗）

## 现状实证（改动锚点）

- page.tsx:270-282 renderOwner 现两态：—（owner_id 空）/ UUID 前 8 位 mono；注释「勿为此加后端字段（零 migration）」已过时，task-03 契约落地 owner_name 后须重写
- change-step-timeline.tsx:108-115 output `<p>`：`line-clamp-2 max-w-[560px] break-words` + `title` 悬停全文——clamp 与 title 均为截断时代产物
- change-step-timeline.tsx:186-192 itemKey = `${stage}-${ordering}`——事件 key 唯一性靠 task-04 后端对混合序列统一重编 ordering（design §5 Phase 2.2 Grill P1-1），前端 key 拼法零改动
- change-step-timeline.tsx:17 头注释「output 后端已截断 200 字，前端再叠 line-clamp + word-break（R-05）」——D-004 后表述失真须同步
- api-types.ts:15264-15279 StepTimelineEntry 现状 7 字段无 kind/event_type——本 task 消费的字段全部 expect 自 task-03 的 gen:types 产物，**禁止手写补字段**（CLAUDE.md 规则 21）

## 既有断言更新（授权依据，非改测试凑过）

- change-step-timeline.test.tsx:122-143「completed 步显示 ISO completed_at 与 output 摘要（line-clamp + word-break）」现断言 `line-clamp-2` 存在——D-004@v1 明确修订该行为（明细不截断），断言翻转为「不含 line-clamp + 含 break-words/max-h」，用例名与头注释同步
- page.test.tsx §6（:391-410）owner 列两用例补 owner_name 维度；makeChange fixture 不必加默认 owner_name（optional 字段），三态用例各自显式传入

## 与 task-04 的边界

- 本 task 只消费契约字段做纯渲染，不碰后端 enrich/合成逻辑；事件条目的 stage 归属/ordering 重编由 task-04 保证，本组件分组遍历零改动天然兼容
- gen:types 产物（api-types.ts/openapi.json）归 task-03，不在本 task allowed_paths
