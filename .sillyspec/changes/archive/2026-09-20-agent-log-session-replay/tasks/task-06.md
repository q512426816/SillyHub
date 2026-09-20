---
id: task-06
title: 'backend schema（AgentLogUsage/totals/五新字段）+ router 外层 totalUsage→totals + 测试 + gen:types（worktree PYTHONPATH 坑）'
title_zh: 'backend schema（AgentLogUsage/totals/五新字段）+ router 外层 totalUsage→totals + 测试 + gen:types（worktree PYTHONPATH 坑）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 09:50:21
priority: P0
depends_on: ['task-05']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/platform_sync/schema.py
  - backend/app/modules/platform_sync/router.py
  - backend/app/modules/platform_sync/tests/test_agent_log_messages.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
target_files:
  - backend/app/modules/platform_sync/schema.py
  - backend/app/modules/platform_sync/router.py
  - backend/app/modules/platform_sync/tests/test_agent_log_messages.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
provides:
  - contract: AgentLogMessagesResponse
    fields: [totals, turn_id, model, is_meta, turn_end, usage]
expects_from:
  task-05:
    - contract: AgentLogMessagesResult
      needs: [totalUsage]
goal: >
  平台层接收 daemon 新字段并再生成前端类型：schema 增 AgentLogUsage/totals 与消息级五字段
  （messages 内层零改名），router 仅补外层 totalUsage→totals 一行，gen:types 落 openapi+api-types。
implementation:
  - backend/app/modules/platform_sync/schema.py:444 AgentLogMessageItem 增 turn_id/model（str|None）、is_meta/turn_end（bool|None）、usage（AgentLogUsage|None，全 Optional=None）；新嵌套模型 AgentLogUsage{input_tokens,output_tokens,cache_read_tokens,cache_write_tokens:int}；:470 AgentLogMessagesResponse 增 totals: AgentLogUsage|None=None
  - backend/app/modules/platform_sync/router.py:893 转换层仅补一行 "totals": result.get("totalUsage")（messages 内层零改名——daemon 已 snake_case 直通，model_validate 递归校验命中）
  - backend/app/modules/platform_sync/tests/test_agent_log_messages.py 增：新字段全量命中断言 + 老 daemon（result 无 totalUsage/新字段）→ 全 None 缺省断言
  - gen:types（worktree 内，防主仓 venv editable 陷阱）：PYTHONPATH=C:/Users/qinyi/IdeaProjects/multi-agent-platform-replay-redo/backend 用主仓 venv 跑 dump_openapi 导出 worktree backend/openapi.json，再 worktree frontend 跑 pnpm gen:types 生成 frontend/src/lib/api-types.ts（先确认 worktree frontend node_modules 健康，junction 主仓由 provisionDeps 处理；缺则 pnpm install --force）
  - 两个生成产物留在 worktree 工作区随变更提交（CLAUDE.md 规则 21）
acceptance:
  - worktree backend/openapi.json 含 AgentLogUsage/totals 与消息级五字段；frontend/src/lib/api-types.ts 相应生成（禁止手写）
  - pytest：带新字段的 daemon mock → 响应透传；无新字段 mock → 全 None（老 daemon 兼容）
  - gen:types 产出的 schema 是 worktree 代码（核对 totals 字段在 openapi 中存在，防主仓旧 schema 假象）
verify:
  - cd backend && uv run pytest -q --no-cov app/modules/platform_sync/tests/test_agent_log_messages.py
  - worktree frontend: pnpm exec tsc --noEmit（api-types 编译通过）
constraints:
  - messages 内层零改名（唯一外层映射 totalUsage→totals）；全字段 Optional 老 daemon 缺省 None
  - api-types.ts 只能 gen:types 生成；PYTHONPATH 必须指 worktree/backend（docs/sillyspec/finished/worktree-gen-types-editable-install-trap.md）
  - 禁止跑全量后端测试（仅 test_agent_log_messages.py）
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
