---
id: task-04
title: 'scan-docs path deep link'
title_zh: '模块文档页 ?path= 深链（选中定位/消费时机/查无静默）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 16:26:20
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-006@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx
target_files:
  - frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx
goal: >
  模块文档页支持 ?path= 深链：搜索结果点击 docs/ 类文档跳入后自动选中该文档；
  目标尚未同步时静默待命（列表刷新出现即自动选中）；用户手动点选后不再自动跳。
implementation:
  - frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx：useSearchParams() 读 path 参数；新增 deepLinkDoneRef（消费标记）+ 待命匹配 effect——docs（ScanDocSummary[]）就绪后 find(d => d.path === path)，命中则调既有 requestDoc(summary.id)（scan-docs/page.tsx:338-348 既有链路：getScanDoc → selectDoc），选中后置位 deepLinkDoneRef
  - 消费时机：命中前每次列表刷新（含进页 reparse 的静默刷新，scan-docs/page.tsx:279-295）都重试匹配——目标出现即自动选中；用户手动点选（onSelect 树）同样置位不再自动跳；查无时静默留在列表态（不报错、不提示、不重试请求）
  - 参数一次性消费语义与 knowledge 页 deepLinkDoneRef（knowledge/page.tsx:443-452）同构；无 ?path= 时行为与现状完全一致（零副作用）
  - 配测试 frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx（扩展）：?path= 命中 → requestDoc/selectDoc 被调且文档渲染；首次列表未含目标、刷新后出现 → 自动选中；查无 → 无报错 UI 且列表正常；手动点选后列表刷新不再自动跳；无参数 → 既有行为不变
acceptance:
  - 带 ?path=<已存在文档> 进页 → 该文档被选中并渲染内容
  - 目标未同步（首次列表无）→ 静默；后续刷新出现 → 自动选中一次
  - 查无此文件 → 列表态正常、无错误提示、无重复请求
  - 无 ?path= → 与现状行为一致（既有测试不改断言全绿）
verify:
  - cd frontend && pnpm exec vitest run "src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx"
  - cd frontend && pnpm exec tsc --noEmit && pnpm lint
constraints:
  - MUST NOT 改动 scan-docs 既有搜索（debounce q）/reparse/卡片-原文双 tab 行为
  - requestDoc 链路 MUST 复用既有函数（MUST NOT 复制一份取文档逻辑）
  - 查无时 MUST NOT 轮询/重试额外请求（只在列表刷新事件上重试匹配，不主动拉列表）
  - MUST NOT 新增依赖；组件测试 JSdom 兼容（mock next/navigation useSearchParams）
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
