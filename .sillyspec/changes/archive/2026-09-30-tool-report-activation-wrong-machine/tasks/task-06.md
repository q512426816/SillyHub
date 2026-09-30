---
id: task-06
title: 'retire lazy activation and add reset endpoint'
title_zh: '懒激活退役 + reset-tool-report 端点'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-30 11:07:12
priority: P0
depends_on: [task-04]
blocks: [task-07]
requirement_ids: [FR-02, FR-05]
decision_ids: [D-003@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service/inject.py
  - backend/app/modules/daemon/session/service/ppm_activation.py
  - backend/app/modules/daemon/session/service/helpers.py
  - backend/app/modules/daemon/session/service/__init__.py
  - backend/app/modules/daemon/router/session_crud.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/tests/
target_files:
  - backend/app/modules/daemon/session/service/inject.py
  - backend/app/modules/daemon/session/service/ppm_activation.py
  - backend/app/modules/daemon/session/service/helpers.py
  - backend/app/modules/daemon/router/session_crud.py
  - backend/app/modules/daemon/schema.py
provides:
  - contract: ResetToolReportResponse
    fields: [session_id, status, cleared_runs]
goal: >
  退役 inject 懒激活分支（pending tool_report 会话 409 中文指引 takeover）并新增存量钉死会话重置端点（守卫+回滚+事件，FR-02/FR-05）。
implementation:
  - inject.py 懒激活分支（:216 origin=tool_report and lease_id is None 判定）改抛 409 中文指引（引导 POST /sessions/{id}/takeover）；删除 _activate_tool_report_session 调用链（ppm_activation.py 函数体 + __init__.py facade + ToolReportActivateNoDaemon/ToolReportTakeoverNoDaemon 错误类收敛）
  - helpers.py 新增 reset_tool_report_session：校验（origin=tool_report、属主、无 current_run 否则 409）→ 回滚 status=pending/turn_count=0/runtime_id=NULL/lease_id=NULL（失败 run 行保留、error_code 不动供审计）→ publish_sessions_changed + _publish_session_event
  - session_crud.py 新增 POST /sessions/{session_id}/reset-tool-report 路由；schema.py 加 ResetToolReportResponse
  - 既有懒激活用例退役（plan 评审 P2-2 显式化）：检索 daemon tests 中 _activate_tool_report_session/懒激活相关断言（如 test_session_events_cross.py 等）改写为「409 指引」新语义或删除，相关测试文件路径进 related_tests
  - 新增 reset 用例：正常回滚、running 409、非 tool_report 409、chat 会话 inject 不受影响
acceptance:
  - pending tool_report 会话调 inject 收 409 + 中文 takeover 指引；_activate_tool_report_session 代码全仓无引用
  - reset 端点对钉死会话回滚四字段并发布事件；running 时 409
  - 普通 chat 会话 inject 主路径零回归（既有 inject 用例全绿）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests -q --no-cov -k "inject or reset or takeover"
constraints:
  - 失败 run 行保留（审计），仅回滚会话四字段
  - 错误文案中文；不迁移存量数据（重置按需手动触发）
  - 与 task-05 同 Wave：本卡禁改 takeover.py 与 test_takeover_handoff.py（文件正交约束）
related_tests:
  - path: backend/app/modules/daemon/tests/test_session_events_cross.py
    reason: 含 tool_report 懒激活断言，随激活分支退役需改写为 409 指引语义
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
