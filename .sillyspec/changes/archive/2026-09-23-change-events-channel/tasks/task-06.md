---
id: task-06
title: '前端观测事件折叠区组件 + 详情页挂载'
title_zh: '前端观测事件折叠区组件 + 详情页挂载'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-23 04:16:42
priority: P0
depends_on: ['task-05']
blocks: [task-07]
requirement_ids: [FR-05, FR-06, FR-07]
decision_ids: [D-004, D-006]
allowed_paths:
  - frontend/src/components/changes/detail/change-events-card.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
target_files:
  - NEW:frontend/src/components/changes/detail/change-events-card.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
goal: >
  变更详情页 aside「观测事件」折叠卡：30s 轮询自取数、warning 琥珀高亮、provisional 徽标、
  角标计数、失败静默隐藏（QuicklogLinkedCard 先例，design D-006）。
implementation:
  - 新建 change-events-card.tsx：useQuery（queryKey changeEvents 前缀、
    refetchInterval 30_000、refetchOnWindowFocus false、retry false；isError → return null 静默）
  - 折叠 state：默认收起；items 含 severity 为 warning 时 defaultExpanded=true 且标题角标
    Badge 显示 warning 计数（醒目琥珀）
  - 时间线行：时间（toLocaleString zh-CN 短格式）/事件类型 kind/规则 rule 可选/详情 detail 可选；
    severity=warning 行琥珀高亮类（FR-06）；每行 provisional 徽标
    （小 Tag + title 悬停说明"旁路观测信号，非流程真相"）
  - 空态"暂无观测事件"；data-testid=change-events-card 供测试定位
  - 详情页 page.tsx aside（ScopeAuditCommandCard 之后）挂载 ChangeEventsCard（传 workspaceId 与 change.change_key）
acceptance:
  - 折叠行为（缺省收起/有 warning 展开）+ 高亮 + 徽标 + 角标全落地（FR-05/06）
  - pnpm typecheck/lint 过
verify:
  - cd frontend && pnpm typecheck && pnpm lint
constraints:
  - 纯只读展示零业务逻辑（D-004 红线：不触发任何流程动作）
  - 样式照同页卡片范式（FRONTEND_PAGE_STYLE.md，R-05 豁免独立原型）
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
