---
id: task-08
title: '平台 messages schema 可选新字段 + 端点透传 + openapi.json/gen:types 重生成'
title_zh: '平台 messages schema 可选新字段 + 端点透传 + openapi.json/gen:types 重生成'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-19 21:03:54
priority: P0
depends_on: ['task-01']
blocks: ['task-09']
requirement_ids: [FR-03]
decision_ids: [D-004@v1]
expects_from:
  task-01:
    - contract: NormalizedLogMessage
      needs: [sender, turn_id, model, duration_ms, usage]
    - contract: AgentLogMessagesResult
      needs: [totalUsage]
provides:
  - contract: AgentLogMessagesResponse
    fields: [total_usage, usage, turn_id, model, duration_ms, sender]
allowed_paths:
  - backend/app/modules/platform_sync/schema.py
  - backend/app/modules/platform_sync/router.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: messages 端点 schema 增可选 token/轮次字段并透传（FR-03 平台层），openapi.json 与 api-types.ts 经 pnpm gen:types 重生成，老 daemon 不返回即缺省（D-004@v1 四层链路的 schema/types 两层）。
implementation:
  - backend/app/modules/platform_sync/schema.py:444 AgentLogMessageItem 增可选 sender（Literal human/system_event）/ turn_id / model / duration_ms / usage 子模型五项（input_tokens/output_tokens/total_tokens/cache_read_tokens/cache_write_tokens，daemon camelCase key 经 alias 对齐）；:470 AgentLogMessagesResponse 增可选 total_usage——TotalUsage 四项（input_tokens/output_tokens/cache_read_tokens/cache_write_tokens，无 total_tokens 对齐 daemon totalUsage）
  - backend/app/modules/platform_sync/router.py:893 转换层 model_validate dict 增 total_usage 映射（result.get('totalUsage')，camel→snake 同现状零改写；messages 内层递归校验，老 daemon 不返回即缺省 None）
  - gen:types 前确认前端 node_modules 健康（pnpm exec tsc --version 能跑且 .bin 有 shim，半坏先 pnpm install --force 修复），cd frontend && pnpm gen:types 重生成 backend/openapi.json 与 frontend/src/lib/api-types.ts 并一并提交
acceptance:
  - backend/openapi.json 与 frontend/src/lib/api-types.ts 含全部新可选字段（内层 sender/turn_id/model/duration_ms/usage + 外层 total_usage），无手写类型
  - 老 daemon 响应（缺新字段）model_validate 通过全缺省；status 四值 200 透传与 422/409/404 语义不变
verify:
  - cd backend && uv run pytest -q -k "agent_log or platform_sync" 且 cd frontend && pnpm gen:types 成功（产物 diff 仅新增可选字段）
constraints:
  - 零表结构变更（messages 读即弃不落库维持）；端点零解析零改写（仅 key 映射）；api-types.ts 只从 OpenAPI 生成禁手写
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
