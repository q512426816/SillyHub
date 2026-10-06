---
id: task-07
title: '后端测试五域（llm_provider 多选/组合/互斥扩张 + 解析集合命中/盖引擎 + provider_switch 扇出含单引擎回归 + capability 门控含群聊 shadow 间接路径用例 + 迁移测试含索引在位断言）'
title_zh: '后端测试五域（llm_provider 多选/组合/互斥扩张 + 解析集合命中/盖引擎 + provider_switch 扇出含单引擎回归 + capability 门控含群聊 shadow 间接路径用例 + 迁移测试含索引在位断言）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-06 14:31:42
priority: P0
depends_on: ['task-03', 'task-04', 'task-05']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-002, D-003, D-004, D-005, D-006]
allowed_paths:
  - backend/app/modules/llm_provider/tests/
  - backend/app/modules/daemon/tests/
  - backend/tests/modules/daemon/lease/
  - backend/app/modules/session_attachment/tests/
target_files:
  - NEW:backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py
  - NEW:backend/app/modules/llm_provider/tests/test_agent_kinds_migration.py
  - backend/app/modules/llm_provider/tests/test_llm_provider.py
  - backend/app/modules/llm_provider/tests/test_api_format.py
  - backend/app/modules/daemon/tests/test_resolve_default_provider_config.py
  - backend/app/modules/daemon/tests/test_resolve_bound_provider_config.py
  - backend/app/modules/daemon/tests/test_provider_switch.py
  - backend/app/modules/daemon/tests/test_provider_switch_integration.py
  - backend/tests/modules/daemon/lease/test_provider_config_payload.py
goal: >
  为 agent_kind 到 agent_kinds 多选改造补齐后端测试五域——llm_provider 域（多选/组合禁配/互斥扩张）、解析域（集合命中 + 盖会话引擎 + claim 契约）、扇出域（多引擎各推对应 config + 单引擎回归）、capability 门控域（含群聊 shadow 间接路径）、迁移域（双方言 + 存量转数组 + 索引在位），锁定 FR-01~05 与 R-01/R-06/R-07 风险应对。
implementation:
  - 域一 llm_provider——NEW:backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py：多选创建（多元素去重落库 + Read 回数组）、组合禁配（api_format=openai_chat 且 pi 在 agent_kinds 内返回 422 KindFormatForbidden，pi 不在集合时放行）、默认互斥扩张（多引擎默认行清集合内各引擎兄弟默认；扩张新增引擎同样清新增引擎兄弟，D-006）、收缩（引擎移出后该引擎默认空缺不自动转移，D-003）；既有 backend/app/modules/llm_provider/tests/test_llm_provider.py 与 test_api_format.py 的旧 agent_kind 断言迁移为 agent_kinds 口径并补上述场景（沿用其 mock notify/probe 范式）。
  - 域二 解析——backend/app/modules/daemon/tests/test_resolve_default_provider_config.py 与 test_resolve_bound_provider_config.py：集合命中（多选行按集合内引擎命中、集合外引擎返回 None、owner 隔离保留）+ 盖会话引擎断言（返回 dict 的 agent_kind 等于请求引擎而非行内首引擎）；backend/tests/modules/daemon/lease/test_provider_config_payload.py 补 claim 契约断言（provider_config.agent_kind 恒为会话引擎，含 claude_code 到 claude 归一化链路）。
  - 域三 扇出——backend/app/modules/daemon/tests/test_provider_switch.py：多引擎默认行对不同引擎会话各推对应 config（各自 agent_kind 断言）、单引擎回归等价（R-07）、停止场景推 None、session.provider 为 NULL 跳过并告警；修正既有 test_offline_daemon_does_not_block_others（迷你 config 无 agent_kind 且无 LlmProvider 行，新语义下不命中——夹具补 agent_kind 或造默认行）；backend/app/modules/daemon/tests/test_provider_switch_integration.py 补真实 resolve 到 notify 的多引擎链路用例；backend/app/modules/daemon/tests/test_control_command_dispatch.py:775-869 两用例的 provider_config 夹具同步补 agent_kind。
  - 域四 capability 门控——backend/app/modules/session_attachment/tests/test_capability.py 补 DB 级用例：默认查询（backend/app/modules/session_attachment/capability.py:113，task-04 集合化后）按会话引擎命中多选行、集合外引擎不命中；群聊 shadow 间接路径（backend/app/modules/daemon/group/service/shadow.py:796 到 attachment_pipeline 再到 capability，R-06）至少一条门控用例（直接断 capability 查询函数或经 pipeline 入口）；DB 夹具范式镜像 test_resolve_default_provider_config.py（SQLite in-memory + LlmProviderService.create 真实加密落盘）。
  - 域五 迁移——NEW:backend/app/modules/llm_provider/tests/test_agent_kinds_migration.py：双方言（SQLite 走真实 upgrade 链路 + PG 分支 SQL 编译/守卫断言，参考 20260825150000 PG 方言守卫先例，R-03）、存量单值转单元素数组（值域不变性，D-002/D-004）、旧列 agent_kind 删除、ix_llm_providers_user_agent_default 显式 drop 后按 user_id 维度索引在位断言（R-01）、downgrade 对称还原。
acceptance:
  - 域一断言齐备——多选创建/组合禁配 422/互斥含扩张清新增引擎兄弟/收缩空缺均有用例且通过。
  - 域二断言齐备——default 与 bound 集合命中 + agent_kind 盖会话引擎 + claim payload 契约均通过。
  - 域三断言齐备——多引擎扇出各推对应 config + 单引擎回归等价 + NULL provider 跳过 + 停止推 None 均通过。
  - 域四断言齐备——capability 门控按引擎命中多选行（含群聊 shadow 间接路径用例）通过。
  - 域五断言齐备——迁移双方言 + 存量转数组 + 索引在位（R-01）通过。
  - 既有用例仅因 agent_kind 到 agent_kinds 口径迁移而改写，不删除守护既有行为的断言（停止场景、owner 隔离、best-effort、幂等等保留）。
  - verify 命令限定相关测试文件路径且全部通过（0 failed）。
verify:
  - cd backend && python -m pytest app/modules/llm_provider/tests/test_agent_kinds_multi.py app/modules/llm_provider/tests/test_agent_kinds_migration.py app/modules/llm_provider/tests/test_llm_provider.py app/modules/llm_provider/tests/test_api_format.py app/modules/daemon/tests/test_resolve_default_provider_config.py app/modules/daemon/tests/test_resolve_bound_provider_config.py app/modules/daemon/tests/test_provider_switch.py app/modules/daemon/tests/test_provider_switch_integration.py app/modules/daemon/tests/test_control_command_dispatch.py tests/modules/daemon/lease/test_provider_config_payload.py app/modules/session_attachment/tests/test_capability.py -q
constraints:
  - 只改测试（allowed_paths 四个测试目录），不改产品代码；测试红时优先回溯 task-03/task-04/task-05 实现缺陷，确需改产品代码则回报并走对应 task 口径，不在本卡放宽断言迁就实现。
  - 禁全量 pytest——verify 只跑列出的相关文件。
  - R-02——断言与日志不输出完整明文 api_key（前缀/长度断言即可）。
  - 迁移测试落位 backend/app/modules/llm_provider/tests/（allowed_paths 约束），范式沿用 backend/tests 顶层 test_*_migration.py 先例。
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
