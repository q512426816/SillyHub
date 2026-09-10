---
id: task-06
title: 'claim 透传链——user_id 下发与消费'
title_zh: 'claim 透传链——user_id 下发与消费'
author: 'qinyi'
created_at: 2026-09-10 11:18:41
priority: P0
depends_on: ['task-05']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-008@v2]
allowed_paths:
  - backend/app/modules/daemon/lease/context.py
  - backend/app/modules/daemon/tests/test_build_claim_payload.py
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/mcp-config.ts
  - sillyhub-daemon/tests/mcp-config.test.ts
  - sillyhub-daemon/tests/daemon-mcp-user-id-wiring.test.ts
target_files:
  - backend/app/modules/daemon/lease/context.py
  - backend/app/modules/daemon/tests/test_build_claim_payload.py
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/mcp-config.ts
  - sillyhub-daemon/tests/mcp-config.test.ts
  - NEW:sillyhub-daemon/tests/daemon-mcp-user-id-wiring.test.ts
goal: >
  把 lease 归属用户的 user_id 从 backend claim payload 透传到 daemon MCP 拉取 URL——build_claim_payload 下发（lease.runtime_id → DaemonRuntime.user_id 链）、daemon execPayload 归一化、会话创建预取带参、fetchMcpBundle URL 拼参，会话级缓存 _mcpBundleBySession 结构不动（D-008@v2）。
implementation:
  - context.py build_claim_payload（:420-482）payload 双写 user_id 与 userId（snake_case + camelCase 对齐既有惯例）；user 解析照 _inject_provider_config 先例（:229-234）主路径 lease.runtime_id → DaemonRuntime.user_id，runtime 缺失 interactive 兜底 session，None 不下发键
  - daemon.ts execPayload 归一化（:8522-8640）加 userId 读取（rawExec.user_id 优先 rawExec.userId 兜底再 payload 防御，对齐 worker_depth 惯例），undefined 全链穿透不伪造默认值
  - daemon.ts 会话创建预取（:8144-8165）fetchMcpBundle 调用追加传 userId；_mcpBundleBySession 缓存结构（:1698）不动
  - mcp-config.ts fetchMcpBundle（:186）签名加可选 userId 参数，URL 组装（:193-196）有值时附加 user_id 查询参数（与 workspace_id 共存时两参齐拼）；缓存/合并/预净化/回落逻辑不动
  - backend 扩展 test_build_claim_payload.py 断言 payload 双写 user_id 与 None 短路；daemon 侧 mcp-config.test.ts 加 URL 组装用例（带/不带 userId 与 workspace_id 组合），新建 daemon-mcp-user-id-wiring.test.ts 覆盖 execPayload → 预取透传
acceptance:
  - build_claim_payload 输出含 user_id 与 userId 双键，runtime 缺失时两键均不下发
  - fetchMcpBundle URL 在 workspace_id 与 user_id 同时有值时两参数齐带，仅一项时单参，均无时不带参
  - 旧 lease（无 user_id）daemon 全链行为与现状一致（零回归）
  - daemon pnpm test 与 typecheck 全绿，backend pytest 全绿
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_build_claim_payload.py -q
  - cd sillyhub-daemon && pnpm test -- mcp-config
  - cd sillyhub-daemon && pnpm test -- daemon-mcp-user-id-wiring
  - cd sillyhub-daemon && pnpm run typecheck
constraints:
  - 会话级缓存 _mcpBundleBySession 键值结构不动（D-008@v2 Grill CC-01，会话天然归属 user）
  - 双向兼容——claim payload 新字段被旧 daemon 忽略，新 daemon 对无 user_id 的 backend 响应零感知
  - fetchMcpBundle 回落链与预净化逻辑不动（mcp-config.ts:246-253 fallback 保持可达）
  - LeaseCtx 类型扩展以交叉类型承载（对齐 worker_depth 先例），src/types.ts 不进本卡
expects_from:
  task-05:
    - contract: daemon mcp config 端点
      needs: [user_id_query_param]
provides:
  - contract: claim user_id 透传链
    fields: [claim_user_id, fetch_user_id]
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
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
