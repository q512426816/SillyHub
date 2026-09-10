---
id: task-06
title: 'expose-effective-agent-and-providers-in-get-daemon-status'
title_zh: 'get_daemon_status 响应增 default_agent/effective_agent 与每 daemon 的 providers 列表'
author: 'qinyi'
created_at: 2026-09-10 21:30:00
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/mcp_gateway/tools.py
  - backend/app/modules/mcp_gateway/tests/test_tools_new.py
target_files:
  - backend/app/modules/mcp_gateway/tools.py
  - backend/app/modules/mcp_gateway/tests/test_tools_new.py
goal: >
  get_daemon_status（tools.py:1009-1104）纯增量暴露执行器信息（FR-04/D-003@v1）：
  顶层 default_agent/effective_agent + daemons[] 每项 providers 列表，让
  review-dispatch 派发前一次查询即可判「会用哪个执行器、哪些机器在线」。
implementation:
  - '响应顶层增 default_agent（workspace.default_agent 原值，workspace 已在 :1047 加载，可 None）'
  - '顶层增 effective_agent：default_agent 非空即它；否则取 daemons 返回序首个 online 项 providers[0] 的 provider；无 online 为 None'
  - 'daemons[] 每 entry 增 providers: [{provider, status, version}]：对 bindings 的 daemon_id 集合一条 select(DaemonRuntime).where(daemon_instance_id.in_(...), status == "online") 按 daemon_id 分组挂载（version 可 None）'
  - 'docstring 补口径：providers 仅聚合 online runtime；effective_agent 为「调用方可判信号非权威解析」，权威以派发时 placement 实算为准'
  - 'tests/test_tools_new.py 增断言：default_agent 原值透传、effective_agent 两种回退口径（default 置空取首个 online provider / 全空 None）、providers 分组与 online 过滤'
acceptance:
  - 'workspace.default_agent="pi" 时 default_agent=="pi" 且 effective_agent=="pi"'
  - 'default_agent 为空且有 online daemon 时 effective_agent==返回序首个 online 项 providers[0].provider；无 online/无 providers 时为 None'
  - '每个 daemon entry 含 providers 数组（元素 {provider, status, version}，version 可 None），由一条批量 in 查询产出'
  - '既有响应键与既有 5 用例断言零破坏（纯增量键）'
verify:
  - 'cd backend && uv run pytest app/modules/mcp_gateway/tests/test_tools_new.py -q --no-cov'
constraints:
  - '纯增量键：不动任何既有响应键与既有 5 用例断言'
  - 'providers 一条批量查询（daemon_instance_id.in_(...)）不进 per-binding 循环'
  - 'effective_agent 不加额外 ORDER BY（用 bindings 返回序），只作可判信号非权威解析；不做 default_agent 写路径（运维 PATCH 归交付文档）'
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
