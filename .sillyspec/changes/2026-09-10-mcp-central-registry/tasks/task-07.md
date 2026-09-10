---
id: task-07
title: '契约测试——golden + 授权三态 + 回落'
title_zh: '契约测试——golden + 授权三态 + 回落'
author: 'qinyi'
created_at: 2026-09-10 11:18:41
priority: P0
depends_on: ['task-05', 'task-06']
blocks: []
requirement_ids: [FR-03, FR-04]
decision_ids: [D-003, D-008@v2, D-010]
allowed_paths:
  - backend/app/modules/daemon/tests/test_mcp_config_endpoint.py
  - sillyhub-daemon/tests/mcp-config.test.ts
target_files:
  - backend/app/modules/daemon/tests/test_mcp_config_endpoint.py
  - sillyhub-daemon/tests/mcp-config.test.ts
goal: >
  以契约测试锁定换源后的端点行为——无 user_id golden 三键逐字段对照、user_id 授权三态（合法 lease 通过 / 无 lease 404 / 跨 daemon 404）、空库空集与渲染错误 503 回落链，防 daemon 注入链回归（R-01 / R-08）。
implementation:
  - golden 用例——seed platform binding（含 encrypted_env 解密回填）后无 user_id 调用，响应三键逐字段精确断言（platform_default 内容 / whitelist / 带与不带 workspace_id 两形态，对照旧版响应形状）
  - 授权三态用例——合法 lease（principal 与 lease runtime 归属一致）200 返回 platform ∪ user；无匹配 lease 404；跨 daemon（他人 runtime 的 lease）404（D-010）
  - 空库用例——无任何 mcp_servers 行时 200 且 platform 位为空 mcpServers 结构（daemon 不因空库阻塞会话创建）
  - 503 回落链用例——注入 render_injection_set 抛错断言端点 503；daemon 侧 mcp-config.test.ts 断言非 200（含 503）走 fallbackMcpBundle 本地文件回落（mcp-config.ts:246-253 链路可达）
  - user binding 可见性边界——无 user_id 调用不见 user binding 注入集（旧 daemon 语义锁定）
acceptance:
  - golden 三键逐字段全量断言通过（全局验收 AC-4）
  - 授权三态单测全绿（全局验收 AC-5）
  - 空库空集与 503 回落两语义均有用例锁定（全局验收 AC-6）
  - 用例全部落在本卡 allowed_paths 内两文件，不另开测试文件
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_mcp_config_endpoint.py -q
  - cd sillyhub-daemon && pnpm test -- mcp-config
constraints:
  - 只写测试不改产品代码——发现实现缺陷回 task-05 / task-06 修，不在本卡开面
  - golden 用精确逐字段对照（非子集匹配），锁死键集与键内容
  - mock 边界止于 render_injection_set 抛错注入（503 用例），不深入渲染内部
expects_from:
  task-05:
    - contract: daemon mcp config 端点
      needs: [user_id_query_param, mcp_config_three_key_response, render_error_503]
  task-06:
    - contract: claim user_id 透传链
      needs: [fetch_user_id]
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
