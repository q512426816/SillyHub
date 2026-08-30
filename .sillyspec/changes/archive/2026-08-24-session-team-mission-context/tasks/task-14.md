---
id: task-14
title: '测试收尾+类型同步+文档——三态/一次性/回滚/边界轮/E2 422 用例+token 量化+全量回归+gen:types+模块文档'
title_zh: '测试收尾+类型同步+文档——三态/一次性/回滚/边界轮/E2 422 用例+token 量化+全量回归+gen:types+模块文档'
author: 'qinyi'
created_at: 2026-08-24 19:00:25
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04', 'task-05', 'task-06', 'task-07', 'task-08', 'task-09', 'task-10', 'task-11', 'task-12', 'task-13']
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-002@v1, D-006@v2, D-007@v1, D-009@v2, D-010@v1, D-013@v1, D-014@v1]
allowed_paths:
  - backend/app/modules/agent/tests/
  - backend/app/modules/daemon/tests/
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - sillyhub-daemon/src/api-types.ts
  - .sillyspec/docs/multi-agent-platform/modules/backend.md
  - .sillyspec/docs/multi-agent-platform/modules/frontend.md
  - .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md
goal: >
  全变更收尾——补齐五层机制的测试证据（三态探测/一次性判定/事务回滚/边界轮/E2 422/直通派发/懒建与 patrol 零回归）、简报 token 量化（R-01）、三端类型产物 gen:types 同步（R-07）与 backend/frontend/sillyhub-daemon 三模块文档更新（FR-07 存量零回归的最终验证）。
implementation:
  - agent/daemon 两模块 tests/ 下补齐用例清单——①probe_workspace_git_mode 三态（mock delegate 真答 exists=True/False、transport 异常、HostFsDelegateUnavailable→unknown，D-006@v2）②一次性判定（空 prompt 切换轮不注入不消耗、failed 主控轮后下条带文本消息重注、已有非 failed orchestrator run 不再注入，D-002@v1/D-013@v1）③create 携 team_mission 中途异常整体回滚无孤儿 session/mission（flush-only helper+create 单 commit，D-009@v2）④E2 用例——(W,创建者) binding 缺失 422（D-014@v1）与 orchestrator_workspace_id ∉ scope 422（D-010@v1）⑤懒建路径零回归（回填 orchestrator run 短路简报判定）⑥patrol 零回归（render_scope_brief 不传探测回调——输出结构等价+机器名新字段）⑦直通 dispatch——worktree_branch=None、lease 不写 branch、finalizer 合并/清理天然跳过（D-007@v1）
  - 简报 token 量化测试——scope=5 工作区渲染会话简报，断言 ≤1.5k token（R-01 目标，design 标注的执行期实测项）
  - 跑 local.yaml commands.test 全绿（backend pytest -n auto + frontend vitest + daemon vitest）与 commands.lint 绿（ruff+mypy+pnpm lint/typecheck）
  - pnpm gen:types 产物同步——frontend（src/lib/api-types.ts + backend/openapi.json）与 sillyhub-daemon（src/api-types.ts）；SessionCreateRequest.team_mission/MissionStatusResponse/probe 端点全部进生成产物，task-13 的局部类型扩展随之收敛为生成版
  - 模块文档更新——backend.md（简报注入/三态直通/E1 预建/E2 解析/status+probe 路由）、frontend.md（预会话解禁+弹层探测+daemon.ts client 扩展）、sillyhub-daemon.md（mission_status 第 6 工具+hub-client getMissionStatus）
acceptance:
  - 用例清单补齐且全绿——三态探测/一次性判定（空 prompt+failed 重注）/create 中途异常回滚无孤儿/E2 binding 缺失与 ∉scope 双 422/懒建零回归/patrol 零回归/直通 dispatch worktree_branch=None+finalizer 跳过，每项有断言级证据
  - 简报 token 量化——scope=5 工作区 ≤1.5k token（R-01）
  - local.yaml commands.test 全绿 + commands.lint 绿（存量零回归最终验证，FR-07）
  - gen:types 产物同步提交——frontend api-types.ts、backend openapi.json、daemon api-types.ts 三处一致无手写漂移（CLAUDE.md 规则 21）
  - backend/frontend/sillyhub-daemon 三模块文档与本变更加持的能力同步更新
verify:
  - cd backend && uv run pytest -q --no-cov -n auto
  - cd frontend && pnpm test
  - cd sillyhub-daemon && pnpm test
constraints:
  - gen:types 前先确认前端 node_modules 健康（pnpm exec tsc --version 能跑、.bin 有 shim——半坏会报一堆假的 CSSProperties/找不到模块错，修复用 pnpm install --force，CLAUDE.md 规则 21）
  - W5 内 task-13 之后串行执行（前端接线先落，类型与回归收口在后）；不为过测试改测试逻辑（CLAUDE.md 规则 9），非测试逻辑有误时改实现
  - gen:types 暴露的与本次无关旧测试债（如 mock 缺字段）按惯例顺手补好，不改回手写
  - 本卡不动业务实现代码——仅测试/类型产物/文档；发现实现缺陷回对应 task 修，不在此卡内改业务源码
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
