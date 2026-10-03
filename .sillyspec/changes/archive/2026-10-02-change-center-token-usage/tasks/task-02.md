---
id: task-02
title: '摄取链路——usage_ingest.py 服务 + router 挂载 fire_background_task + test_usage_ingest.py 单测（候选/节流/幂等/降级）'
title_zh: '摄取链路——usage_ingest.py 服务 + router 挂载 fire_background_task + test_usage_ingest.py 单测（候选/节流/幂等/降级）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-02 23:14:36
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01, FR-04]
decision_ids: [D-002@v1]
allowed_paths:
  - backend/app/modules/platform_sync/usage_ingest.py
  - backend/app/modules/platform_sync/router.py
  - backend/app/modules/platform_sync/schema.py
  - backend/app/modules/platform_sync/tests/test_usage_ingest.py
target_files:
  - NEW:backend/app/modules/platform_sync/usage_ingest.py
  - backend/app/modules/platform_sync/router.py
  - backend/app/modules/platform_sync/schema.py
  - NEW:backend/app/modules/platform_sync/tests/test_usage_ingest.py
provides:
  - contract: AgentLogUsageIngestService
    fields: [ingest_for_push]
expects_from:
  task-01:
    - contract: platform_agent_logs 快照五列
      needs: [usage_input_tokens, usage_output_tokens, usage_cache_read_tokens, usage_cache_write_tokens, usage_parsed_at]
goal: >
  实现 agent-logs 上报后的异步用量摄取（方案 A，D-002@v1）：daemon 解析日志 totalUsage 四项
  覆盖写快照，best-effort 全降级不抛，上报响应语义不变。
implementation:
  - 新建 backend/app/modules/platform_sync/usage_ingest.py：AgentLogUsageIngestService.ingest_for_push(workspace_id, entries)——候选筛选（exists=true 且库中 agent_session_id 非空 且 format ∈ {'zcode-model-io-jsonl','claude-code-jsonl'}）；节流（entry 的 size_bytes+mtime_ms 与库中一致 且 usage_parsed_at 距今 <300s 跳过）；asyncio.Semaphore(3) 并发逐 entry 定位 daemon（复用 router.py:671-751 _resolve_agent_log_read_target，scope 按 Grill B-1 裁定自构造 workspace 精确匹配对象；AppError/404/409 捕获降级）→ send_host_fs_rpc(host_fs.read_agent_log_messages)（默认 30s 超时）→ status=parsed 且 totalUsage 非 null 时 UPDATE 覆盖写五列（cacheWriteTokens→usage_cache_write_tokens 映射）；其余状态/离线/超时/RemoteError（含旧 daemon method_not_found）log.info 跳过
  - backend/app/modules/platform_sync/router.py push_agent_logs（:533-569）：service upsert（内含 :2119 commit）返回后 fire_background_task 摄取（backend/app/modules/daemon/_background_tasks.py:44-108 先例；任务体内 get_session_factory() 自开短 session，先例 backend/app/modules/agent/worker_redispatch.py:394-419）；上报响应 DTO 与时延不变
  - 新建 backend/app/modules/platform_sync/tests/test_usage_ingest.py：monkeypatch RPC 层——候选筛选（unsupported format/无会话关联/exists=false 跳过）、节流（size+mtime 未变+300s 内跳过；日志增长不跳过）、覆盖写幂等（两次摄取结果一致）、totalUsage null 不落、daemon 离线/DaemonRpcTimeout/method_not_found 静默跳过且上报响应 200、快照列映射正确；后台任务在测试环境的行为打桩确认（fire_background_task 派生协程不干扰既有 push 测试断言，必要时 monkeypatch 摄取入口）
acceptance:
  - 摄取成功后 platform_agent_logs 五列非空且 usage_parsed_at 刷新；重复摄取覆盖写幂等
  - 全部失败路径（离线/超时/unsupported/too_large/parse_error/null）不抛不重试仅记日志，POST /api/agent-logs 响应不受影响
  - 并发不超 Semaphore(3)；节流命中时不发 RPC
  - 既有 backend/app/modules/platform_sync/tests/test_agent_log_push.py 全部用例不回归（Plan Review X-9：摄取 fire 点在响应后、自开 session，不碰 upsert 断言与 execute 计数——verify 显式跑该文件锚定）
verify:
  - cd backend && uv run pytest app/modules/platform_sync/tests/test_usage_ingest.py app/modules/platform_sync/tests/test_agent_log_push.py -q --no-cov
  - cd backend && uv run ruff check app/modules/platform_sync/usage_ingest.py app/modules/platform_sync/router.py && uv run mypy app
constraints:
  - 不改 upsert_agent_log_entries 事务结构（fire 点在 commit 之后）；不引入队列/定时器/重试
  - daemon 零改动（只复用既有 RPC method）；不改聚合（归 task-03）
  - 既有 test_agent_log_push.py 断言若因 router 挂载点失效（如调用计数断言）在本卡内修复
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
