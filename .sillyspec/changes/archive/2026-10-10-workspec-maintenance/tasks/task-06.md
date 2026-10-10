---
id: task-06
title: 'api-types 再生成与联调收尾——`pnpm gen:types`、openapi.json 提交、跨端冒烟（FR-06）'
title_zh: 'api-types 再生成与联调收尾——`pnpm gen:types`、openapi.json 提交、跨端冒烟（FR-06）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-10 19:04:59
priority: P0
blocks: []
requirement_ids: [FR-06]
decision_ids: []
depends_on: [task-02, task-03, task-04, task-05]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/provider-caps.ts
  - backend/openapi.json
  - frontend/src/lib/linked-repos.ts
target_files:  # 对账用：gen:types 双脚本再生成产物（provider_caps 为 gen-provider-caps 副产物，审查已确认）
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/provider-caps.ts
  - backend/openapi.json
  - backend/app/modules/agent/provider_caps.py
expects_from:
  task-02:
    crud-api: "端点形状已稳定（见 task-02 provides.crud-api）"
  task-03:
    sync-rpc: "sync/回报端点形状已稳定（见 task-03 provides.sync-rpc）"
  task-04:
    daemon-sync: "跨端冒烟消费 daemon 落盘链路（见 task-04 provides.daemon-sync）"
  task-05:
    linked-repos-ui: "lib/linked-repos.ts 临时 interface 待对齐（见 task-05 provides.linked-repos-ui）"
goal: >
  收尾接线：后端 OpenAPI 导出 → `pnpm gen:types` 再生成 api-types.ts + openapi.json 提交，
  lib/linked-repos.ts 临时类型对齐生成类型，跨端冒烟验证全链路（CLAUDE.md 规则 21）。
implementation:
  - 确认前端 node_modules 健康（pnpm exec tsc --version 可跑，CLAUDE.md 规则 21 前置）
  - 后端起应用导出 openapi.json（或既有 make/脚本目标，读 local.yaml commands 确认）
  - cd frontend && pnpm gen:types → api-types.ts 含新六端点类型；注意 gen:types 实为双脚本
    （frontend/package.json:15：gen-api-types.mjs + gen-provider-caps.mjs），后者重生成
    frontend/src/lib/provider-caps.ts（已列 allowed_paths，caps 漂移属预期副产物）；
    frontend/src/lib/linked-repos.ts 临时 interface 替换为生成类型引用
  - 跨端冒烟：登记仓→配我的路径→立即同步→daemon 落盘→状态列可见（无真实 daemon
    环境时以集成测试替身验证，替身仅限此场景）
acceptance:
  - frontend/src/lib/api-types.ts 与 backend/openapi.json 同源一致并提交（不落后后端）
  - cd frontend && pnpm typecheck && pnpm lint 通过
  - 冒烟链路（登记→路径→同步→状态）走通或以测试替身验证
verify:
  - cd frontend && pnpm typecheck && pnpm lint
constraints:
  - gen:types 前先验 node_modules 健康（半坏会产生假 CSSProperties/模块缺失报错）
  - 不手改 api-types.ts 生成产物
  - 与本次改动无关的旧测试债按惯例顺手修，不为躲报错回退手写
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
