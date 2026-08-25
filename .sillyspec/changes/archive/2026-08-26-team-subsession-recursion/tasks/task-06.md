---
id: task-06
title: 'run_sync 失败即收口——首 run failed + 会话从未 ready + parent 非空 → 子会话置 failed+ended_at'
title_zh: 'run_sync 失败即收口——首 run failed + 会话从未 ready + parent 非空 → 子会话置 failed+ended_at'
author: 'qinyi'
created_at: 2026-08-26 03:10:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-006@v1]
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
  - backend/app/modules/daemon/tests/test_run_sync_session_gate_failover.py
goal: >
  backend run_sync 闸拒绝失败收口（FR-06/D-006@v1 Grill M1-R 终版）——
  daemon 会话闸拒绝的子会话首 run 回传 failed 后，backend 补收口规则置
  status=failed + ended_at（非 ended），触发面收窄防误杀，杜绝闸拒绝后
  子会话占额度且 mission 卡死。
implementation:
  - 'close_interactive_run 会话终态块（:1312-1331）增补规则——三条件齐备才命中：① run.status=failed；② 首 run（该 agent_session_id 下 AgentRun 行数恰 1=本 run）；③ 会话从未 ready（get_session_readiness() 单例探测——消费先例对齐 daemon/session/service.py :3021 clear；闸拒绝会话 daemon 从未上报 mark_ready）且 session.parent_session_id 非空（分身子会话）→ 置 session.status=failed + ended_at，复用既有翻转块（_session_end_intent SESSION_END best-effort + publish_sessions_changed）'
  - '命中优先于多轮 keep-active——_apply_session_terminal_status 对 interactive 多轮返 active 的分支被本规则覆写（幂等守卫不变：session 已 ended/failed 时整体跳过）；非命中路径逐字节不变（追问轮失败曾 ready 不收口、首 run completed 走既有 ended 映射、parent NULL 普通会话不涉及）'
  - '新测试 test_run_sync_session_gate_failover.py——闸拒绝形态（首 run failed+从未 ready+parent 非空）→ failed 终态带 ended_at 且发 SESSION_END 清理信号；追问轮失败（曾 mark_ready）保持 active 不误杀；首 run completed 正常 ended；同会话已有更早 run 的 failed 不收口'
acceptance:
  - '触发面「首 run failed + 从未 ready + parent 非空」缺一不可——命中置 failed（非 ended，对齐 P1 _fail_worker_subsession 语义）+ ended_at，mission 可继续收敛（会话终态 failed 的虚拟映射天然可收敛 degraded，不卡死不占额度）'
  - '追问轮中途失败的存活分身不命中（曾 ready → 保持 active 等下一轮，turn 失败≠会话死亡 P1 原则）；存量会话终态映射零回归'
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_run_sync_session_gate_failover.py -q --no-cov
  - cd backend && uv run pytest app/modules/daemon -q --no-cov -n auto
  - cd backend && uv run ruff check app/modules/daemon/run_sync/service.py && uv run mypy app
constraints:
  - '不改 daemon/session/service.py——_apply_session_terminal_status 与 SessionReadiness 类原样消费；readiness 经单例只读探测（wait(timeout=0) 探针或直读 _ready 成员，后者避免 _events 残留槽位）'
  - '置 failed 非 ended（D-006@v1 终版）；本卡唯一行为面是收口规则本身，既有终态映射/SESSION_END/publish 链路复用不改'
  - 'daemon 侧闸本体（计数/拒绝/env）归 task-04——本卡只做 backend 收口，独立可先行（plan 拓扑 task-06 无依赖）'
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
