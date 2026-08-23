---
id: task-05
title: add-daemon-file-mcp-toolset
title_zh: daemon 增加文件 MCP 双模式与上传工具
author: qinyi
created_at: 2026-08-23 09:37:06
priority: P0
depends_on: [task-03]
blocks: [task-06, task-07]
requirement_ids: [FR-03, FR-07]
decision_ids: [D-005@v1, D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/mcp-server.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/mcp-config.ts
  - sillyhub-daemon/tests/mcp-server-file.test.ts
provides:
  - contract: mcp-config 文件 server 工厂
    fields: [buildFileMcpServerConfig, FILE_MCP_SERVER_NAME, sillyhub-file]
expects_from:
  task-03:
    - contract: agent-file-artifacts-endpoints
      needs: [file_id, original_name, size, mime_type, description, created_at]
goal: >
  mcp-server.ts 增加 MCP_TOOLSET 双模式（缺省 orchestration 零变化），file 模式注册 upload_file/list_uploaded_files 两工具（MCP_ALLOWED_ROOT resolve+前缀校验），hub-client 增 multipart 直传方法，mcp-config 增 buildFileMcpServerConfig 构造 sillyhub-file server 条目，供 task-06 会话注入与 task-07 worker 注入消费。
implementation:
  - mcp-server.ts——新 env MCP_TOOLSET（缺省 'orchestration'，现 5 工具注册与行为零变化）、MCP_RUN_ID、MCP_ALLOWED_ROOT；导出 FILE_MCP_SERVER_NAME='sillyhub-file'；file 模式仅注册 upload_file/list_uploaded_files（D-003 口径），复用 createMcpServer mock 注入式测试形态；upload_file（input path 相对工作目录 + description 可选）做 MCP_ALLOWED_ROOT 缺失拒绝一切上传（path_out_of_root 错误）与 path.resolve(allowedRoot, path) 结果须以 allowedRoot+平台分隔符 为前缀的校验（绝对路径与含 .. 逃逸即拒绝），本地读文件后经 hub-client 直传，错误回执沿用 errorContent 结构化模式（isError+JSON）
  - hub-client.ts——uploadFileArtifact 用 FormData 装 file+description+run_id（会话场景附 X_SESSION_ID_HEADER），鉴权头照 _headers 口径但 multipart 请求不设手工 Content-Type（由 fetch 自动生成 boundary）；listFileArtifacts 按 session_id/run_id 查询参数 GET
  - mcp-config.ts——buildFileMcpServerConfig(backendUrl, auth, {sessionId 可选、runId 可选、allowedRoot}) 构造 sillyhub-file server 条目（command=node、args 指向 dist/mcp-server.js 编译产物、env 含 MCP_TOOLSET=file 与 MCP_SESSION_ID/MCP_RUN_ID/MCP_ALLOWED_ROOT 上下文）；FILE_MCP_SERVER_NAME 进 mergeMcpConfigs 平台内置名白名单（同 DAEMON_MCP_SERVER_NAME 惯例）
  - 测试 tests/mcp-server-file.test.ts——file toolset 仅注册 2 工具断言、orchestration 缺省 5 工具零回归、路径逃逸（绝对路径/../出根/allowedRoot 缺失）拒绝、multipart 转发（mock hub-client 断言 FormData 字段与 X-Session-Id）、list 工具输出含 task-03 契约字段
acceptance:
  - MCP_TOOLSET 未设或为 orchestration 时 listTools 与现状 5 工具完全一致（零回归断言）；toolset=file 时仅注册 upload_file/list_uploaded_files，upload 输出含 file_id/original_name/size/mime_type/description，list 输出 files 数组另含 created_at（task-03 契约字段）
  - 路径逃逸用例（绝对路径、.. 出根、MCP_ALLOWED_ROOT 缺失）全部返回 isError 结构化错误；新测试与既有 mcp-server.test.ts / mcp-config.test.ts 全绿，tsc 零 error
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/mcp-server-file.test.ts tests/mcp-server.test.ts tests/mcp-config.test.ts
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - MCP_TOOLSET 缺省 orchestration——现有 sillyhub-daemon server 5 工具行为零变化
  - MCP_ALLOWED_ROOT 缺失拒绝一切上传（fail-closed，不降级放行）
  - FormData 请求不设手工 Content-Type——_headers 的 application/json 不能随 multipart body 发（会破坏 boundary）
  - daemon 测试一律放 sillyhub-daemon/tests/ 下（vitest include=tests/**/*.test.ts，src/ 不收集）；不动 cli.ts / session-manager.ts / task-runner.ts 注入链（归 task-06/07）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
