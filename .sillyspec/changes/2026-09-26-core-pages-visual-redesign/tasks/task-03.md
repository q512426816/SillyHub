---
id: task-03
title: 'primer 结构组件（PageHead/UnderlineNav/IssueRow/StatGrid）+ 单测'
title_zh: 'primer 结构组件（PageHead/UnderlineNav/IssueRow/StatGrid）+ 单测'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-27 00:40:13
priority: P0
depends_on: ['task-01', 'task-02']
blocks: []
requirement_ids: [FR-01, FR-03]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - frontend/src/components/primer/
  - frontend/src/components/primer/__tests__/
target_files:
  - NEW:frontend/src/components/primer/page-head.tsx
  - NEW:frontend/src/components/primer/underline-nav.tsx
  - NEW:frontend/src/components/primer/issue-row.tsx
  - NEW:frontend/src/components/primer/stat-grid.tsx
  - NEW:frontend/src/components/primer/__tests__/primer-structures.test.tsx
provides:
  - contract: PrimerUnderlineNav
    fields: [items, value, onChange]
  - contract: PrimerIssueRow
    fields: [state, title, meta, right, onClick, hoverActions, leading]
  - contract: PrimerIssueRowHeader
    fields: [columns]
expects_from:
  task-02:
    needs: [StateIcon, StateLabel, Counter 组件]
goal: >
  建 primer 结构组件四件：PageHead（面包屑+标题+操作组页头）、UnderlineNav（下划线
  tab）、IssueRow（两段式列表行）、StatGrid（统计格），承载五页面重排的骨架。
implementation:
  - NEW frontend/src/components/primer/page-head.tsx：breadcrumb/title/subtitle/actions 四插槽，标题 20px/600 对齐原型
  - NEW frontend/src/components/primer/underline-nav.tsx：受控 tabs（items 为 key/label/counter 对象数组），选中=文字主色+底部 2px 主题 token 指示条（原型橙色仅参考值，落地走主题 token），counter 联动 Counter
  - NEW frontend/src/components/primer/issue-row.tsx：两段式行（StateIcon+title 主行/meta 副行+right 元数据列+leading 批量插槽），hover 背景微亮+hoverActions 浮现；表头行 IssueRowHeader 同 grid template 对齐
  - NEW frontend/src/components/primer/stat-grid.tsx：N 格统计（label 灰小字+value 大数字 mono，tone=brand/warning 着色走语义阶）
  - NEW frontend/src/components/primer/__tests__/primer-structures.test.tsx：UnderlineNav 受控切换+counter 联动、IssueRow 插槽渲染+hover 操作、StatGrid tone、PageHead 插槽
acceptance:
  - UnderlineNav 受控（value/onChange 回调正确）+ Counter 计数联动断言
  - IssueRow 六 state 图标渲染 + leading 插槽 + hoverActions 存在性断言
  - 组件零硬编码色；tsc 0 新增错误
verify:
  - cd frontend && pnpm vitest run src/components/primer/__tests__/primer-structures.test.tsx
  - cd frontend && pnpm typecheck
constraints:
  - UnderlineNav 指示条色走主题 token（禁止 #fd8c73 字面量——该值仅原型 ai-native 参考值）
  - 不引 antd（结构组件纯 primer）；不改 task-02 已建原子文件
  - 键盘可达：UnderlineNav tab 间 Tab/Enter 可切换
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
