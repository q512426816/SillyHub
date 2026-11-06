---
id: task-03
title: 'backend DS-7 门放宽（删 :133-139 拒绝块 + DaemonSessionNoCwd 退役）+ 测试改写'
title_zh: 'backend DS-7 门放宽（删 :133-139 拒绝块 + DaemonSessionNoCwd 退役）+ 测试改写'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-11-06 23:03:28
priority: P0
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-002@v2, D-004@v1]
depends_on: [task-01]
allowed_paths:
  - backend/app/modules/daemon/session/service/session_lifecycle.py
  - backend/app/modules/daemon/session/service/errors.py
  - backend/app/modules/daemon/tests/test_session_reopen.py
target_files:
  - backend/app/modules/daemon/session/service/session_lifecycle.py
  - backend/app/modules/daemon/session/service/errors.py
  - backend/app/modules/daemon/tests/test_session_reopen.py
goal: >
  backend reopen 前置校验删除「空 cwd 提前 409」（DS-7）——agent_session_id 可自愈即放行，SDK 标识维度维持拒绝；DaemonSessionNoCwd 错误类退役。
implementation:
  - backend/app/modules/daemon/session/service/session_lifecycle.py：删除 :133-139 空 cwd 拒绝块（含 :134-135 注释同删）；其余前置校验顺序不动（engine 门 :106 → agent_session_id 自愈 :115-132 → [删] → ACTIVE 检查 :140 → runtime 在线 :176，order is load-bearing 注释保持成立）
  - backend/app/modules/daemon/session/service/errors.py：删除 DaemonSessionNoCwd 错误类；仓内残留 import 一并清理（grep 确认零引用后删）
  - backend/app/modules/daemon/tests/test_session_reopen.py：DS-7 用例改写（行为有意变更非修测试凑过）——原「空 cwd → 409 NO_CWD」用例改为「空 cwd + agent_session_id 有 → 放行进入 resume 下发流程」；「agent_session_id 无法自愈 → 仍 409 DaemonSessionNoAgentSession」用例保持并加 cwd 空断言（D-004：不按 origin 分流，无来源分支）
acceptance:
  - 空 cwd 且 agent_session_id 非空（或可自愈）的会话 reopen 不再 409，进入 lease 创建与 SESSION_RESUME 流程
  - agent_session_id 缺失且无法自愈仍 409 DaemonSessionNoAgentSession（FR-02）
  - DaemonSessionNoCwd 在 backend 仓内零引用（grep 无残留 import/用法）
  - 「空 cwd 且 ACTIVE」会话错误类型变化为 NotActive（审查确认的良性微变）有注释或用例说明
verify:
  - uv run --project backend pytest app/modules/daemon/tests/test_session_reopen.py -x -q
constraints:
  - 不动 agent_session_id 自愈链与其它前置校验顺序
  - 放行口径不引入 origin/来源维度分支（D-006 负向）
  - 聚焦测试，禁跑全量
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
