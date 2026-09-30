---
id: task-03
title: 'agent-log protocol v2 machine block ingest'
title_zh: '上报协议 v2 machine 块接收落库 + 聚合 + 协议文档'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-30 11:07:12
priority: P0
depends_on: [task-01]
blocks: [task-04]
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/platform_sync/schema.py
  - backend/app/modules/platform_sync/service.py
  - backend/app/modules/platform_sync/tests/
  - docs/platform-agent-log-protocol.md
target_files:
  - backend/app/modules/platform_sync/schema.py
  - backend/app/modules/platform_sync/service.py
  - NEW:docs/platform-agent-log-protocol.md
  - NEW:backend/app/modules/platform_sync/tests/test_agent_log_machine.py
provides:
  - contract: reported machine identity persistence
    fields: [reported_machine_id, reported_machine_name, latest_reported_machine]
expects_from:
  task-01:
    - contract: AgentSessionLogORM reported machine columns
      needs: [reported_machine_id, reported_machine_name]
goal: >
  上报协议 entries 增 machine 块（machine_id/hostname 可空）落两列 + 会话聚合写 config_snapshot.latest_reported_machine，协议文档主仓新建沉淀 v2 定义（FR-01）。
implementation:
  - backend/app/modules/platform_sync/schema.py entry DTO 加 AgentLogMachineBlock（machine_id/hostname 可空，extra=ignore 保持老协议兼容）
  - backend/app/modules/platform_sync/service.py upsert_agent_log_entries 落 reported_machine_id/name（entry 级）；会话聚合分支把最新 entry 机器身份写 config_snapshot.latest_reported_machine（dict 快照合并，不覆盖 harness 等既有键）
  - 新建 docs/platform-agent-log-protocol.md：v2 协议全量定义（machine 块字段表、machineId 生成约定 ~/.sillyhub/machine-id 与 daemon 心跳共享）
  - 新测试 test_agent_log_machine.py：带 machine 块落列、无 machine 块落 NULL 不报错、快照聚合最新优先、幂等重推不重复
acceptance:
  - 老 CLI 上报（无 machine 块）行为不变（列 NULL、幂等语义不变）
  - 带 machine 块上报后两列与 config_snapshot.latest_reported_machine 均可查
  - 协议文档含 v2 machine 块字段表与 machineId 约定（中文）
verify:
  - cd backend && uv run pytest app/modules/platform_sync/tests -q --no-cov
constraints:
  - 会话表不加列（快照键承载）；不破坏 (workspace_id, log_path) 幂等 upsert
  - daemon 注入路径上报的 machine 块由 daemon 侧自动附带（本卡只做接收端）
  - 错误文案中文
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
