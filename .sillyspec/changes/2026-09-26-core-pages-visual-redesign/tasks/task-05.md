---
id: task-05
title: '变更中心列表页重排（四层结构/IssueRow 列表/flash 告警收敛）+ 测试同步'
title_zh: '变更中心列表页重排（四层结构/IssueRow 列表/flash 告警收敛）+ 测试同步'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-27 00:40:13
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-03, FR-08]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/
  - frontend/src/components/changes/
target_files:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
related_tests:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx
  - frontend/src/components/changes/__tests__/platform-sync-section.test.tsx
expects_from:
  task-03:
    needs: [PageHead, UnderlineNav, IssueRow, IssueRowHeader]
  task-02:
    needs: [StateIcon, StateLabel, Counter, EmptyState]
goal: >
  变更中心列表页从 7 层堆叠+7 列小字表格重排为 GitHub Issues 式四层结构，
  antd Table 退役换 IssueRow 行式列表，行为（轮询/深链/批量/排序）全保留。
implementation:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx（881 行）重排：面包屑+PageHead（标题+「进行中 N」副标题+新建变更主按钮）→ 工具条（筛选/排序+搜索）→ UnderlineNav 状态 tab（进行中/已归档/轻量修复，Counter 实时计数，承接 quicklog tab 筛选语义）→ IssueRow 列表（表头 IssueRowHeader 同 grid 对齐）
  - 条件区收敛：PlatformSyncSection（frontend/src/components/changes/platform-sync-section.tsx:749）与解析警告卡收敛为页头下单条可展开 flash 告警条（有内容才渲染，FR-03 MUST NOT 空占位）；reparse 统计并入工具条说明文字
  - 保留：智能轮询 30s（全终态停轮）、?tab=/?search= URL 深链、批量多选（IssueRow leading 插槽接既有批量 state）、列排序（时间列沿用现有 handler）
  - 同步修 frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx 与 platform-sync-section.test.tsx 断言（改断言不改意图）
acceptance:
  - 页面 DOM 四层结构对照原型「变更中心」视图一致；antd Table 引用从本页移除
  - 状态 tab 切换即时过滤 + Counter 联动；深链 ?tab= 直达保持
  - 空列表呈现 EmptyState；既有测试改断言后全绿
verify:
  - cd frontend && pnpm vitest run "src/app/(dashboard)/workspaces/[id]/changes" src/components/changes/__tests__/platform-sync-section.test.tsx
  - cd frontend && pnpm typecheck
constraints:
  - 不改数据层 hooks/轮询逻辑；PlatformSyncSection 裁决操作功能零丢失（仅收纳形态）
  - 移动端 /m/changes 零波及（不改 app/m/）
  - 正文 ≥12px；删除类操作不用 window.confirm
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
