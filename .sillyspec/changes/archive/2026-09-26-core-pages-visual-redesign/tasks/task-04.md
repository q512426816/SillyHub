---
id: task-04
title: 'primer 时间线与侧栏组件（Timeline/MetaPanel）+ 桶导出 index.ts + 单测收口'
title_zh: 'primer 时间线与侧栏组件（Timeline/MetaPanel）+ 桶导出 index.ts + 单测收口'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-27 00:40:13
priority: P0
depends_on: ['task-02', 'task-03']
blocks: []
requirement_ids: [FR-01, FR-04]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - frontend/src/components/primer/
  - frontend/src/components/primer/index.ts
  - frontend/src/components/primer/__tests__/
target_files:
  - NEW:frontend/src/components/primer/timeline.tsx
  - NEW:frontend/src/components/primer/meta-panel.tsx
  - NEW:frontend/src/components/primer/index.ts
provides:
  - contract: PrimerTimeline
    fields: [icon, title, time, tone, children]
  - contract: PrimerMetaPanelSection
    fields: [title, children]
expects_from:
  task-02:
    needs: [StateIcon, StateLabel]
  task-03:
    needs: [PageHead, UnderlineNav, IssueRow, StatGrid]
goal: >
  补齐 primer 时间线与侧栏组件（变更详情页两区骨架），建 index.ts 桶导出收口
  全部十个原语，Wave 1 组件库闭环。
implementation:
  - NEW frontend/src/components/primer/timeline.tsx：Timeline 容器（左 3px 竖线）+ TimelineItem（icon 节点圆标/title/time/tone=default|current|success/children 可折叠日志块）
  - NEW frontend/src/components/primer/meta-panel.tsx：MetaPanel 侧栏容器（细边框圆角浅底）+ MetaPanelSection（title + children dl 分组）
  - NEW frontend/src/components/primer/index.ts：桶导出 task-02/03/04 全部组件（十原语）
  - 单测：TimelineItem 折叠交互 + tone 变体 + MetaPanelSection 分组渲染（追加进 primer-structures.test.tsx）
acceptance:
  - index.ts 导出 10 个组件族（StateIcon/StateLabel/Counter/EmptyState/PageHead/UnderlineNav/IssueRow 系[IssueRow+IssueRowHeader]/StatGrid/Timeline 系/MetaPanel 系）
  - TimelineItem children 折叠/展开可交互断言
  - Wave 1 全部单测一次跑全绿；tsc 0 新增错误
verify:
  - cd frontend && pnpm vitest run src/components/primer/
  - cd frontend && pnpm typecheck
constraints:
  - 不实现具体业务逻辑（事件类型映射等由消费页面做）
  - 折叠动画 MAY 省略（纯显隐即可，避免引动画依赖）
  - index.ts 只做 re-export 零逻辑
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
