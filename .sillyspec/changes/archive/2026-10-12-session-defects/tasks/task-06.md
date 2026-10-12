---
id: task-06
title: 'F7 export and task-list dedup — export.py + session_insights.py keep one latest real terminal row per session+task-name + tests'
title_zh: 'F7 导出与任务列表去重——export.py + session_insights.py 同 session 同名取最新真实终态行 + 测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-12 21:01:59
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service/export.py
  - backend/app/modules/daemon/router/session_insights.py
  - NEW:backend/app/modules/daemon/task_snapshot_dedupe.py
  - NEW:backend/app/modules/daemon/tests/test_session_tasks_dedupe.py
  - backend/tests/modules/daemon/test_session_export.py
target_files:
  - backend/app/modules/daemon/session/service/export.py
  - backend/app/modules/daemon/router/session_insights.py
  - NEW:backend/app/modules/daemon/tests/test_session_tasks_dedupe.py
  - backend/tests/modules/daemon/test_session_export.py
goal: >
  导出任务快照（backend/app/modules/daemon/session/service/export.py:702
  _fetch_export_tasks）与任务列表 API（session_insights.py:602 GET
  /sessions/{id}/tasks，全路径 backend/app/modules/daemon/router/session_insights.py:602）
  同口径去重：同 session 同名任务只保留最新真实终态行，历史幽灵成对行
  （F3 遗留数据，D-005 兜底）不再双行出现。
implementation:
  - 抽共享去重 helper（NEW:backend/app/modules/daemon/task_snapshot_dedupe.py；或两处各自实现同款判定纯函数）——输入行集按 (session_id, task_name) 分组；不触碰 task-03 的 agent_task_store.py（同 Wave 文件正交）。
  - 去重判定：终态优先序 completed > failed > stopped，同组取 updated_at 最新的真实终态行；组内无终态行（纯 running）保持原行不变。
  - 接入导出：backend/app/modules/daemon/session/service/export.py:702 _fetch_export_tasks 查询后、渲染前（:763 调用点链路）应用去重，full 档 tasks 每任务名恰一行。
  - 接入任务列表：backend/app/modules/daemon/router/session_insights.py:602 路由（handler :605，查询内联 :625-627）同口径去重后输出，AgentSessionTaskRead 响应形状与 updated_at desc 排序不变。
  - 测试：backend/tests/modules/daemon/test_session_export.py 补含幽灵成对行（同名 stopped 空摘要 + completed 真摘要）数据源的去重用例（:695 full 档 zip 结构用例为 harness 先例）；端点级去重用例与「无重复行数据源零变化」用例落 NEW:backend/app/modules/daemon/tests/test_session_tasks_dedupe.py（独立文件——test_agent_session_tasks.py 为 task-03 同 Wave 专属文件，避免同 Wave 文件交集）。
acceptance:
  - 含生产幽灵成对行模式的数据源：full 档导出 tasks 与 GET /sessions/{id}/tasks 每任务名恰输出一行真实终态行（completed > failed > stopped，同名取 updated_at 最新）。
  - 无重复行数据源输出零变化（行集内容与 updated_at desc 排序不变，两个测试文件既有用例零回归）。
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_tasks_dedupe.py tests/modules/daemon/test_session_export.py -q --no-cov
constraints:
  - 不改 AgentSessionTaskRead 响应模型与端点签名（仅行集去重）；不修改 backend/app/modules/daemon/agent_task_store.py（task-03 文件，Wave 内正交）。
  - 去重判定按终态状态判定，不依赖 RUN_CLOSE_SWEEP_REASON 文案匹配；只跑相关测试不跑全量（规则 0）。
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
