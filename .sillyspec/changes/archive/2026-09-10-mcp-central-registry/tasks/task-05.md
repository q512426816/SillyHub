---
id: task-05
title: 'daemon 端点换源 + user_id 授权'
title_zh: 'daemon 端点换源 + user_id 授权'
author: 'qinyi'
created_at: 2026-09-10 11:18:41
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-03, FR-04]
decision_ids: [D-003, D-008@v2, D-010]
allowed_paths:
  - backend/app/modules/daemon/router/daemon_rpc.py
  - backend/app/modules/daemon/tests/test_mcp_config_endpoint.py
target_files:
  - backend/app/modules/daemon/router/daemon_rpc.py
  - backend/app/modules/daemon/tests/test_mcp_config_endpoint.py
related_tests:
  - backend/app/modules/daemon/tests/test_mcp_config_endpoint.py
goal: >
  GET /api/daemon/mcp/config（daemon_rpc.py:516 端点）数据源从 mcp.platform_default KV 切到 registry 渲染，加可选 user_id 查询参数与 lease 归属授权校验（D-010 无匹配 404），渲染抛错返 503 保持 daemon 本地回落链可达，响应三键形状不变。
implementation:
  - 端点签名加 user_id 查询参数（uuid.UUID | None 缺省 None），认证保持 get_current_principal（daemon_rpc.py:519）
  - platform_default 位换源调 render_injection_set(session, user_id)（task-04），无 user_id 仅 platform binding；whitelist 读取不动（daemon_rpc.py:554-555，D-007 白名单留 settings）；workspace_id 分支与 _read_mcp_config_raw 不动（daemon_rpc.py:561-563）
  - user_id 有值时做 lease 归属双校验——查活跃 lease join DaemonRuntime（lease.runtime_id=runtime.id，status 取 pending/claimed 现行活跃态）匹配 runtime.user_id=principal.id 且 runtime.user_id=请求 user_id（lease→user 关联链 daemon/model.py:403-410 与 :230），无匹配 404（D-010，不泄露 user 存在性）
  - render_injection_set 抛错时端点返 503（中文 detail）——daemon 侧 fetch 非 200 回落本地 mcp.json 的既有链路保持可达（mcp-config.ts:246-253）
  - 重写 test_mcp_config_endpoint.py 七个 KV-seed 用例（:109-:227）——改 seed mcp_servers 与 mcp_server_bindings 行（task-01 模型），断言 registry 渲染输出含 encrypted_env 解密回填真值不脱敏；auth gate 与 workspace_id 维度用例回归不动
acceptance:
  - 无 user_id 调用响应键集与旧版一致（不带 workspace_id 两键 / 带 workspace_id 三键），platform 位来自 registry platform binding
  - 合法 lease 归属的 user_id 返回 platform ∪ user 注入集
  - 无匹配 lease 与跨 daemon 两形态均 404（授权三态单测覆盖，D-010）
  - registry 空库 platform 位为空 mcpServers 结构且 200；渲染抛错 503
  - 七个 KV-seed 用例重写后全绿，workspace_id 既有用例零回归
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_mcp_config_endpoint.py -q
  - cd backend && uv run ruff check app/modules/daemon/router/daemon_rpc.py
  - cd backend && uv run mypy app/modules/daemon/router/daemon_rpc.py
constraints:
  - 响应三键形状不变（兼容策略 CC-04），旧 daemon 不带 user_id 零感知（渐进升级无断裂）
  - whitelist 键与 workspace 键读取逻辑不动（D-007）
  - mcp.platform_default KV 不再读不清理（D-003 零迁移，残留无害）
  - 503 仅用于渲染错误路径，空库仍 200 空集（回落语义与空集语义分开）
expects_from:
  task-01:
    - contract: mcp_registry 数据模型
      needs: [McpServer, McpServerBinding]
  task-04:
    - contract: mcp_registry 注入集渲染
      needs: [render_injection_set]
provides:
  - contract: daemon mcp config 端点
    fields: [user_id_query_param, mcp_config_three_key_response, render_error_503]
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
