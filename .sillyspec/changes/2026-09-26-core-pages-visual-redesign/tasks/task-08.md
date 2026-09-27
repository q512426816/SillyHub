---
id: task-08
title: '工作区概览页重排（白底页头/守护横幅/统计四格/两栏/antd 表单化）+ 测试同步'
title_zh: '工作区概览页重排（白底页头/守护横幅/统计四格/两栏/antd 表单化）+ 测试同步'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-27 00:40:13
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/
  - frontend/src/components/workspace/
target_files:
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
related_tests:
  - frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/page-sync.test.tsx
expects_from:
  task-03:
    needs: [PageHead, StatGrid]
  task-04:
    needs: [MetaPanel, MetaPanelSection]
  task-02:
    needs: [StateLabel]
goal: >
  工作区概览页从深色渐变 Hero+原生表单控件重排为 GitHub Repo 首页式：白底页头+
  守护状态横幅+统计四格+左右两栏，原生 select/input/textarea 全部换 antd 控件。
implementation:
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx（750 行）重排：Hero 渐变退役→PageHead（方块头像+名称+可见性胶囊+重新扫描/设置操作组）→ 守护状态横幅（在线绿点+心跳+智能体计数+查看运行时链接）→ StatGrid 统计四格（进行中变更/会话/本周 token/待办处理）→ 左右两栏：左=活跃变更行式列表（复用 IssueRow 精简）+最近会话列表；右=About MetaPanel（路径 mono+技术栈+关联项目+成员+默认智能体）
  - frontend/src/components/workspace/ 涉及组件改造：hero-header.tsx 退役、stats-row.tsx 换 StatGrid、changes-overview-card.tsx:604 精简为活跃变更列表（数据源零改动）、基本信息卡内联编辑表单（page.tsx:426-545 原生 select/input/textarea）换 antd 控件
  - amber 硬编码横幅（page.tsx:626 border-amber-300 bg-amber-50）换语义 token StateLabel/告警条
  - 同步修 page.test.tsx 与 __tests__/page-sync.test.tsx 断言
acceptance:
  - DOM 对照原型「工作区概览」视图：页头/横幅/四格/两栏
  - grep 本页无原生 <select>/<input type=text>/<textarea（antd 组件内部除外）无 border-amber-300/bg-amber-50
  - 既有测试改断言后全绿
verify:
  - cd frontend && pnpm vitest run "src/app/(dashboard)/workspaces/[id]"
  - cd frontend && pnpm typecheck
constraints:
  - changes-overview-card 数据 hooks 零改动（仅展示层）；编辑保存逻辑零改动（仅控件替换）
  - dark 主题下页头/横幅观感达标（不靠补丁）
  - 不动 [id]/layout.tsx 与 WorkspaceTabs
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
