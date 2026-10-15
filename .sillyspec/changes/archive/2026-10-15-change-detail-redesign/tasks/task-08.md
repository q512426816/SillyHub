---
id: task-08
title: "Archived-mode narrowing and empty-state mutual exclusion"
title_zh: "归档态收窄与两态空态互斥清理（含承接表核对）"
author: qinyi
created_at: 2026-10-16 00:25:57
priority: P0
depends_on: [task-07]
blocks: []
requirement_ids: [FR-01, FR-04, FR-07, FR-13]
decision_ids: [D-001@v1, D-007@v1, D-009@v1, D-015@v1, D-016@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
  - NEW:frontend/src/components/changes/detail/change-overview-panel.tsx
  - NEW:frontend/src/components/changes/detail/change-overview-side.tsx
  - frontend/src/components/changes/detail/change-assets-card.tsx
  - NEW:frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-tabs.test.tsx
target_files:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
  - NEW:frontend/src/components/changes/detail/change-overview-panel.tsx
  - NEW:frontend/src/components/changes/detail/change-overview-side.tsx
  - frontend/src/components/changes/detail/change-assets-card.tsx
  - NEW:frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-tabs.test.tsx
goal: >
  跨面板收口归档语义：归档态不得渲染在途空态、在途态不得渲染归档空位；归档态隐藏「继续执行」、用量改合计形态、对账入口改指「产出 · 归档留档」不留死链；并复核六条被取代活需求的承接落笔。
implementation:
  - "页面层（page.tsx）：归档态页头不出「继续执行」主按钮（在途态保留）；确认 tab 集由 visibleTabs(archived) 单布尔驱动（thin 不特判）"
  - "概览面板/信息栏：归档首屏为成果语义且无执行中类文案；信息栏用量区「执行用量（合计）」且无按模型明细展开；范围对账入口改指「产出 · 归档留档」"
  - "资产卡：确认在途态不渲染「归档留档」组（实现与断言均在 task-03 的 change-assets-fallback.test.tsx）；本卡只做归档收窄后的复验，不新增该行为的实现或断言"
  - "页面级断言补齐（frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-tabs.test.tsx）：归档态 tab 集=3、无「继续执行」、无在途空态文案、对账入口指向产出 tab；在途态无「归档留档」文本"
  - "承接表核对：对本变更取代的 6 条活需求（FR-unmapped-497 / FR-auto-frontend-056 / FR-build-133 / FR-build-134 / FR-auto-frontend-087 / FR-styles-011）逐条确认 requirements.md 承接行与 decisions.md D-009 记录一致、无遗漏分句（含 FR-styles-011 的 Agent 执行日志分句处置），不改后端与知识库索引（归档链路负责翻 superseded）"
acceptance:
  - "归档态：页头无「继续执行」；tab 集 3 个；DOM 中不含「进行中」「执行中」类在途文案；用量区标题为「执行用量（合计）」且无明细展开按钮"
  - "在途态：DOM 中不含「归档留档」文本；页头「继续执行」在场"
  - "归档态范围对账入口指向「产出 · 归档留档」（不指向已隐藏的「文件与对账」tab，无死链）"
  - "六条被取代活需求在 requirements.md/decisions.md 中均有承接或取代记录，逐条可指认（含 FR-styles-011 三分句：阶段条/事件流/Agent 日志）"
verify:
  - "cd frontend && pnpm exec tsc --noEmit"
  - "cd frontend && pnpm exec vitest run frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/ frontend/src/components/changes/detail/__tests__"
constraints:
  - "不改后端；不改知识库 fr/decisions 索引（归档阶段由 CLI 翻 superseded）"
  - "MUST NOT 以「隐藏」替代「收窄」而破坏深链钳制（?tab=files 仍须 replace 回概览）"
  - "禁硬编码 hex；文案中文；不留 TODO 占位"
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
