---
id: task-06
title: 'daemon 分身受限 MCP server（worker_done 单工具 + env 门控 + session-manager 三路注入分支）'
title_zh: 'daemon 分身受限 MCP server（worker_done 单工具 + env 门控 + session-manager 三路注入分支）'
author: 'qinyi'
created_at: 2026-08-25 20:57:40
priority: P0
depends_on: ['task-03', 'task-07']
blocks: [task-15]
requirement_ids: [FR-03]
decision_ids: [D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/mcp-server.ts
  - sillyhub-daemon/src/mcp-config.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/cli.ts
  - sillyhub-daemon/src/interactive/types.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/tests/interactive/session-manager-worker-restricted-mcp.test.ts
expects_from:
  task-07:
    - contract: worker_done_endpoint
      needs: [端点路径, workspace_id, mission_id, summary, X-Session-Id 会话定位]
goal: >
  为 stage=mission_worker 的分身会话注入仅含 worker_done 单工具的受限 MCP
  server，让分身干完后能显式上报完成信号（design §5.C.1 / D-003@v1）；递归闸
  保持——分身拿不到 dispatch_worker / converge 等派发工具；谓词与注入在
  create / restore / reload 三路共用点生效，主控与普通会话注入零回归。
implementation:
  - mcp-server.ts 增受限工具集——McpToolset 扩 mission_worker 模式（readEnv 认 MCP_TOOLSET=mission_worker），受限模式仅注册 worker_done 单工具，inputSchema 对齐 task-07 契约（workspace_id 与 mission_id 可选、summary 必填），server 名用新导出常量与主控 server 区分
  - env 门控裁剪——mission_worker 模式下现六处全量 registerTool（orchestration 5 工具 + file 2 工具）全部不注册，只走受限注册分支；拼写错误回落 orchestration 的容错不变
  - hub-client.ts 增 workerDone 转发方法——POST 到 task-07 端点，X-Session-Id 携 MCP_SESSION_ID 定位子会话，非 2xx 抛 HubHttpError 走 errorContent 结构化回执
  - mcp-config.ts 增 buildWorkerMcpServerConfig——env 写 MCP_TOOLSET=mission_worker + backend URL + apiKey 优先 token 回落（同 buildDaemonMcpServerConfig 鉴权链），供 cli.ts 分身 provider 组装
  - session-manager.ts 在 _resolveMainAgentMcp 旁增分身分支——ctx.stage 为 mission_worker 时取受限配置表，injectMcpSessionId 覆盖受限 server 名补写 MCP_SESSION_ID；create（约行 1133）/ restore（约行 3005）/ reload（约行 3561）三路经同一改动全部生效
  - cli.ts 谓词与 provider 三态化——isMainAgentSession 对 mission_worker 仍返回 false（主控 5 工具不进分身），新增分身谓词与 provider 组装受限 server 条目；types.ts 补对应可选注入签名（MainAgentMcpContext 既有字段不动）
  - 新增 tests/interactive/session-manager-worker-restricted-mcp.test.ts——分身分支工具列表仅 worker_done、主控与普通会话零回归、restore 路注入保持断言
acceptance:
  - stage=mission_worker 会话注入的受限 server 工具列表只含 worker_done（listTools 断言），不含 dispatch_worker / converge_mission / list_workers 等任何编排工具
  - 主控（claude 且 stage 为空或 orchestrator）注入 5 编排工具 + sillyhub-file 不变；codex 与普通会话仍零注入
  - create / restore / reload 三路对 mission_worker 会话都注入受限 server（daemon 重启恢复后保持）
  - worker_done 工具调用经 hub-client 带 X-Session-Id 打到 task-07 端点，backend 非 2xx 时返回 isError 结构化回执不 crash
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/interactive
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 受限 server 工具集硬编码单工具 worker_done，禁止顺手加入任何派发或查询工具——递归闸下放是 P2 独立决策（design §3 非目标与 §7 风险表），本卡不开闸
  - 注入须 create / restore / reload 三路同时生效，改动收敛在 _resolveMainAgentMcp 共用点，禁止只在 create 路打补丁
  - 主控 5 工具与 sillyhub-file 注入行为零回归（cli-session-manager-injection 与 session-manager-main-agent-mcp 的既有断言更新归 task-15）
  - backend worker_done 端点实现归 task-07，本卡只消费契约——端点路径与 payload 字段以 task-07 落地为准，两边字段名对齐
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
