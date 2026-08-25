---
id: task-05
title: 'daemon 分层工具集——mcp-server.ts 非叶 5 件/叶 1 件两档硬编码 + mcp-config/cli.ts 谓词分层 + 旧 lease 无键叶档兜底'
title_zh: 'daemon 分层工具集——mcp-server.ts 非叶 5 件/叶 1 件两档硬编码 + mcp-config/cli.ts 谓词分层 + 旧 lease 无键叶档兜底'
author: 'qinyi'
created_at: 2026-08-26 03:10:00
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/mcp-server.ts
  - sillyhub-daemon/src/mcp-config.ts
  - sillyhub-daemon/src/cli.ts
  - sillyhub-daemon/tests/interactive/worker-tiered-toolset.test.ts
expects_from:
  task-04:
    - contract: worker_depth_chain
      needs: [MainAgentMcpContext.worker_depth]
goal: >
  daemon 受限 server 按 worker_depth 两档硬编码分层（FR-04/D-002@v1）——
  非叶分身（depth<MAX_DISPATCH_DEPTH）恰 5 件派工集，叶（depth 达上限或
  无键）恰 1 件 worker_done，converge_mission/report_progress 永不注册
  （层 0 权不下放）；吃 task-04 的 MainAgentMcpContext.worker_depth。
implementation:
  - 'mcp-config.ts——导出 daemon 侧 MAX_DISPATCH_DEPTH=2 常量单源（与 backend 同值，注释互引防漂移）；buildWorkerMcpServerConfig 增可选 workerDepth 参 → env 注 MCP_WORKER_DEPTH（undefined 不写键=叶档）'
  - 'mcp-server.ts——mission_worker toolset 分两档：readEnv 增读 MCP_WORKER_DEPTH；depth<MAX_DISPATCH_DEPTH（非叶）注册 dispatch_worker/list_workers/get_worker_result/mission_status/worker_done 五件（从 orchestration 既有注册抽共享 helper 复用，禁复制粘贴漂移）；depth≥MAX 或无键（叶/旧 lease）维持 registerWorkerTools 仅 worker_done（P1 现状不动）；converge_mission/report_progress 任何档位不注册'
  - 'cli.ts——workerMcpConfigProvider 读 ctx.worker_depth 传 buildWorkerMcpServerConfig（:861-880 现状闭包）；isWorkerSession/isMainAgentSession 谓词判据不变（stage=mission_worker / claude，三态化结构不动）'
  - 'hub-client 转发路径零改动——分身调 dispatch_worker 与主控同端点同链路，backend 靠调用方解析区分（design §5.C）'
  - '新测试 tests/interactive/worker-tiered-toolset.test.ts——非叶（depth=1）listTools 恰 5 件且不含 converge_mission/report_progress；叶（depth=2）恰 1 件 worker_done；无 depth 键叶档兜底；带 worker_depth 的 snapshot restore 后注入档位保持'
acceptance:
  - '非叶分身工具列表恰 5 件（dispatch_worker/list_workers/get_worker_result/mission_status/worker_done）；叶恰 1 件（worker_done）；两档都无 converge_mission/report_progress（FR-04 验收口径）'
  - '旧 lease 无 worker_depth 键 → 叶档兜底（宁少勿多）；重启 restore 后非叶档位保持不降级（D-003@v2）'
  - '无 depth 的存量分身（P1 形态）行为逐字节不变——mcp-server-worker-done.test.ts 等既有测试零改动通过'
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
  - cd sillyhub-daemon && pnpm vitest run tests/interactive
  - cd sillyhub-daemon && pnpm vitest run tests/mcp-server.test.ts tests/mcp-config.test.ts tests/cli-session-manager-injection.test.ts
constraints:
  - '两档硬编码（非叶恰 5 件/叶恰 1 件）——不按 profile 可配置（mcpRefs 豁免维持，D-003@v2 重申：工具集是 depth 决定的固定治理面，非 profile 能力）'
  - 'converge_mission/report_progress 永不注册（层 0 权，D-002@v1）'
  - '五件复用 orchestration 既有注册实现（抽 helper 共享），禁第二份拷贝；env 门控沿用 P1 机制（MCP_TOOLSET 之上加 MCP_WORKER_DEPTH，不引入新配置面）'
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
