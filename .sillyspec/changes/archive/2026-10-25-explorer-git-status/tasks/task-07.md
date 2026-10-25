---
id: task-07
title: 'explorer 树四色着色——file-explorer.tsx 渲染期状态映射（含改动目录蓝点/忽略灰徽标/点击行为不变；回归既有 file-explorer.test.tsx）+ 着色测试 + 收尾对账（原型 3 件冻结重编译/漂移产物还原/验收对照）'
title_zh: 'explorer 树四色着色——file-explorer.tsx 渲染期状态映射（含改动目录蓝点/忽略灰徽标/点击行为不变；回归既有 file-explorer.test.tsx）+ 着色测试 + 收尾对账（原型 3 件冻结重编译/漂移产物还原/验收对照）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-25 20:18:25
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-003@v2, D-005@v1, D-011@v1]
allowed_paths:
  - frontend/src/components/explorer/file-explorer.tsx
  - frontend/src/components/explorer/__tests__/file-explorer.test.tsx
  - NEW:frontend/src/components/explorer/__tests__/file-explorer-git-status.test.tsx
  - frontend/src/components/prototype/explorer-git-status-view.tsx
  - frontend/scripts/prototype-build.mjs
  - frontend/prototype-dist/explorer-git-status.html
target_files:
  - frontend/src/components/explorer/file-explorer.tsx
  - NEW:frontend/src/components/explorer/__tests__/file-explorer-git-status.test.tsx
expects_from:
  - task-04: useGitLogDirtyFiles hook
related_tests:
  - frontend/src/components/explorer/__tests__/file-explorer.test.tsx（树渲染变更回归）
goal: >
  explorer「文件」页树按 git 状态四色着色（FR-01）+ 本变更收尾对账
  （原型冻结、漂移产物还原、验收对照）。
implementation:
  - frontend/src/components/explorer/file-explorer.tsx 组件内自取 useGitLogDirtyFiles（对齐 GitStatusBar 组件自取先例，不改 explorer page 装配）；构建 path→status Map 与「含改动祖先目录」前缀集合（子树含 added/modified/deleted/untracked 任一即算，ignored 不算——D-011）
  - 着色渲染按 design.md §Phase 4「实现注意」（Grill P2-③）：现有 renderTitle 是模块级纯函数、title 已固化进 treeData state（file-explorer.tsx:121-146、:271）——改为渲染期读取状态映射（title 组件化订阅状态 Map，或以 dirty-files 数据为 treeData useMemo 依赖重建），否则晚到的 dirty-files 不触发已渲染节点变色
  - 文件节点四色文件名；祖先目录名旁蓝点（bg-primary 圆点）；忽略条目（ignored is_dir 目录整体/单文件）text-muted-foreground + 「忽略」小徽标，不递归；**节点点击行为不变**（仍 onSelect→FilePreview，D-005）；查询失败/加载中静默降级为现状无色渲染，不阻断浏览；explorer 树图例不含删除色（fs 扫描树无已删除文件，design §接口定义尾说明）
  - NEW:frontend/src/components/explorer/__tests__/file-explorer-git-status.test.tsx：注入状态后节点类名断言（四色各一）、忽略目录灰+徽标、目录蓝点、无状态/失败时与现状渲染一致、点击行为回归（选中仍触发预览回调）
  - 回归 frontend/src/components/explorer/__tests__/file-explorer.test.tsx（既有树行为不破）
  - 收尾对账：cd frontend && pnpm prototype:build 重编译冻结 explorer-git-status.html（源 explorer-git-status-view.tsx + prototype-build.mjs 已在 brainstorm 落盘）；git checkout -- 还原 prototype-dist/ 其余 11 个依赖重装漂移产物（R-05）；对照 design.md 逐项验收（FR-01~05 证据收集）
acceptance:
  - 着色测试与 explorer 回归全绿；tsc 无新错误
  - 原型产物与源码同源（重编译后 git diff 仅预期新增 explorer-git-status.html，其余 11 产物 diff 为空）
  - design.md 验收条目逐项有证据
verify:
  - cd frontend && pnpm exec vitest run src/components/explorer/__tests__/file-explorer-git-status.test.tsx src/components/explorer/__tests__/file-explorer.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm prototype:build && git status --short frontend/prototype-dist/
constraints:
  - 不改 explorer 既有四端点契约与取数逻辑（D-008 落选面）；不改节点点击行为（D-005）
  - 着色为展示层叠加，dirty-files 查询失败静默降级不抛 UI 错误
  - 颜色一律 tailwind 语义 token；禁手改 prototype-dist 产物（只能重编译）
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
