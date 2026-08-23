---
id: task-04
title: append-sillyhub-file-server-to-worker-tool-whitelist
title_zh: 'backend execution.py worker_tool_config 白名单模式追加 mcp__sillyhub-file + 测试'
author: 'qinyi'
created_at: 2026-08-23 09:37:06
priority: P0
depends_on: []
blocks: [task-07]
requirement_ids: [FR-02]
decision_ids: [D-008@v1]
allowed_paths:
  - backend/app/modules/agent/execution.py
  - backend/app/modules/agent/tests/test_worker_tool_config.py
provides:
  - contract: worker_tool_config 白名单
    fields: [mcp__sillyhub-file 整服务器名白名单追加]
goal: >
  防止批任务 worker 的显式 allowed_tools 白名单物理禁掉上传工具（design §10 R-02）——
  worker_tool_config 的 read_only/write 两分支白名单各追加整服务器名 mcp__sillyhub-file，
  使 worker（claude 引擎）注入后可调用 upload_file/list_uploaded_files（FR-02）；
  无白名单（bypassPermissions）模式不动。
implementation:
  - execution.py worker_tool_config（约 91-110 行）read_only 分支 allowed_tools 追加整服务器名，变为 Read、Glob、Grep、mcp__sillyhub-file 四项
  - write 分支同样追加，变为 Read、Glob、Grep、Edit、Write、Bash、mcp__sillyhub-file 七项
  - 用整服务器名而非通配写法 mcp__sillyhub-file 加 __ 加星号（claude CLI 通配行为未验证，design §6 与 R-02 明确不用）；两分支 mode/max_turns 保持不变
  - 新建 test_worker_tool_config.py——断言两分支 allowed_tools 均含 mcp__sillyhub-file、read_only 分支仍不含 Edit/Write/Bash、mode 与 max_turns 等其余键值不变
acceptance:
  - worker_tool_config(True) 与 worker_tool_config(False) 返回的 allowed_tools 都包含整服务器名 mcp__sillyhub-file
  - read_only 分支不含 Edit/Write/Bash（既有只读治理不回归）；两分支 mode/max_turns 不变
  - 新增测试与 agent 模块既有测试全绿
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_worker_tool_config.py -q
  - cd backend && uv run pytest app/modules/agent -q
constraints:
  - 仅改 worker_tool_config 两分支白名单，不动 bypassPermissions（无白名单）路径与 dispatch/lease 链路其它环节
  - 不改函数签名与返回结构（消费方 placement/daemon 零感知）
  - daemon 侧 worker 注入（.mcp.json 写入）属 task-07，本任务只保证白名单放行
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
