---
id: task-08
title: 'F1b auto-recovery orchestration - auto_resume context_overflow branch (compact_session call + inline AgentSessionScheduledMessage replay + circuit-breaker=2 + AppError hint not swallowed) + pytest cases'
title_zh: 'F1b 自动恢复编排——auto_resume context_overflow 分支（compact_session 调用+内联直插 AgentSessionScheduledMessage 重放+熔断=2+AppError 引导不吞）+ pytest 用例'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-12 21:01:59
priority: P0
depends_on: ['task-07', 'task-09']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-003@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service/auto_resume.py
  - backend/app/modules/daemon/tests/test_auto_recover_failed_turn.py
target_files:
  - backend/app/modules/daemon/session/service/auto_resume.py
  - backend/app/modules/daemon/tests/test_auto_recover_failed_turn.py
goal: >
  为 context_overflow 失败构建自动压缩续跑编排（D-003：压缩是 agent 原生能力
  compact_session 双分路，平台只编排）：熔断=2 防循环，compact 成功内联直插调度消息
  重放本轮原文，失败/AppError 引导写入不吞（D-006：可自动恢复失败不终态化 interactive 会话，
  session 语义由 task-09 保证）。
implementation:
  - 'backend/app/modules/daemon/session/service/auto_resume.py:338 maybe_auto_recover_failed_turn 新增 context_overflow 分支：error_detail.type == "context_overflow" 且 provider caps compact=true 才进入'
  - '熔断：仿 _count_chain_type（auto_resume.py:660）数连续 context_overflow 链，新增常量 CONTEXT_OVERFLOW_CHAIN_LIMIT = 2；链达上限不再自动恢复，对刚终态的 run 写链上限提示（走 _write_chain_limit_hint auto_resume.py:696-720 同款）'
  - '调 compact_session（backend/app/modules/daemon/session/service/compact.py:78；claude 注入原生 /compact，pi/codex 走 session_compact RPC，D-003）'
  - 'compact 成功 → 对齐 quota 分支形态函数内直插 AgentSessionScheduledMessage（auto_resume.py:452-467 先例、分支 B 形态 :626-642），delay=0 重放本轮用户消息；重放提示词新增 context_overflow 场景化模板（「上下文已满已自动压缩、以下为你的原始消息」），wrap_resume_prompt 仅标记位复用、不复用 daemon 重启语境文案；禁走 maybe_enqueue_auto_resume——其 G3 门禁（auto_resume.py:193）仅放行 error_code=daemon_restarted，context_overflow 必被拒（Grill X2）'
  - 'compact 失败/不支持/AppError → 不重试；except 边界内必须走 _write_chain_limit_hint（auto_resume.py:696-720）同款引导写入，AppError 类业务失败不得静默吞引导（Grill X2 gap）；仅 DB 写入失败才降级纯日志'
  - 'caps.compact=false → 自动跳过本分支走既有路径，不压缩、不报错'
acceptance:
  - '首次 context_overflow 失败触发：compact_session 被调用 + AgentSessionScheduledMessage 入队（重放本轮原文）断言通过'
  - '连续链 = 2 后第三次 context_overflow 不再入队（熔断生效），链上限提示写入断言通过'
  - 'compact_session 抛 AppError：用户引导仍写入（不被吞）断言通过，run 终态不受影响'
  - '恢复钩子内异常不影响已 commit 的 run 终态（静默容错边界收窄后引导面仍不被吞）'
verify:
  - cd backend && python -m pytest app/modules/daemon/tests/test_auto_recover_failed_turn.py
  - cd backend && python -m pytest app/modules/daemon/tests/test_auto_resume_chain_limit_hint.py
constraints:
  - '重放禁走 maybe_enqueue_auto_resume（G3 门禁 auto_resume.py:193 仅放行 daemon_restarted）'
  - '禁改 error_code/error_detail 正交写入（backend/app/modules/daemon/run_sync/service/close_run_steps.py:288，D-009）'
  - '禁全量测试，仅跑相关（CLAUDE.md 规则 0）'
<!-- 执行期对账修正（verify 收口，与该 task review 结论一致）：target_files 移除 backend/app/modules/daemon/tests/test_auto_resume_chain_limit_hint.py —— test_auto_resume_chain_limit_hint.py 既有用例零回归未改动（新用例落 test_auto_recover_failed_turn.py） -->

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
