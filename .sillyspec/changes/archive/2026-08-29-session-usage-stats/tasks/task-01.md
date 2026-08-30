---
id: task-01
title: 'backend session usage DTO + aggregation service'
title_zh: 'backend 会话用量 DTO 与聚合服务（schema.py + session/service.py 两段聚合）'
author: 'qinyi'
created_at: 2026-08-29 21:47:06
priority: P0
depends_on: []
blocks: [task-02, task-05]
requirement_ids: [FR-01]
decision_ids: [D-002@v1, D-004@v1]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/session/service.py
provides: 'SessionUsageRead / SessionUsageModelItemRead DTO（schema.py）+ SessionService.get_session_usage(session_id, user_id) -> SessionUsageRead'
goal: >
  定义会话用量 DTO 并实现 SQL 侧两段聚合（agent_run_model_usage 明细 GROUP BY model 为主 + 无明细行 run 的 AgentRun 四维列兜底），供 task-02 端点直接调用。
implementation:
  - schema.py 新增 SessionUsageModelItemRead（model/input_tokens/output_tokens/cache_read_tokens/cache_creation_tokens/api_requests，对齐 RuntimeUsageRead 先例注释风格）与 SessionUsageRead（totals + by_model）
  - session/service.py 新增 get_session_usage(session_id, user_id)：归属校验复用既有 _get_owned_session_for_update / get_agent_session 404 口径
  - 明细段：JOIN agent_run_model_usage GROUP BY mu.model SUM 五指标；兜底段：会话内无任何明细行的 run，SUM 四维 token 列（显式排除 ctx_tokens 快照列），model 取 COALESCE(run.model, '未记录')，api_requests=0
  - by_model 按 input+output 降序、'未记录' 桶恒末位；totals=两段之和；全 SQL 聚合不拉 run 行进内存
acceptance:
  - SessionUsageRead 序列化形状与 design.md 接口定义逐字段一致
  - 聚合含纯明细/纯兜底/混合三种形态的正确语义（由 task-02 端点级测试覆盖，本卡不写测试）
verify:
  - cd backend && uv run ruff check app/modules/daemon/schema.py app/modules/daemon/session/service.py && uv run mypy app
constraints:
  - 不改 router.py（端点归 task-02）；不写测试（归 task-02）
  - SUM 仅四维 token 列，ctx_tokens 是提示词大小快照列严禁求和（Grill P1 结论）
  - 不新增迁移/不改 ORM 模型
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
