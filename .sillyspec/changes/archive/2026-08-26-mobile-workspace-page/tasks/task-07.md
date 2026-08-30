---
id: task-07
title: 'quicklog Tab + MobileDetailSheet 详情（listQuicklogEntries/quicklogPollInterval 复用）（FR-05）'
title_zh: 'quicklog Tab + MobileDetailSheet 详情（listQuicklogEntries/quicklogPollInterval 复用）（FR-05）'
author: 'qinyi'
created_at: 2026-08-27 01:45:00
priority: P1
depends_on: ['task-06']
blocks: ['task-16']
requirement_ids: [FR-05]
decision_ids: [D-002@V1]
allowed_paths:
  - src/app/m/workspaces/[id]/changes/page.tsx
  - src/app/m/workspaces/[id]/changes/__tests__/page.m-changes.test.tsx
goal: >
  在 task-06 变更列表移动页上补齐「快速修复」Tab：quicklog 卡片列表（listQuicklogEntries/
  quicklogPollInterval 数据层复用）+ MobileDetailSheet 全屏详情（FR-05，对齐原型快速修复屏）。
expects_from:
  task-06:
    - contract: changes/page.tsx 移动版列表骨架
      needs: [三Tab 结构与切换, 搜索词状态, MobileWorkspaceHeader 接线]
implementation:
  - 快速修复 Tab 分支渲染 quicklog 列表：useQuery 调 listQuicklogEntries(workspaceId, params)（lib/quicklog.ts:26 签名，search 与页内搜索词联动），refetchInterval 直传 quicklogPollInterval(items) 返回值（in_progress|stale → 30s、全终态 false，lib/quicklog.ts:49）
  - quicklog 卡片：标题/状态徽标（completed|in_progress|partial_done|stale）/作者/相对时间；点击记录 openId
  - 详情用 MobileDetailSheet 全屏承载（mobile-detail-sheet.tsx:19 props：open/title/onClose/children/onSubmit）——纯展示场景 submitText 用「关闭」、onSubmit 复用 onClose；children 渲染 getQuicklogDetail(workspaceId, qlId) 内容（状态/文件列表/关联变更 chip → 钻取变更详情）
  - 测试（追加进 task-06 已建同一测试文件）：Tab 切换渲染卡片、点击打开 Sheet、refetchInterval 收到 quicklogPollInterval(items) 返回值断言
acceptance:
  - 「快速修复」Tab 展示 quicklog 卡片列表，数据与轮询语义复用 lib/quicklog.ts 既有函数（零复制实现）
  - 点击卡片 MobileDetailSheet 全屏打开详情（max-w-480 居中），关闭返回列表
  - 存在 in_progress|stale 条目时 30s 轮询、全终态自动停轮
  - task-06 已交付的「进行中/已归档」Tab 与列表结构零改动
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- 'src/app/m/workspaces/[id]/changes/__tests__/page.m-changes.test.tsx'
constraints:
  - 在 task-06 产出之上增量实现 quicklog Tab 内容与详情 Sheet，不重写列表结构；测试追加进 task-06 已建测试文件（若其命名不同则从其命名）
  - 不改 lib/quicklog.ts 与后端，数据层 100% 复用既有函数
  - 样式走 brand-*/语义 token（不写死色值），触摸热区 ≥44px、正文 ≥14px
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
