---
id: task-13
title: '模块文档同步（backend.changelog/frontend.changelog）+ gen:types/openapi.json 提交核对 + 本地 Docker Postgres 迁移应用'
title_zh: '模块文档同步（backend.changelog/frontend.changelog）+ gen:types/openapi.json 提交核对 + 本地 Docker Postgres 迁移应用'
author: 'qinyi'
created_at: 2026-08-31 04:00:53
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04', 'task-05', 'task-06', 'task-07', 'task-08', 'task-09', 'task-10', 'task-11', 'task-12']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07]
decision_ids: [D-002, D-010]
allowed_paths:
  - .sillyspec/docs/multi-agent-platform/modules/backend.changelog.md
  - .sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md
goal: >
  变更改尾（plan Wave 9）：backend/frontend 两模块 changelog 补本变更条目（照既有
  ql/change 条目风格），核对 gen:types 产物（frontend/src/lib/api-types.ts +
  backend/openapi.json）无未提交差异（CLAUDE.md 规则 21），本地 Docker Postgres
  实跑迁移验证 position 列三步走落库（RISK-3 部署前冒烟）。
implementation:
  - "backend.changelog.md 顶部追加「change 2026-08-31-session-queue-ux | 会话消息排队体验修复与增强」条目（照既有 change 条目一行式风格）：迁移 20260831130000 三步走加 position 列 + 入队行锁内 MAX+1 + 派发序 ORDER BY position, created_at（D-002）；dispatch 循环化（连续失败 ≥2 停 / 非终态非 active 保持 pending / 终态批量 fail）+ confirm_session_reconnected 恢复钩子（_fire_background_task helper）；reorder/edit/dispatch-now 三端点（422 QUEUE_ORDER_MISMATCH / 409 TASK_WAKEUP 前缀 / 409 非 active）+ queue_changed 补发；测试量（test_session_queue_actions.py 新用例数 + 既有 test_session_queue* 适配）"
  - "frontend.changelog.md 追加同变更条目：daemon.ts queue_changed case（不入 run_id 白名单）+ 三 client + SessionQueueEntry.position；useMessageQueue 三方法（load 刷新模式）；MessageQueueBar 拖拽手柄原生 DnD / ⚡ 立即发送 / ✎ 编辑浮层（TASK_WAKEUP 隐藏 ✎）重构；session-panel SSE onQueueChanged→refresh 接线；CopyButton 组件 + 三挂载（FR-07）；测试量 + gen:types 同步说明"
  - "git status 核对生成物：frontend/src/lib/api-types.ts 与 backend/openapi.json 应已在 task-06 随 pnpm gen:types 产出并提交——存在未提交差异则本卡补跑（先 pnpm exec tsc --version 确认 node_modules 健康，CLAUDE.md 规则 21）并提交；暴露与本次无关的旧测试债按惯例顺手修好而不是改回手写"
  - "本地 Docker Postgres 迁移应用：主仓库根跑（规则 22 不 cd），backend 容器执行 alembic upgrade head（deploy/docker-compose.yml backend 服务；若本地库 agent_session_queued_messages 为空，先造几行排队数据再迁移以真实验证 CTE 回填）；随后 docker exec 进 postgres 容器 psql -U platform -d platform 查「\\d agent_session_queued_messages」确认 position 列 NOT NULL 存在 + SELECT id, position ... ORDER BY position 抽查回填序 + alembic_version 头=20260831130000"
  - "核对 tasks.md 勾选与本卡产出一致；archive 归档不在本卡执行（留给人工确认后的 sillyspec:archive）"
acceptance:
  - "两 changelog 各新增一条 change 2026-08-31-session-queue-ux 条目，格式照既有条目风格（change 前缀 + 一行式要点串联 + 测试量 + gen:types 说明），中文（CLAUDE.md 规则 12）"
  - "git status 无 frontend/src/lib/api-types.ts / backend/openapi.json 未提交差异（或差异已随本卡 gen:types 补跑收敛）"
  - "Docker Postgres psql 实查：agent_session_queued_messages.position 列存在且 NOT NULL、存量行回填序正确、alembic_version 指向 20260831130000（RISK-3 冒烟通过，D-010 三步走在真实库成立）"
  - "本卡零业务源码/测试改动（allowed_paths 仅两 changelog 文档）"
verify:
  - 'git status --short （核对 frontend/src/lib/api-types.ts 与 backend/openapi.json 无未提交差异；有则 pnpm gen:types 补跑后提交）'
  - 'docker compose -f deploy/docker-compose.yml exec postgres psql -U platform -d platform -c "\d agent_session_queued_messages" （position 列 NOT NULL）'
  - 'docker compose -f deploy/docker-compose.yml exec postgres psql -U platform -d platform -c "SELECT version_num FROM alembic_version" （= 20260831130000）'
constraints:
  - "本卡零业务代码改动：发现的问题回对应 task 卡修；不改测试（迁移本体不在 pytest 覆盖面，design §6 已声明）"
  - "psql 用户/库名以 .env 实际值为准（compose 默认 platform/platform）；命令在主仓库根执行（CLAUDE.md 规则 22），Windows/Linux/macOS 均可跑（docker compose 短语法三平台兼容）"
  - "迁移应用前不清库重置——本变更迁移须在既有数据上验证 CTE 回填（规则 11 允许重置但 RISK-3 要求存量路径冒烟）；若本地库无排队数据，先手工造数再 upgrade"
  - "changelog 条目须覆盖 design §9 文件变更清单全部产出与 §8 测试量，不写实现细节流水账（照既有条目密度）"
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
