---
id: task-03
title: 'gen:types 三份产物同批再生成（backend/openapi.json + frontend/src/lib/api-types.ts + sillyhub-daemon/src/api-types.ts；前置前端 node_modules 健康检查）'
title_zh: 'gen:types 三份产物同批再生成（backend/openapi.json + frontend/src/lib/api-types.ts + sillyhub-daemon/src/api-types.ts；前置前端 node_modules 健康检查）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-25 20:18:25
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-05]
decision_ids: []
allowed_paths:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/src/api-types.ts
target_files:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/src/api-types.ts
expects_from:
  - task-02: GitDirtyFilesResponse / GitDirtyFileItem / GitIgnoredItem / GitWorktreeDiffResponse 四 DTO 进 openapi
goal: >
  后端 schema 新增后，三份类型产物同批自动再生成（CLAUDE.md 规则 21 双份义务：前端 + daemon），零手写类型。
implementation:
  - 前置健康检查：cd frontend && pnpm exec tsc --version（能跑即 node_modules 健康；失败先 pnpm install --force 修复——半坏 node_modules 会报假 CSSProperties/模块缺失错误）
  - cd backend && uv run python -c "from app.main import app" 确认 schema 可加载（gen:types 前置）
  - cd frontend && pnpm gen:types（产 backend/openapi.json + frontend/src/lib/api-types.ts）
  - pnpm -C sillyhub-daemon gen:types（产 sillyhub-daemon/src/api-types.ts）
  - 核对三份 diff：新类型 GitDirtyFilesResponse/GitWorktreeDiffResponse 等四组出现在前端与 daemon 两份 api-types，openapi.json paths 新增两路由
acceptance:
  - 三份产物同批更新且相互一致（同一 schema 源生成）
  - frontend/src/lib/api-types.ts 与 sillyhub-daemon/src/api-types.ts 含新 DTO 类型，零手写补丁
  - backend/openapi.json 含 /workspaces/{workspace_id}/git-log/dirty-files 与 /worktree-diff 两路径
verify:
  - git diff --stat backend/openapi.json frontend/src/lib/api-types.ts sillyhub-daemon/src/api-types.ts
  - grep -c "GitDirtyFilesResponse" frontend/src/lib/api-types.ts sillyhub-daemon/src/api-types.ts
constraints:
  - 禁止手写/手改 api-types.ts 任何类型（生成器产物）
  - 前端 node_modules 不健康时先修复再生成，不带病生成
  - 本卡不改任何源码逻辑，纯产物再生成
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
