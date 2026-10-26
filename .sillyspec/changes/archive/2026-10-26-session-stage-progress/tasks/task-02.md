---
id: task-02
title: 'daemon 信号源全集（notifyTurnPhase+五冷启动+轮内两阶段+测试+gen:types）'
title_zh: 'daemon 信号源全集（notifyTurnPhase+五冷启动+轮内两阶段+测试+gen:types）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 03:49:35
priority: P0
depends_on: ['task-01']
blocks: [task-05]
requirement_ids: [FR-02, FR-03]
decision_ids: [D-009@v1, D-013@v1]
allowed_paths:
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/interactive/session-manager/turn-control.ts
  - sillyhub-daemon/src/interactive/session-manager/events.ts
  - sillyhub-daemon/src/api-types.ts
  - sillyhub-daemon/tests/turn-phase-report.test.ts
target_files:
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/interactive/session-manager/turn-control.ts
  - sillyhub-daemon/src/interactive/session-manager/events.ts
  - sillyhub-daemon/src/api-types.ts
  - NEW:sillyhub-daemon/tests/turn-phase-report.test.ts
expects_from:
  task-01:
    - turn-phase 端点契约
goal: >
  daemon 侧阶段信号源全集：HTTP 上报方法 + 冷启动五步骤边界上报 + 追问轮/首事件上报，
  全路径失败静默（D-009）——把既有 endStep 计时数据「顺便」发出来。
provides:
  - daemon 上报行为: "五冷启动阶段+inject_received+first_event 按词表时机上报；run_id 恒带 firstRunId；first_event 每 run 至多一次"
implementation:
  - sillyhub-daemon/src/hub-client.ts 新增 notifyTurnPhase(sessionId, runId, phase, detail?)——照抄同文件 notifyBashStatus 模式：fetch POST task-01 端点，非 2xx 仅 log.warn 不抛出
  - sillyhub-daemon/src/daemon.ts _startInteractiveSession（约 9335-10030 行）：私有 helper（如 _reportTurnPhase）统一包裹 notifyTurnPhase + try/catch；skillsStep/specStep/mcpStep 三闭包首行发起信号（skills_sync/spec_sync/mcp_prefetch）、endStep 处自然收尾；SessionManager.create 调用前发 spawning；create 成功（notifySessionReady 同点位）发 ready。specStep SWR 命中跳过拉取时不发 spec_sync。runId 用 firstRunId（daemon.ts:9522 守卫后必非空，D-013②）
  - sillyhub-daemon/src/interactive/session-manager/turn-control.ts inject 的 InputQueue.push 后上报 inject_received（同款吞噬包裹）
  - sillyhub-daemon/src/interactive/session-manager/events.ts onMessage 撤看门狗处上报 first_event；防重键 (session_id, run_id)——run 级标志位，新 AgentRun 自然重置（D-013④）
  - 新增 sillyhub-daemon/tests/turn-phase-report.test.ts：①各上报点调用断言（mock hub-client）②notifyTurnPhase 网络失败不抛出（模拟 fetch reject）③first_event 同 run 第二事件不重报、新 run 重置
  - cd sillyhub-daemon && pnpm gen:types（task-01 openapi.json 为源）重生成 sillyhub-daemon/src/api-types.ts 并确认含 TurnPhaseReportRequest
acceptance:
  - 冷启动全序列五阶段在对应步骤边界各上报一次（测试断言调用序：skills_sync→spec_sync/mcp_prefetch（并行序不锁定）→spawning→ready）
  - notifyTurnPhase 对 4xx/5xx/网络异常均不抛出、会话创建/注入主流程不受影响（注入失败测试断言）
  - first_event 同 (session_id, run_id) 至多一次；新 run 首事件重新上报
  - sillyhub-daemon/src/api-types.ts 含 task-01 DTO 类型（gen:types 幂等再生成 diff 仅含新增）
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/turn-phase-report.test.ts（输出落盘只看尾部）
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 上报调用点收敛为单一私有 helper（god 文件 daemon.ts 防回归，R-07）；不得改动 endStep 计时既有行为
  - 遵守 daemon ESM import 带 .js 扩展名约定；vitest include 仅 tests/**（测试放 tests/ 不进 src）
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
