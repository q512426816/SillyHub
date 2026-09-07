---
id: task-06
title: 'hub-client 三职——POST /states 批量上报 + GET /agent-logs 周期拉登记行 + 第一方 blocked 并入（D-012 优先级）+ daemon.ts 生命周期挂接（独立 try）'
title_zh: 'hub-client 三职——POST /states 批量上报 + GET /agent-logs 周期拉登记行 + 第一方 blocked 并入（D-012 优先级）+ daemon.ts 生命周期挂接（独立 try）'
author: 'qinyi'
created_at: 2026-09-07 13:43:27
priority: P0
depends_on: ['task-02', 'task-03', 'task-04']
blocks: []
requirement_ids: [FR-01, FR-03, FR-04]
decision_ids: [D-003@v1, D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/agent-log/liveness/hub-client-states.test.ts
  - sillyhub-daemon/tests/agent-log/liveness/daemon-liveness-wiring.test.ts
target_files:
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/daemon.ts
  - NEW:sillyhub-daemon/tests/agent-log/liveness/hub-client-states.test.ts
  - NEW:sillyhub-daemon/tests/agent-log/liveness/daemon-liveness-wiring.test.ts
goal: >
  打通 daemon liveness 全链路：hub-client 增批量上报、登记行周期拉取、第一方 blocked 并入三职，daemon.ts 完成生命周期挂接（独立 try 包裹），推导结果周期上行 backend。
implementation:
  - 修改 hub-client.ts 增 pushAgentLogStates：POST /api/agent-logs/states，body 按 design §7 AgentLogStateEntry（log_path/state/evidence/derived_at/last_event_at，行不存在时附 harness/format/agent_session_id/agent_cwd 供 create），批量 ≤64、超限自动分批，经既有 _request 入口与 _headers 鉴权（X-API-Key 同 register），2xx 即成功不读 body。
  - 修改 hub-client.ts 增 listAgentLogs：GET /api/agent-logs 周期拉 SillySpec 登记落库行作 watch list 增强源（hub-client 现无此读取方法，需新增）。
  - 第一方 blocked 并入（D-012 优先级）：推送某会话 states 前，经 src/interactive/session-manager.ts 的 getPermissionResolver(sessionId) 查 pending（pendingCount>0）→ 该会话 state 取 blocked、evidence 记 PERMISSION_REQUEST 事件（如 PERMISSION_REQUEST(write)），日志推导不重复判定。
  - 修改 daemon.ts：start() 既有 _fire 循环（_heartbeatLoop/_pollLoop/_wsLoop 等）之后以独立 try 包裹挂接 liveness 循环（discovery 汇聚 → watch join → tailer tick → 收集推导 → 分批 push，周期 listAgentLogs 结果并入 watch list 并按 workspace+log_path 去重），失败仅 warn 不影响主循环；stop() 随 _fire abort 语义优雅停止。
  - 新建 tests/agent-log/liveness/hub-client-states.test.ts（POST 形状与分批、鉴权头、GET 解析、pending blocked 优先级覆盖日志推导）与 tests/agent-log/liveness/daemon-liveness-wiring.test.ts（liveness 启动抛错不影响 daemon started、stop 优雅停止）。
acceptance:
  - POST 请求携带 daemon 鉴权头且 entries 超 64 自动分批；GET 解析出登记行并入 watch list（按 workspace+log_path 去重）。
  - 会话存在未消解 PERMISSION_REQUEST 时推送 state=blocked 且 evidence 为第一方事件，日志推导不并行产出 blocked（D-012 去重）。
  - liveness 挂接抛错仅记 warn，主循环照常启动且 read_agent_log_messages 链路不受影响（R-02 回归）。
verify:
  - cd sillyhub-daemon && pnpm test -- tests/agent-log/liveness/hub-client-states.test.ts tests/agent-log/liveness/daemon-liveness-wiring.test.ts
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - R-01：blocked 只能由第一方 pending 事件产出（zcode/codex deriver 恒不产 blocked），D-012 第一方>日志推导。
  - CLI 上报契约零变更：不修改既有 register agent log 上报路径与 protocol.ts 契约。
  - daemon.ts 挂接独立 try 包裹，tailer/上报崩溃不得影响登记链路（R-02）。
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
