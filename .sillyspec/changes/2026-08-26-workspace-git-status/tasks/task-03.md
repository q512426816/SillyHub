---
id: task-03
title: 'gen:types 再生成 + useGitLogStatus（staleTime 60s）+ git-status-bar 共享组件（full/compact）+ 两页挂载 + 组件测试'
title_zh: 'gen:types 再生成 + useGitLogStatus（staleTime 60s）+ git-status-bar 共享组件（full/compact）+ 两页挂载 + 组件测试'
author: 'qinyi'
created_at: 2026-08-26 23:21:52
priority: P0
depends_on: ['task-01', 'task-02']
blocks: []
requirement_ids: [FR-04, FR-07]
decision_ids: [D-003@v1]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/lib/git-log.ts
  - frontend/src/components/git-log/git-status-bar.tsx
  - frontend/src/components/git-log/__tests__/git-status-bar.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/git-log/page.tsx
  - frontend/src/components/sessions/sessions-portal.tsx
  - frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
  - frontend/src/components/git-log/__tests__/git-log-page.test.tsx
expects_from:
  task-02:
    - contract: GitLogStatusEndpoint
      needs: 'GitLogStatusResponse 全字段（git_mode/branch/detached/upstream/ahead/behind/dirty.files_changed+additions+deletions+untracked_count/head_short/empty/fetch.performed+error/synced_at）'
goal: '在前端落地工作区 Git 状态条（design §5.4，D-003）：gen:types 再生成 + useGitLogStatus 共享缓存 + git-status-bar full/compact 双形态组件 + git-log 页与会话门户两处挂载 + 组件测试，消费 task-02 status 端点'
implementation:
  - 'gen:types 前置：node_modules 健康复检 → PYTHONPATH 指 worktree/backend 跑 dump + pnpm gen:types（backend.md 已登记方案）；api-types.ts 与 openapi.json 两产物随变更提交'
  - 'lib/git-log.ts 新增 fetchGitLogStatus + useGitLogStatus(workspaceId)：queryKey ["git-log", wid, "status"]、staleTime 60s 显式覆盖全局 15s、refetchOnWindowFocus 沿用全局（>60s 后聚焦重取含远程 fetch 属预期）'
  - '新增 components/git-log/git-status-bar.tsx：props {workspaceId, variant full|compact}；full 展示分支徽标/↑N/↓N/+A−D（N 文件）/未跟踪/同步时间，compact 只展示分支/↑↓/+− 且 Tooltip 展开细节；fetch 失败降级黄条（full）/"⚠" 图标（compact）；骨架文案 "Git 状态加载中…"、空仓库 "仓库还没有任何提交"；主题 token（brand 徽标/accent ↑/warning ↓与黄条/success +/error −）零 hex，三主题亮暗档走 themes.ts 消费链'
  - '挂载：git-log page.tsx PageHeader 下方挂 variant=full（与过滤文案并存）；sessions-portal.tsx :415 PageHeader actions 槽挂 variant=compact，仅 scope.kind==="workspace" 条件渲染（change/quicklog/platform scope 不挂，CC-08）'
  - '两页既有测试 mock 层补 status mock（Plan Review I-1）：sessions-portal.test.tsx 未 mock @/lib/git-log、git-log-page.test.tsx 为 ...actual 透传——补固定 fixture 或 loading 态 mock，消除未 mock 的 status 请求噪声'
  - '新增组件测试 git-status-bar.test.tsx：full/compact 双形态渲染断言、fetch 失败黄条、双实例同屏 fetch 调用次数=1（staleTime 60s 两页共享缓存）'
acceptance:
  - 'pnpm exec tsc --noEmit 0 error；组件测试断言 full/compact 双形态渲染与 fetch 失败降级（黄条/⚠）'
  - 'staleTime 双实例单请求断言（两组件同屏 fetch 调用次数=1）'
  - '三主题 grep 组件无 hex 色值（全 token）；sessions-portal 仅 workspace scope 挂载断言（change/quicklog/platform 不挂）'
  - 'gen:types:check 干净；openapi.json diff 无其他模块漂移（产物随变更提交）'
verify:
  - 'cd frontend && pnpm exec tsc --noEmit'
  - 'cd frontend && pnpm test'
constraints:
  - 'api-types.ts + openapi.json 两产物随变更提交；tab 内无视口前缀；UI 中文；零新 npm 依赖'
  - '组件自治取数不侵入会话列表逻辑；不改既有 git-log hooks/组件行为'
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
