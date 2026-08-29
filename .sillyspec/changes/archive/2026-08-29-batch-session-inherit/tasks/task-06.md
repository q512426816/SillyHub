---
id: task-06
title: '集成回归（worker 掉线→重派→resume 续会话全链+主会话零破坏+三守卫+节流+降级）（depends_on: task-01, task-02, task-03, task-04, task-05）'
title_zh: '集成回归（worker 掉线→重派→resume 续会话全链+主会话零破坏+三守卫+节流+降级）（depends_on: task-01, task-02, task-03, task-04, task-05）'
author: 'qinyi'
created_at: 2026-08-29 21:15:48
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-003@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/daemon/tests/test_worker_redispatch.py
  - sillyhub-daemon/tests/integration/worker-resume.test.ts
goal: >
  全链集成回归验证 worker 掉线→重派→claim resume 续会话→损伤降级全链，锁定主会话零破坏、attempt>=3 节流终态与三互斥守卫，保五个任务卡交付物协同成立。
implementation:
  - 扩展 task-02 落地的 test_worker_redispatch.py 补全链断言——suspend 后 worker 会话 failed 且 AgentRun.error_code=daemon_interrupted+中断 run/lease 收敛+重派新 lease metadata 含 resume_session_id（=AgentSession.agent_session_id）+原 session 行翻回 active 且新 AgentRun 挂原 session
  - backend 守卫与节流集成——主会话（parent_session_id 为空）仅 suspended 零破坏、attempt>=3 不再重派留 failed 终态、converged/cancelled mission 不重派、patrol 职责④候选排除 daemon_interrupted、30min worker_force_end 窗口外不重派
  - 新增 daemon 集成 worker-resume.test.ts——claim 含 resume_session_id 时 _startInteractiveSession 透传 SessionManager.create 且 fake 断言 resume 到达 driverOpts，续会话后首轮由 pendingFirstPrompt 等 inject 或 10s fallback 驱动，mock 驱动损伤时降级 fresh+resume_downgraded；编排对齐 resilience-scenarios.test.ts 全 fake 禁真实网络与 SDK
acceptance:
  - backend 全链——daemon 停止→worker failed(daemon_interrupted)+重派新 lease 含 resume_session_id+原 session 复用翻 active；主会话（parent 为空）仍 suspended 零破坏（daemon_stopped 语义不变）
  - 节流与三守卫各有用例——attempt>=3 耗尽留 failed 终态不再新 lease、converged mission 不重派、patrol④不捞 daemon_interrupted、30min 窗口外不重派
  - daemon 全链——claim 含 resume 透传 create 续会话+损伤降级 fresh 一次+resume_downgraded 披露；无 resume 字段 claim 向后兼容零回归
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_worker_redispatch.py -q
  - cd sillyhub-daemon && pnpm exec vitest run tests/integration/worker-resume.test.ts && pnpm exec tsc --noEmit
constraints:
  - 禁全量测试——仅本卡两测试文件与直接回归面，全量留 CI（CLAUDE.md 规则 0）
  - 集成用例全 fake（网络/SDK/SessionManager），不引真实 backend/daemon 进程，对齐 resilience-scenarios.test.ts 既有形态
  - 只写测试不改产品码——发现链路缺陷回报不在本卡顺手修
  - D-003 最小闭环走既有链零新端点；test_worker_redispatch.py 为 task-02 新增文件，本卡只扩展不推翻其既有断言
expects_from:
  task-01:
    - contract: WorkerSuspendSplit
  task-02:
    - contract: worker_redispatch
  task-03:
    - contract: InteractiveResumeClaim
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
