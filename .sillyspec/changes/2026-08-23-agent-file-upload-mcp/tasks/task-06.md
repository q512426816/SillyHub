---
id: task-06
title: 'inject sillyhub-file mcp into interactive session spawn'
title_zh: 'daemon 会话注入——cli.ts mainAgentMcpConfigProvider 并入 sillyhub-file + session-manager per-server env（MCP_SESSION_ID）扩展 + 单测'
author: 'qinyi'
created_at: 2026-08-23 09:37:06
priority: P0
depends_on: ['task-05']
blocks: ['task-10']
requirement_ids: [FR-02]
decision_ids: ['D-002@v1', 'D-005@v1']
allowed_paths:
  - sillyhub-daemon/src/cli.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/tests/cli-session-manager-injection.test.ts
  - sillyhub-daemon/tests/interactive/session-manager-main-agent-mcp.test.ts
goal: >
  claude 主 agent 交互会话 spawn 时与 sillyhub-daemon 并列注入 sillyhub-file（会话侧 upload_file/list_uploaded_files 链路，FR-02 / D-002@v1 / D-005@v1）
implementation:
  - 'cli.ts mainAgentMcpConfigProvider（约 733-767 行）调 task-05 的 buildFileMcpServerConfig 构造 sillyhub-file 条目，与 sillyhub-daemon 并列放进 mergeMcpConfigs 的 platform 位（平台内置名自动入白名单）'
  - 'session-manager.ts _resolveMainAgentMcp（约 1051-1099 行）的 injectMcpSessionId 管道扩展为同时给 sillyhub-file 条目补 env MCP_SESSION_ID（create/restore/reload 三路共用，provider 返回后按 ctx.sessionId 补写；isMainAgentSession 谓词不动）'
  - '扩两个既有测试文件：双 server 注入、双条目 env 均含 MCP_SESSION_ID、mcp_refs 过滤同语义、codex 不注入；改写原「其它 server 不注入 MCP_SESSION_ID」env 卫生断言（session-manager-main-agent-mcp.test.ts）'
acceptance:
  - 'claude 且 stage 空或 orchestrator 的会话：mcpServers 同时含 sillyhub-daemon 与 sillyhub-file'
  - '两条目 env 均含 MCP_SESSION_ID=ctx.sessionId（session-manager 补写，非 provider 闭包内拼接）'
  - 'codex 与 stage=mission_worker 不注入任何 server；mcp_refs 非空且未列 sillyhub-file 时被剔除，空/undefined 不过滤'
  - 'daemon vitest 全绿（既有注入用例零回归）+ typecheck 零 error'
verify:
  - 'cd sillyhub-daemon && pnpm vitest run tests/cli-session-manager-injection.test.ts tests/interactive/session-manager-main-agent-mcp.test.ts'
  - 'cd sillyhub-daemon && pnpm typecheck'
constraints:
  - 'provider=codex 仍不注入（isMainAgentSession 谓词返回 false，本任务不改谓词）'
  - 'mcp_refs 非空 profile 下 sillyhub-file 与 sillyhub-daemon 同语义受过滤（未列名即剔除），不单独豁免（design §9）'
  - '不修 mcp-server.ts/mcp-config.ts（task-05 产物，本任务只消费 buildFileMcpServerConfig 与 FILE_MCP_SERVER_NAME）；与 task-07 无共享文件可同波'
  - '测试一律放 sillyhub-daemon/tests/（vitest include=tests/**/*.test.ts，src/ 下不收集）；injectMcpSessionId 扩展保持浅拷贝语义，不污染 provider 闭包配置'
expects_from:
  task-05:
    - contract: mcp-config 文件 server 工厂
      needs: [buildFileMcpServerConfig, FILE_MCP_SERVER_NAME]
related_tests:
  - sillyhub-daemon/tests/cli-session-manager-injection.test.ts
  - sillyhub-daemon/tests/interactive/session-manager-main-agent-mcp.test.ts
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
