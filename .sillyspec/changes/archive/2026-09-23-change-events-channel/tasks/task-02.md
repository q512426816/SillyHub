---
id: task-02
title: '后端 schema + service（append_events 去重上限 / list_events 正序增量）'
title_zh: '后端 schema + service（append_events 去重上限 / list_events 正序增量）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-23 04:16:42
priority: P0
depends_on: ['task-01']
blocks: [task-03, task-04, task-05]
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-002, D-003, D-005, D-007]
allowed_paths:
  - backend/app/modules/platform_sync/schema.py
  - backend/app/modules/platform_sync/service.py
target_files:
  - backend/app/modules/platform_sync/schema.py
  - backend/app/modules/platform_sync/service.py
goal: >
  事件收发的 schema 与 service 层：宽松接收批量事件、dedup_key 幂等跳过、5000 上限修剪、
  since 增量正序读取（design 接口定义节）。
implementation:
  - schema.py 新增 ChangeEventPush（每条：kind str 必填 max 64、ts float 必填 ge=1e12、
    stage/detail/rule/severity/id 可选、provisional 可选忽略落库值——model_config extra=ignore，D-007）+
    ChangeEventPushRequest（events list min 1 max 200）+ ChangeEventItem（id/ts ISO/kind/stage/detail/rule/severity/provisional/created_at）+
    ChangeEventPushOk（accepted/deduplicated）+ ChangeEventListResponse（items/total）
  - service.py 新增 append_events(workspace_id, change_name, events)：逐条生成 dedup_key
    （body id 优先否则 ts|kind|stage 空串拼键，D-002）→ select 已存键集合 + **批内同键去重**（同批两条同 dedup_key 只插一条、
    另一条计入 deduplicated——防批内撞唯一约束 500）→ 缺失者 INSERT
    （provisional 恒 True、detail 截 2000）→ 插入后 count>5000 则按 (ts, created_at) 删最旧修剪（D-005 同事务）→ commit，
    返回 (accepted, deduplicated)
  - service.py 新增 list_events(workspace_id=None, allowed_workspace_ids=None, change_name, since=None, limit=500)：
    scope 过滤同 list_agent_logs 口径（shpsync_ 精确 / JWT·shk_live_ 并集）+ ts > since 严格大于
    （since datetime 解析在 router 层）+ order_by ts ASC, id ASC + limit；返回 rows
acceptance:
  - 同 dedup_key 二次推送跳过且 deduplicated 计数正确（FR-02）
  - 超 5000 条触发修剪保留最新 5000（FR-03）
  - since 增量不含边界行、正序稳定（FR-04）
verify:
  - cd backend && uv run ruff check app/modules/platform_sync/ && uv run mypy app
constraints:
  - service 零业务判定：不触发通知/不写 progress/不动审批（D-004 红线）
  - dedup 语义是跳过不是覆盖（区别于 quicklog upsert 先例）
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
