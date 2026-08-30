---
id: task-11
title: 'daemon mission_status 工具——mcp-server.ts 第 6 工具（参数可选+X-Session-Id）+hub-client getMissionStatus'
title_zh: 'daemon mission_status 工具——mcp-server.ts 第 6 工具（参数可选+X-Session-Id）+hub-client getMissionStatus'
author: 'qinyi'
created_at: 2026-08-24 18:49:24
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-005@v1]
allowed_paths:
  - sillyhub-daemon/src/mcp-server.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/tests/mcp-server.test.ts
  - sillyhub-daemon/tests/hub-client.test.ts
goal: >
  daemon 侧注册第 6 个常驻 MCP 工具 mission_status 并新增 hub-client getMissionStatus 方法——主 agent 随时查当前 mission 概要/scope 工作区机器状态/workers，无活跃任务优雅返回 active=false（FR-02/D-005@v1）。
expects_from:
  task-03:
    - contract: MissionStatusResponse
      needs: [missions_status_route, MissionStatusResponse]
implementation:
  - mcp-server.ts 仿既有 5 工具模式（:293-520 registerTool+okContent/errorContent）注册 mission_status——inputSchema 仅 workspace_id/mission_id 且均可选（会话上下文定位，显式传参仅作越权校验锚）
  - 工具描述按能力说明书口径撰写，含「无活跃任务返回 active=false，可先查再派」与 scope/机器状态/workers 概要说明
  - hub-client.ts 新增 getMissionStatus(workspaceId 可选, missionId 可选)——GET 走 _missionActionPath（:425-437）action=status（缺省形态 /api/missions/status），附 X-Session-Id（_sessionIdHeaders，常量 X_SESSION_ID_HEADER 于 :326）
  - 工具 handler 调 client.getMissionStatus 后 okContent 透传 MissionStatusResponse JSON 文本
  - 补 vitest——工具注册与可选参 schema/handler 透传调用/X-Session-Id 附带/错误分支 errorContent
acceptance:
  - mission_status 成为第 6 个注册工具，参数全可选，请求附 X-Session-Id 定位（GET /api/missions/status 形态，与 task-03 契约对齐）
  - 无活跃 mission 时工具正常返回 active=false 而非报错（D-005@v1）
  - 既有 5 工具（dispatch_worker/get_worker_result/list_workers/converge_mission/report_progress）注册与行为逐字节不变
  - pnpm test 与 pnpm typecheck 全绿
verify:
  - cd sillyhub-daemon && pnpm test
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 仅注册工具与 client 方法，不动其它 5 工具与 hub-client 既有方法
  - backend 侧 status 路由与 MissionStatusResponse DTO 归 task-03，本卡只消费契约不实现
  - 瘦客户端惯例——不缓存不重试，失败即抛由 errorContent 包装
  - 工具描述中文，风格对齐 dispatch_worker 能力说明书
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
