---
id: task-09
title: 'F1c session status semantics - investigate real failed-flip path of session 47e2ff1a (first half, output decides task-08 landing), then fix (no terminalization within recovery budget) + tests'
title_zh: 'F1c 会话状态语义——调查 47e2ff1a 翻 failed 真实路径（前半，产出决定 task-08 落点）→ 修正（恢复预算内不终态化）+ 测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-12 21:01:59
priority: P1
depends_on: ['task-07']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-006@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service/helpers.py
  - backend/app/modules/daemon/session/service/recovery.py
  - backend/app/modules/daemon/tests/test_apply_session_terminal_status.py
target_files:
  - backend/app/modules/daemon/session/service/helpers.py
  - backend/app/modules/daemon/tests/test_apply_session_terminal_status.py
goal: >
  调查会话 47e2ff1a 被翻 failed 的真实路径（与 helpers.py:99 多轮返 active 矛盾）并修正
  会话终态语义（D-006）：可自动恢复失败（context_overflow/quota 且恢复预算未耗尽）不终态化
  interactive 会话，恢复预算耗尽才允许 failed。前半调查结论决定 task-08 落点（本卡先行）。
implementation:
  - '调查（前半）：backend/app/modules/daemon/session/service/helpers.py:99 _apply_session_terminal_status 对 interactive 多轮返 active，与生产会话 47e2ff1a 终态 failed 矛盾；排查候选路径：①gate 拒绝覆写（backend/app/modules/daemon/run_sync/service/close_run_steps.py:482-486，new_status=="active" 且 _is_gate_rejected_first_failure 命中则覆写，design.md 预写行号 :496 有漂移）；②mark_session_recovery_failed（backend/app/modules/daemon/session/service/recovery.py:623）；③手动关闭 / cancel_lease 写终态；④run30 的 spec_strategy 非 interactive（单轮任务按 run.status 收口 failed）；结论留痕于本卡 implementation 注记或决策记录'
  - '修正（后半，按调查结论）：恢复预算内可恢复失败（context_overflow/quota 且预算未耗尽）返 active 不终态化；恢复预算耗尽才允许 failed；D-005 幂等语义（终态已写直接返回 None）不变'
  - '组合推演（design.md R-07）：gate 覆写优先级保持高于 active 保持，推演无死锁后落实现'
acceptance:
  - '47e2ff1a 翻 failed 真实路径调查结论留痕（写明命中候选与证据 file:line）'
  - 'interactive 会话单次 context_overflow/quota 失败保持 active 的用例通过'
  - 'gate 拒绝覆写场景仍 failed 的用例通过（零回归，close_run_steps.py:482-486 覆写优先级不降）'
verify:
  - cd backend && python -m pytest app/modules/daemon/tests/test_apply_session_terminal_status.py app/modules/daemon/tests/test_close_interactive_run_session_status.py
constraints:
  - '不破坏 _apply_session_terminal_status 的 D-005 幂等（session 已终态直接返回 None）'
  - '修正落点允许按调查结论在同级文件内调整（design.md 自审存疑②），语义不变'
  - '禁全量测试，仅跑相关（CLAUDE.md 规则 0）'
<!-- 执行期对账修正（verify 收口，与该 task review 结论一致）：target_files 移除 backend/app/modules/daemon/run_sync/service/close_run_steps.py, backend/app/modules/daemon/tests/test_close_interactive_run_session_status.py —— 调查结论：修正落点在 helpers.py（close_run_steps.py 无需改动——闸拒绝覆写逻辑原样保留）；test_close_interactive_run_session_status.py 既有用例零回归未改动 -->

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
