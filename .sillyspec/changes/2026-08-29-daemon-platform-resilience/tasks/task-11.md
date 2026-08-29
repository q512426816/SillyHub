---
id: task-11
title: 'gen-types-sync-and-four-scenario-integration-regression'
title_zh: '三端 gen:types 收口与四场景集成回归（依赖 task-01 至 task-10 全部完成）'
author: 'qinyi'
created_at: 2026-08-29 03:07:34
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/openapi.json
  - sillyhub-daemon/src/api-types.ts
  - frontend/src/lib/api-types.ts
  - backend/app/modules/daemon/tests/test_resilience_integration.py
  - sillyhub-daemon/tests/integration/resilience-scenarios.test.ts
goal: >
  收口本变更——backend openapi 再导出驱动 daemon 与 frontend 双端 gen:types 三端类型同步提交，并以四场景集成用例对 FR-01 至 FR-07 做端到端回归验收。
implementation:
  - 前端跑 pnpm gen:types（内部先 uv 跑 backend dump_openapi.py 刷新 backend/openapi.json 再生成 frontend/src/lib/api-types.ts），daemon 跑 pnpm gen:types 消费同一份 openapi.json 生成 sillyhub-daemon/src/api-types.ts，确认 pending-controls 与 ack 与 suspend-batch 与 permission-requests 四端点及心跳 pending_controls 字段全部收进类型，三个生成文件一并提交
  - 新增 backend 集成用例 test_resilience_integration.py——场景一后端侧断言（enqueue 后 WS 推送失败或 daemon 不在线保持 pending、补拉仅返回 pending、delivered 不重发、同 command_id 不双发即 inject 零重复）与场景二 backend 重启收敛（fake 时钟驱动 lifespan 恢复在线 daemon 的 pending lease 重发 WS 唤醒、claimed lease 心跳停 60s 级被 lease_expiry_sweeper 过期重派或标失败）
  - 新增 daemon 集成用例 tests/integration/resilience-scenarios.test.ts（目录不存在则创建）——mock hub 断言场景一 daemon 侧补拉消费按 command_id LRU 去重加逐条 ACK 零丢失
  - 场景三 daemon 重启会话恢复——stop 挂起（suspend-batch）后模拟重启，断言 suspended→recover→reconnecting→confirm-reconnected→active 链路可继续对话、历史完整、中断轮 failed
  - 场景四前端回显——重跑 task-09 交付的连接横幅与看门狗 jsdom 用例（假时钟推进 90s 与 30s 三轮复核），断言断线横幅出现、恢复后消失、看门狗触发对账
  - 对照 module-impact.md 更新结果表逐行核对三份模块文档（backend/frontend/sillyhub-daemon）说明已回填，残留 pending 项上报主线
acceptance:
  - 四场景集成用例全绿（backend pytest 与 daemon vitest 两个新文件加前端重跑用例）
  - api-types 三端同步提交（backend/openapi.json 与两份 api-types.ts），再跑 pnpm gen:types:check 无 diff 残留
  - alembic 单 head（task-01 新迁移与既有迁移链无分叉）
  - module-impact.md 更新结果表核对完成，未回填项已上报主线
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_resilience_integration.py -q（另跑 uv run alembic heads 确认单 head）
  - cd sillyhub-daemon && pnpm exec vitest run tests/integration/resilience-scenarios.test.ts
  - git status 检查三个生成文件已更新并随卡提交；另按实际文件名重跑 task-09 前端连接横幅与看门狗 jsdom 用例
constraints:
  - 遵守 CLAUDE.md 规则 0——禁止跑全量测试，仅跑本变更相关用例，全量留 CI
  - gen:types 前确认前端与 daemon 的 node_modules 健康（pnpm exec tsc --version 可跑、openapi-typescript 的 .bin shim 在），半坏先 pnpm install --force 修复再生成
  - 三个生成文件只经 gen:types 产出禁止手改，场景四仅重跑 task-09 前端用例不新增前端测试文件；协程与看门狗类用例显式注入 fake 时钟（jsdom 假时钟或独立事件循环），遵守 known_failures 豁免清单纪律
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
