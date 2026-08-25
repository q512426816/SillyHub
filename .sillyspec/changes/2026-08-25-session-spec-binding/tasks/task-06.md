---
id: task-06
title: 'platform_sync agent-logs 双分支绑定接线（hub 补消费 ctx + 聚合落绑定 + 既有测试更新）'
title_zh: 'platform_sync agent-logs 双分支绑定接线（hub 补消费 ctx + 聚合落绑定 + 既有测试更新）'
author: 'qinyi'
created_at: 2026-08-25 22:54:07
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-003@v1, D-004@v1, D-005@v2]
allowed_paths:
  - backend/app/modules/platform_sync/service.py
  - backend/app/modules/platform_sync/tests/test_agent_log_push.py
goal: >
  platform_sync agent-logs 上报双分支接线自动绑定（FR-02 quick 唯一可靠通道 /
  D-003）——hub 命中分支（L715-729）补消费 entry 级 change_key / quick_id ctx
  （现被完全忽略），聚合分支（L730-778）tool_report 会话 find-or-create 后同样
  按 ctx 落 change / quicklog 两类绑定行；default 伪键由 bind_session_to_change
  内部守卫兜底不建 placeholder（D-005@v2），绑定 best-effort 不影响上报主流程。
implementation:
  - 'hub 分支——hub 会话归属校验通过后，归属挂接循环扩为同时消费 ctx——entry.change_key 非空调 bind_session_to_change(workspace_id, change_key, hub_session.id)；entry.quick_id 非空调 bind_session_to_quicklog(workspace_id, quick_id, hub_session.id)；两键并存以 quick_id 为准只落 quicklog 绑定（schema L275 注释 CLI quick 优先互斥，防御并存）'
  - '聚合分支——分组处（coalesce(change_key, quick_id) 为分组键）留存组级原始 change_key 与 quick_id，每组 find-or-create tool_report 会话得到 group_session_id 后按 ctx 落绑定——change_key 组落 change 绑定、quick_id 组落 quicklog 绑定、空 ctx 组（本地活动单桶）不落任何绑定'
  - 'default 伪键不建 placeholder——bind_session_to_change 内部守卫直接返回（task-02 D-005@v2 统一生效，X-004），本层不重复判断；quicklog 条目行不存在也直接绑（无 FK，D-001 到达顺序不保证）'
  - '两分支 bind 均 savepoint best-effort（失败 log.warning 不抛）——绑定写入与归属列同事务（唯一一次 commit 前完成），agent-logs 上报主流程（entries upsert + 归属 + commit + created 广播）不受绑定失败影响'
  - 'test_agent_log_push.py 双分支新断言——test_push_hub_session_hit_links_entries 加 ctx 断言（change_key 落 change_session_links、quick_id 落 quicklog_session_links、并存只落 quicklog）；聚合用例（test_push_entry_level_ctx_groups_two_sessions / test_push_aggregation_idempotent_single_session / test_push_no_ctx_single_bucket_session / test_push_tool_report_session_fields_and_provider_mapping）补 tool_report 会话绑定断言；新增 change_key 为 default 不建 placeholder 用例；降级用例（test_push_hub_session_random_uuid_degrades / test_push_hub_session_cross_workspace_degrades）断言不产生绑定'
acceptance:
  - '带 hub_session_id 且归属校验通过的推送——entry 的 change_key 产生 change_session_links、quick_id 产生 quicklog_session_links，绑定主体为 hub 会话'
  - '无 hub 的推送按 ctx 分组——tool_report 会话（find 命中或新建）同样落对应绑定；空 ctx 单桶会话不落任何绑定'
  - 'change_key 与 quick_id 并存只落 quicklog 绑定（quick 优先）；change_key 为 default 不创建 placeholder 变更行（D-005@v2）'
  - '既有 test_agent_log_push.py 全部用例（401 / 403 / 422、幂等、双 workspace、降级路径）零回归'
verify:
  - cd backend && uv run pytest app/modules/platform_sync/tests/test_agent_log_push.py -q
constraints:
  - '绑定写入必须在本方法唯一一次 commit 之前同事务完成，失败不抛错不 4xx（对齐归属 D-005 best-effort 语义）'
  - 'hub 未命中 / 跨 workspace / 已软删路径维持静默跳过归属现状，不新增任何绑定'
  - '不改 platform_sync schema 与 agent-logs 推送协议（change_key / quick_id / hub_session_id 字段均已存在）；bind 只走 change.binding 公共入口'
  - '不改 list_agent_logs 读路径与 tool_report 会话生命周期语义（status / turn_count 只刷 last_active_at 契约不变）'
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
