---
id: task-09
title: 'Quick legacy annotation across UI surfaces'
title_zh: 'quick 存量标注（前端五处）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-25 07:14:58
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/changes/quicklog-table.tsx
  - frontend/src/app/m/workspaces/[id]/changes/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
  - frontend/src/components/workspace/stats-row.tsx
target_files:
  - frontend/src/components/changes/quicklog-table.tsx
  - frontend/src/app/m/workspaces/[id]/changes/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
  - frontend/src/components/workspace/stats-row.tsx
goal: >
  quicklog 面板与统计面加「存量」标注，空态与文案不再指路已退役的 sillyspec quick，指路轻量变更。
implementation:
  - frontend/src/components/changes/quicklog-table.tsx:346 空态文案换退役指引（「存量快速修复已收尾/旧的 quick 通道不再产生新条目，新的小修复走变更列表『轻量变更』」）；表头/标题加存量标注
  - frontend/src/app/m/workspaces/[id]/changes/page.tsx:873 空态文案同款替换；:114 quicklog tab 徽标改「存量 · N」
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx:66 tab 徽标「存量 · N」；:595-599 副标题改存量口径（「N 条存量快速修复记录」）
  - frontend/src/components/workspace/stats-row.tsx:96-101 第四统计卡 label 改「快速修复（存量）」
  - 形态对照原型 prototype-change-center-thin-flow.html C 面
acceptance:
  - 全站无残留「在仓库跑 sillyspec quick 后…」类指路文案（桌面+移动）
  - quicklog tab 徽标/副标题/统计卡三处带存量口径；数据链路零改动
verify:
  - cd frontend && pnpm exec tsc --noEmit && pnpm test -- quicklog-table
constraints:
  - 纯文案/标注面，quicklog 查询与渲染逻辑不动；蒸馏源「快速修复」选项保留（存量口径）
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
