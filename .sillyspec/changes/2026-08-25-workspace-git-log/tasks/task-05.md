---
id: task-05
title: 'pnpm gen:types 再生成 + 前端 lib/git-log.ts hooks（queryKey 工厂 + useQuery + 详情/diff 按需 hook）'
title_zh: 'pnpm gen:types 再生成 + 前端 lib/git-log.ts hooks（queryKey 工厂 + useQuery + 详情/diff 按需 hook）'
author: 'qinyi'
created_at: 2026-08-25 21:37:20
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-01, FR-04, FR-06]
decision_ids: [D-005@v1, D-006@v1]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/lib/git-log.ts
expects_from:
  task-04:
    - contract: GitLogResponses
      needs:
        - GitLogCommitsResponse(git_mode 两态/commits.seq+lane+edges+refs/branches[]/head/has_more)
        - GitLogCommitDetailResponse(files.path+add+del+binary)
        - GitLogDiffResponse(diff/truncated/binary)
provides:
  - contract: GitLogHooks
    fields:
      - useGitLogCommits(git_mode/commits.seq.lane.edges.refs/branches/head/has_more/total_in_window)
      - useGitLogCommitDetail(message/refs/files.path_add_del_binary)
      - useGitLogDiff(diff/truncated/binary)
goal: >
  从 task-04 落定的三端点 OpenAPI schema 再生成前端 api-types.ts 与 backend/openapi.json（规则 21 两产物随变更提交），
  照 lib/explorer.ts 先例新增 lib/git-log.ts（apiFetch + queryKey 工厂 + useQuery hooks）向 task-06 页面组件层供数。
implementation:
  - 前置确认 frontend node_modules 健康（CLAUDE.md 规则 21——cd frontend && pnpm exec tsc --version 能跑且 node_modules/.bin 有 shim）；半坏则 pnpm install --force 修复（普通 install 命中缓存不修），禁止改代码绕过
  - cd backend && uv run python scripts/dump_openapi.py 先刷新 backend/openapi.json（提前暴露后端 import/依赖错误）→ cd frontend && pnpm gen:types 再生成 src/lib/api-types.ts（脚本 = dump + openapi-typescript 生成一条龙）
  - 新增 frontend/src/lib/git-log.ts 照 lib/explorer.ts 先例——文件头注释「类型一律引用 api-types 生成 schema，禁止手写」；三响应类型全部经 components.schemas 引用导出（GitLogCommitsResponse / GitLogCommitDetailResponse / GitLogDiffResponse）
  - queryKey 工厂 gitLogQueryKeys——commits(workspaceId, skip, limit, branch, author) 分页与过滤参数全入 key（条件变更天然换 key 失效缓存）+ detail(workspaceId, sha) + diff(workspaceId, sha, path)，as const 形态对齐 explorerQueryKeys
  - fetch 与 hooks——fetch 封装走 apiFetch（相对路径经 Next.js rewrite proxy，401 单飞刷新由 apiFetch 自带），列表端点带 skip/limit/branch/author query、详情/diff 端点按 sha（diff 另带 path query），sha/path 均 encodeURIComponent；useGitLogCommits 列表 hook（workspaceId 非空才 enabled）+ useGitLogCommitDetail / useGitLogDiff 详情与 diff 两个按需 hook（enabled 由组件层选中/展开态传入，对齐 useExplorerFile 形态；execute 期勘误：diff hook 名以 provides 契约 useGitLogDiff 为准）
acceptance:
  - api-types.ts 含三 schema（GitLogCommitsResponse / GitLogCommitDetailResponse / GitLogDiffResponse 关键字段 git_mode、commits.lane+edges、branches[]、head、has_more、files、diff+truncated+binary 齐全）且无其他模块类型漂移（pnpm gen:types:check 干净）
  - lib/git-log.ts 类型零手写——全部经 components.schemas 引用；queryKey 含 skip/limit/branch/author 与 sha/path 维度
verify:
  - cd frontend && pnpm gen:types:check
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - CLAUDE.md 规则 21——api-types.ts 与 backend/openapi.json 两产物必须随变更提交，不让前端类型落后后端形成债
  - node_modules 半坏（假 CSSProperties / Cannot find module 报错）一律 pnpm install --force 修复，禁止为绕报错改代码或回退手写类型
  - 本 task 仅产出 lib/git-log.ts 与两个生成产物，不写页面/组件（归 task-06）；lib 为纯类型+hooks 层不加独立单测
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
