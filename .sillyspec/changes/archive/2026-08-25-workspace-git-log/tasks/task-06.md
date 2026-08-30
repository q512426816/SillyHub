---
id: task-06
title: '前端页面与组件（TABS 注册/page 骨架/commit-list 虚拟滚动/commit-graph 泳道 SVG/detail Drawer/file-tree 目录树）+ 组件测试'
title_zh: '前端页面与组件（TABS 注册/page 骨架/commit-list 虚拟滚动/commit-graph 泳道 SVG/detail Drawer/file-tree 目录树）+ 组件测试'
author: 'qinyi'
created_at: 2026-08-25 21:37:20
priority: P0
depends_on: ['task-05']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-06]
decision_ids: [D-001@v1, D-005@v1]
allowed_paths:
  - frontend/src/components/workspace-tabs.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/git-log/page.tsx
  - frontend/src/components/git-log/commit-list.tsx
  - frontend/src/components/git-log/commit-graph.tsx
  - frontend/src/components/git-log/commit-detail-drawer.tsx
  - frontend/src/components/git-log/file-tree.tsx
  - frontend/src/components/git-log/__tests__/
expects_from:
  task-05:
    - contract: GitLogHooks
      needs: [useGitLogCommits(git_mode/commits.seq.lane.edges.refs/branches/head/has_more/total_in_window), useGitLogCommitDetail(message/refs/files.path_add_del_binary), useGitLogDiff(diff/truncated/binary)]
goal: 在前端落地「Git 日志」tab 全套 UI（TABS 注册/page 骨架/虚拟滚动列表/自研 SVG 泳道/详情 Drawer/变更文件目录树），消费 task-05 hooks 渲染类 IDEA Git Log 视图并配组件测试。
implementation:
  - workspace-tabs.tsx TABS 纯三字段追加 git-log 项（key=git-log、label=Git 日志、path=/git-log，对齐现有 14 项条目形态，不扩展 icon 字段）
  - page.tsx 骨架对齐 explorer page——PageContainer+PageHeader（标题 Git 日志，副标题工作区名/已加载 N 条，不显示仓库提交总数 CC-06）+ 工具栏（分支下拉数据源=响应 branches[] 全量、作者文本输入回车触发、刷新 invalidate query）+ git_mode=no_git 与空仓库空态卡 + 502/422/404 三降级中文卡（同款优先级分发）
  - commit-list.tsx——@tanstack/react-virtual useVirtualizer 固定行高虚拟滚动；行内容 message/作者/短哈希/refs 标签/时间，hover brand-50 底、文字可选中；滚动近底按 has_more 追加下一页（skip 递增，复用 task-05 queryKey 缓存）
  - commit-graph.tsx——SVG 泳道绝对定位覆盖列表左列，仅绘可视区±overscan 的圆点与边（视口重绘 R-05）；y 以全局 seq 为基准保证跨页追加连续；edges 后端预计算前端纯渲染（D-004）；圆点按 lane 取色板循环、HEAD commit 画虚线环；色板 primary/accent/success/warning/error 系经 themes.ts 消费、三主题各配亮暗档
  - commit-detail-drawer.tsx——点击行打开右侧 Drawer；详情区 message 全文/短哈希/作者/时间/refs 标签；内嵌变更文件树，Drawer 关闭释放 diff 展开态
  - file-tree.tsx——files 平铺路径按 / 聚合成目录树（树交互参考 change-file-tree.tsx）；目录节点聚合显示 +x/-y；叶子点击按需调 useGitLogDiff 展开渲染 unified diff，binary 提示「二进制文件」、truncated=true 提示已截断（R-06）
  - __tests__ 组件测试——commit-graph.test.tsx 断言 lane/edges 到 SVG path/圆点的渲染映射；file-tree.test.tsx 断言路径聚合函数与 diff 按需请求（点击前零请求）
acceptance:
  - 泳道渲染断言——给定含 lane/edges 的 commits 渲染出的 SVG path 与圆点坐标按 lane 定 x、seq 定 y，视口外行不产出 path
  - 文件树聚合断言——平铺路径按 / 聚合成树层级正确、目录节点 +x/-y 累加正确；叶子首次点击才发起 diff 请求（点击前零请求）
  - 主题与视口断言——git-log 组件与 page 无硬编码 hex（色板经 themes.ts 消费链，三主题亮暗档随主题切换）；grep 无 md:等视口响应式前缀
  - TABS 增至 15 项且新条目纯三字段（无 icon 字段），其余 14 项与渲染逻辑零改动；空态卡/三降级卡按 git_mode 与 502/422/404 分发；文案全中文
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test
constraints:
  - 颜色全部走 themes.ts 消费链（CSS 变量/brand-*/semantic token），禁硬编码 hex；UI 文案全中文
  - 不引入新 npm 依赖——虚拟滚动用现有 @tanstack/react-virtual ^3.14.9，SVG 泳道自研（D-001 禁第三方 git 图组件）
  - 参照原型 prototype-workspace-git-log.html 但以 design.md 为准——变更文件树为树形聚合非平铺、副标题为已加载 N 条非提交总数；tab 内禁用 md:等视口响应式前缀
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
