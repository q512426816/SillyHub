---
id: task-05
title: 'gen-types-sync-and-frontend-session-api-six-functions'
title_zh: 'gen:types 同步 api-types + openapi.json + 前端六个 API 函数'
author: 'qinyi'
created_at: 2026-09-07 23:32:13
priority: P0
depends_on: ['task-02', 'task-03']
blocks: ['task-07', 'task-08']
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-07]
decision_ids: [D-001@v1, D-002@v1]
expects_from:
  task-02:
    - contract: AgentSessionRead
      needs: [pinned_at]
  task-03:
    - contract: ScheduledMessageRead
      needs: [id, prompt, dispatch_at, status, error_code]
provides:
  - contract: daemon.ts 会话六 API 函数
    fields: [pinAgentSession, unpinAgentSession, renameAgentSession, createScheduledMessage, listScheduledMessages, cancelScheduledMessage]
    consumers: [task-07, task-08]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/daemon.ts
  - backend/openapi.json
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  跑 pnpm gen:types 把 task-02/03 新增的后端契约（AgentSessionRead.pinned_at 与
  ScheduledMessage* DTO）刷进 api-types.ts 与 backend/openapi.json，并在 lib/daemon.ts
  照 archiveAgentSession 模板补六个 API 函数，供 task-07/08 UI 接线消费。
implementation:
  - 先验前端 node_modules 健康——pnpm exec tsc --version 能跑且 node_modules/.bin 有 shim；坏则 pnpm install --force 重建（R-05 假报错防线，CLAUDE.md 规则 21）
  - frontend 目录跑 pnpm gen:types（scripts/gen-api-types.mjs 先 uv run python scripts/dump_openapi.py 刷新 backend/openapi.json 再生成 src/lib/api-types.ts），产物随变更提交
  - 核对生成物——AgentSessionRead 含 pinned_at；ScheduledMessageCreateRequest / ScheduledMessageRead（及 SessionTitleUpdateRequest）齐全，snake_case 由后端序列化如实生成，api-types.ts 禁手写
  - lib/daemon.ts 照 archiveAgentSession 模板（apiFetch + encodeURIComponent）加六函数——pinAgentSession / unpinAgentSession（PATCH pin/unpin）、renameAgentSession（PATCH title，body 为 title 字段）、createScheduledMessage（POST scheduled 201 返回 ScheduledMessageRead）、listScheduledMessages（GET scheduled 返回条目列表）、cancelScheduledMessage（DELETE scheduled/{mid}）
acceptance:
  - api-types.ts 含 AgentSessionRead.pinned_at 与 ScheduledMessageCreateRequest/ScheduledMessageRead（gen 生成非手写），backend/openapi.json 已刷新含六个新端点
  - 六函数路径/method/请求体/响应类型与 task-02/03 后端 router 一一对应
  - 错误不本地处理，统一由 apiFetch 抛 ApiError（对齐既有 client 惯例）
  - cd frontend && pnpm exec tsc --noEmit 干净
verify:
  - cd frontend && pnpm gen:types && pnpm exec tsc --noEmit
constraints:
  - 禁止手写 api-types.ts——必须 gen:types 生成并随变更提交（CLAUDE.md 规则 21）
  - 不动 UI 组件与 hook——会话树/定时 UI 归 task-07/08，本卡只到 lib 层
  - 与 task-04 文件正交——不改 backend/app 下任何源码（openapi.json 是 dump 产物）
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
