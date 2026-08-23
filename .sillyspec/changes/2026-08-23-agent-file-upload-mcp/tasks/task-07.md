---
id: task-07
title: 'inject sillyhub-file mcp into worker spawn via tmp mcp-json'
title_zh: 'daemon worker 注入——task-runner tmpdir 0600 临时 .mcp.json + stream-json buildArgs mcpConfigPath（仅 claude）+ spike-01（--mcp-config 共存 + ${VAR} 展开）+ 单测'
author: 'qinyi'
created_at: 2026-08-23 09:37:06
priority: P0
depends_on: ['task-04', 'task-05']
blocks: ['task-10']
requirement_ids: [FR-02, FR-07]
decision_ids: ['D-009@v2', 'D-008@v1']
allowed_paths:
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/src/adapters/stream-json.ts
  - sillyhub-daemon/tests/task-runner-file-mcp.test.ts
  - sillyhub-daemon/tests/stream-json.test.ts
goal: >
  claude 引擎 worker spawn 时经 os.tmpdir() 0600 临时 .mcp.json 注入 sillyhub-file（worker 侧上传链路），并以 spike-01 验证 --mcp-config 参数共存与 env 变量展开（FR-02/FR-07、D-009@v2/D-008@v1）
implementation:
  - 'spike-01（开工前执行）：验证 claude CLI 批任务形态下 --mcp-config tmpfile 与现有参数（--allowedTools/--permission-mode/-p/--settings 等）共存，及 .mcp.json per-server env 的 ${VAR} 展开是否可用；结论与验证脚本记录进本卡 execute 笔记，不通过则回退 ~/.claude.json 项目级配置并回 design 补 v3'
  - 'task-runner.ts spawn 前（仅 provider=claude 租约）：buildFileMcpServerConfig（runId、allowedRoot=worktree 根、daemon 凭证）→ 写 os.tmpdir() 下 0600 临时 .mcp.json（文件名含 runId 可辨识前缀），路径经 buildArgs({mcpConfigPath}) 传入；run 终 finally 删除；TaskRunner 构造时 fire-and-forget 清扫 tmpdir 同前缀残留（不动 cli.ts，与 task-06 无共享文件）'
  - 'stream-json.ts buildArgs opts 增 mcpConfigPath?: string——claude 分支非空追加 --mcp-config <path>，cursor 分支忽略（D-008@v1）'
  - '新建 tests/task-runner-file-mcp.test.ts（.mcp.json 内容与 env、仅 claude、0600 权限、run 终删、启动清扫）+ 扩 tests/stream-json.test.ts buildArgs 用例（现有 adapter buildArgs 测试在此文件，非 tests/adapters/）'
acceptance:
  - 'claude worker：tmpfile 位于 os.tmpdir() 且权限 0600、内容含 sillyhub-file（per-server env 含凭证/MCP_RUN_ID/MCP_ALLOWED_ROOT）、不写 workDir'
  - 'run 终态（成功/失败/取消）finally 删除；daemon 启动清扫同前缀残留；三件套均有单测'
  - 'buildArgs：claude 非空追加 --mcp-config、缺省不追加（零回归）、cursor 分支忽略 mcpConfigPath'
  - '三平台兼容（win32/macOS/linux 路径分隔符）；vitest 全绿 + typecheck 零 error；spike-01 结论已记录本卡'
verify:
  - 'cd sillyhub-daemon && pnpm vitest run tests/task-runner-file-mcp.test.ts tests/stream-json.test.ts'
  - 'cd sillyhub-daemon && pnpm typecheck'
constraints:
  - '临时文件在 os.tmpdir() 且权限 0600、run 终删除、daemon 启动清扫残留；不写 workDir（rootPath 模式 workDir=宿主真实仓库，防污染 git status）'
  - '凭证经 per-server env 写入该 0600 tmpfile（spike-01 已证父进程 spawnEnv 自定义变量不透传 MCP 子进程，per-server env 是唯一可靠通道，D-009@v2；${VAR} 展开可用则升级为文件只存变量引用的加固形态）'
  - 'cursor 分支忽略 mcpConfigPath（D-008@v1）；codex worker 不注入；仅 claude 分支追加参数'
  - '三平台兼容（win32 路径分隔符、tmpdir、Windows 无 0600 对应位时 chmod 不失败，单测按平台断言权限）'
  - 'spike-01 验证 --mcp-config 与现有参数共存 + ${VAR} 展开，结论记录进本卡；不通过则回退 ~/.claude.json 项目级配置并回 design 补 R-03 备选（v3），不带病实现'
expects_from:
  task-04:
    - contract: worker_tool_config 白名单
      needs: [mcp__sillyhub-file 整服务器名白名单追加]
  task-05:
    - contract: mcp-config 文件 server 工厂
      needs: [buildFileMcpServerConfig, FILE_MCP_SERVER_NAME]
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
