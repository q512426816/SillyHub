---
id: task-10
title: 'gen:types 双跑（前端 + daemon api-types 同步，规则 21 义务）'
title_zh: 'gen:types 双跑（前端 + daemon api-types 同步，规则 21 义务）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-11-07 00:39:35
priority: P0
depends_on: [task-09]
blocks: []
requirement_ids: [FR-02]
decision_ids: []
allowed_paths:
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/src/api-types.ts
  - backend/openapi.json
target_files:
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/src/api-types.ts
  - backend/openapi.json
goal: >
  task-09 的 git-diff 端点 schema 落地后执行规则 21 类型义务双跑——pnpm gen:types（前端）+
  pnpm -C sillyhub-daemon gen:types（daemon），三件生成物（frontend/src/lib/api-types.ts、
  sillyhub-daemon/src/api-types.ts、backend/openapi.json）在同一变更内一并提交，不让类型
  落后后端形成债（历史 daemon 漏生成曾致 daemon-ci 三连红）。
implementation:
  - 前置确认 task-09 已合入（git-diff 路由 + response_model 就位）；gen:types 前确认前端
    node_modules 健康（pnpm exec tsc --version 可跑——半坏会报一堆假 CSSProperties/
    Cannot find module 错，先 pnpm install --force 修，勿误判成代码问题）
  - 仓根跑 pnpm gen:types（frontend/scripts/gen-api-types.mjs：先经 backend/scripts/
    dump_openapi.py 刷新 backend/openapi.json，再 openapi-typescript 生成
    frontend/src/lib/api-types.ts）
  - 跑 pnpm -C sillyhub-daemon gen:types（生成 sillyhub-daemon/src/api-types.ts）
  - 核对三件生成物均含 git-diff 增量——openapi.json 含 /api/daemon/sessions/{session_id}/
    git-diff 路径与 query 参数 path，两份 api-types.ts 含对应 operation/类型；检查 diff 无
    与本变更无关的大面积漂移（有旧债漂移按惯例顺手修，不为躲报错回退手写）
  - 三件生成物同一提交单元一并提交（缺一即闸门红——daemon gen:types:check 与 CI 断言面）
acceptance:
  - backend/openapi.json 含 git-diff 端点路径/参数/响应 schema；两份 api-types.ts 均含
    对应生成类型（grep git-diff 可命中）
  - pnpm -C sillyhub-daemon gen:types:check 通过（重新生成后 git diff --exit-code 干净）
  - 三件生成物同批提交；生成物 diff 无未解释的无关漂移
verify:
  - pnpm -C sillyhub-daemon gen:types:check
  - cd frontend && pnpm exec tsc --noEmit
  - git diff --stat -- backend/openapi.json frontend/src/lib/api-types.ts
    sillyhub-daemon/src/api-types.ts（三件均有 git-diff 相关增量）
constraints:
  - 禁止手写 api-types.ts（规则 21——类型只从 openapi 生成）；禁止手改 backend/openapi.json
  - 双跑必须在同一变更内完成（历史上只跑前端漏 daemon 致 daemon-ci 三连红）
  - 纯生成物任务：不加测试面、不动业务代码；禁止跑全量测试（规则 0）
  - node_modules 半坏报假类型错时先 pnpm install --force 修复再生成
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
