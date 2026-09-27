---
id: task-07
title: '工作区列表页重排（行式列表/drag-grid 行式化/规范分页/Modal 删除）+ 测试同步'
title_zh: '工作区列表页重排（行式列表/drag-grid 行式化/规范分页/Modal 删除）+ 测试同步'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-27 00:40:13
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-05, FR-08]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/page.tsx
  - frontend/src/app/(dashboard)/workspaces/__tests__/
  - frontend/src/components/workspace-card.tsx
  - frontend/src/components/workspace-drag-grid.tsx
target_files:
  - frontend/src/app/(dashboard)/workspaces/page.tsx
  - frontend/src/components/workspace-card.tsx
  - frontend/src/components/workspace-drag-grid.tsx
related_tests:
  - frontend/src/app/(dashboard)/workspaces/__tests__/page.test.tsx
expects_from:
  task-02:
    needs: [StateIcon, StateLabel, Counter, EmptyState]
  task-03:
    needs: [PageHead]
goal: >
  工作区选择页从卡片网格重排为 GitHub Repositories 行式列表，拖拽排序保留
  （drag-grid 纵向化），手写分页换规范分页，window.confirm 删除换 antd Modal。
implementation:
  - frontend/src/app/(dashboard)/workspaces/page.tsx（597 行）重排：PageHead（「工作区」+计数副标题+添加工作区主按钮）→ 工具行（搜索+状态/技术栈筛选）→ 行式列表（frontend/src/components/workspace-card.tsx:356 重构为行条目：状态点+名称 15px/600+slug mono+技术栈色点+守护 StateLabel+「N 个进行中」Counter+更新时间+chevron；保留重新扫描/删除 hover 操作）
  - frontend/src/components/workspace-drag-grid.tsx 改造为纵向行容器（grid-cols 网格→单列 flex，HTML5 拖拽排序逻辑保留）
  - workspace-card.tsx:133 的 window.confirm 删除改 antd Modal（FR-08）；手写「上一页/下一页」（page.tsx:539）改 antd Pagination
  - 信息字段承接 FR-auto-frontend-009（路径/技术栈/守护状态/关联项目全保留）；排序切换与 URL 参数承接 FR-auto-frontend-010；重新扫描入口承接 FR-auto-frontend-008
  - 同步修 workspaces/__tests__/page.test.tsx 断言
acceptance:
  - DOM 对照原型「工作区」视图行式列表；拖拽排序可用
  - grep 本 task 文件无 window.confirm；分页为 antd Pagination
  - 既有测试改断言后全绿
verify:
  - cd frontend && pnpm vitest run "src/app/(dashboard)/workspaces/__tests__"
  - cd frontend && pnpm typecheck
constraints:
  - 拖拽排序持久化逻辑（localStorage/接口）零改动
  - WorkspaceScanDialog 新建向导零改动（仅按钮位置/样式）
  - 移动端工作区页零波及
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
