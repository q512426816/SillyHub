---
id: task-04
title: 'per-workspace skill manifest and daemon distribution slots'
title_zh: 'manifest 端点 ?workspace_id+skill-manager per-workspace 槽+会话/任务选槽（D-007）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-11 21:39:17
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-007@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/router/daemon_rpc.py
  - backend/app/modules/daemon/tests/
  - sillyhub-daemon/src/skill-manager.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/tests/
target_files:
  - backend/app/modules/daemon/router/daemon_rpc.py
  - sillyhub-daemon/src/skill-manager.ts
  - sillyhub-daemon/src/daemon.ts
expects_from:
  - task-01 提供 _collect_enabled_git_skills 并集签名与 build_skills_manifest/build_skills_bundle 的 workspace_id 透传（本卡端点只接收可选参数并透传；None 兼容语义为缺省行为依据）
goal: >
  manifest/bundle 端点增可选 workspace_id 查询参数（带参为并集渲染、缺省为 user-only 兼容 D-007），daemon skill-manager 增 per-workspace 缓存槽，workspace 绑定的会话/任务 spawn 前按槽拉取并解包其 git 技能（FR-01 注入闭环）。
implementation:
  - daemon_rpc.py get_skills_manifest/get_skills_bundle 增可选 workspace_id 查询参数（daemon_rpc.py:383-419 锚点）——带参透传 task-01 并集签名渲染，缺省行为逐字不变；校验请求用户为该 workspace 成员（防越权拉他人并集，拒绝形态对齐模块惯例）
  - skill-manager.ts fetchRemoteManifest/fetchSkillsBundle 增可选 workspaceId（:107-124 锚点）——URL 拼 workspace_id 查询串；本地版本槽扩展——全局槽（localManifestPath :41 锚点）保留，新增 per-workspace 槽 manifest-<workspace_id>.json 与对应解包目录，并新增按 workspace 的 syncSkills 入口（读槽版本、比对、拉 bundle、解包）
  - daemon.ts 与 task-runner.ts——会话/任务带 workspace 绑定时 spawn 前按 workspace 槽同步并解包其 git 技能到 workdir 技能目录（daemon.ts:2234-2244 启动全局拉保留不动；task-runner 的 batch 路径复用 skill-manager 入口不复制实现）；未绑定走既有全局路径
  - 测试——skill-manager.test.ts 补 workspaceId 透传与独立槽版本比对与两槽互不覆盖；task-runner-skill-detect.test.ts 补任务选槽；test_skills_bundle.py 补端点带或不带 workspace_id 两态（并集含 workspace 启用技能）
acceptance:
  - manifest/bundle 不带 workspace_id 响应与现状逐字一致（向后兼容用例）；带参时并集含 user 与 workspace 两边启用；非成员拉取被拒；per-workspace 槽与全局槽独立演进（一边更新不覆盖另一边版本记录）
  - workspace 绑定的会话/任务 workdir 内可见其 workspace 启用 git 技能；未绑定路径行为不变
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_skills_bundle.py -q --no-cov
  - cd sillyhub-daemon && pnpm exec vitest run tests/skill-manager.test.ts tests/task-runner-skill-detect.test.ts && pnpm typecheck
constraints:
  - 最小改造（R-01）——不重构分发架构、不动启动全局拉取与既有 syncSkills 行为；旧 daemon 调用零感知（向后兼容硬底线）
  - 选槽只依据会话或任务的 workspace 绑定，不引入新配置项
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
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
