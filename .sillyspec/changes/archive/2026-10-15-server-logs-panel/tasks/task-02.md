---
id: task-02
title: 'Add server log read and download endpoints'
title_zh: '后端日志端点——log_reader 读取解析+两端点（tail 展示/白名单下载）+ 端点测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 16:20:11
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-003@v1, D-004@v1, D-008@v1]
allowed_paths:
  - backend/app/modules/health/log_reader.py
  - backend/app/modules/health/router.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - backend/tests/test_server_logs_api.py
target_files:
  - NEW:backend/app/modules/health/log_reader.py
  - backend/app/modules/health/router.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/src/api-types.ts
  - backend/app/modules/agent/provider_caps.py
  - frontend/src/lib/provider-caps.ts
  - NEW:backend/tests/test_server_logs_api.py
provides:
  - contract: ServerLogsResponse
    fields: [entries, total_lines, returned, file, available_files, hint]
expects_from:
  task-01:
    - contract: LogFileConfig
      needs: [get_log_file_path, LOG_FILE_NAME, LOG_MAX_BYTES, LOG_BACKUP_COUNT]
goal: >
  提供日志只读面：GET /api/server-logs 返回结构化尾部日志+文件清单（前端下拉数据源），
  GET /api/server-logs/download 白名单文件下载；均挂 system_status:read。
implementation:
  - NEW backend/app/modules/health/log_reader.py：LOG_FILE_WHITELIST=("backend.log","backend.log.1","backend.log.2","backend.log.3")；read_log_tail(path, n)（文件缺失返回空态；按块流式读入 splitlines 得 total_lines，取尾 n 行；单文件 5MB 封顶）；parse_log_lines(raw_lines)（json.loads 成功→条目含 time/level/event/fields 四键，fields 收剩余键；失败→条目含 raw 与 parse_error 标志）；list_log_files(dir)（白名单中存在文件→[{name,size,mtime}]）
  - backend/app/modules/health/router.py 增两端点（写法对齐 system-status 先例 router.py:84-94）：GET /api/server-logs（query lines ∈ {100,200,500,1000} 非白名单回退 200；文件路径经 get_log_file_path()；响应 {entries, total_lines, returned, file, available_files, hint}——空态 file=null+hint 中文文案）；GET /api/server-logs/download（file 非白名单→400 中文；不存在→404 中文；命中→FileResponse(path, media_type="text/plain", filename=file)）；两端点均 require_permission_any(Permission.SYSTEM_STATUS_READ)
  - backend/tests/test_server_logs_api.py：tail 正确性（多行/空文件/文件不存在空态）；JSON/非 JSON 混合降级（parse_error 项保留 raw）；lines 白名单回退（如 lines=999→200 行）；下载白名单防遍历（file=../etc/passwd、backend.log.x、绝对路径→400）；三态鉴权（401/403/200，复用 test_health.py 的 _make_user 模式）
  - 契约同步（规则 21，task 收尾）：dump openapi.json + cd frontend && pnpm gen:types（ServerLogsResponse 等入 api-types.ts；gen 前确认 node_modules 健康）
acceptance:
  - uv run pytest tests/test_server_logs_api.py -q --no-cov 全绿
  - lines=999 回退 200 行；entries JSON 行解析字段齐全、非 JSON 行保 raw+parse_error
  - download 白名单外值 400、不存在 404、命中返回 attachment 头与内容
  - 三态鉴权 401/403/200（platform:admin 直通）
  - openapi.json 与 api-types.ts 随本任务同提交再生成（ServerLogsResponse 入生成物，规则 21；gen:types 后 tsc --noEmit 零错）
verify:
  - cd backend && uv run pytest tests/test_server_logs_api.py tests/test_health.py -q --no-cov
  - cd frontend && pnpm gen:types && pnpm exec tsc --noEmit
constraints:
  - 复用 system_status:read 权限（不新增枚举，D-004@v1）
  - 文件读取路径必须经 logging.get_log_file_path() 单一源（禁止路由内自行拼路径）
  - 文件名白名单硬校验（防目录遍历，任何拼接用户输入的路径形态禁止）
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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
