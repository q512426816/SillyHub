---
id: task-05
title: 'Ingest heartbeat thin flows with row-lock upsert'
title_zh: 'backend heartbeat thin_flows 载荷+消费归一 phase 四枚举+行锁落库（只 set stages 不刷 updated_at）+测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 14:17:38
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-03, FR-06]
decision_ids: ['D-008@v2', 'D-014@v1']
allowed_paths:
  - backend/app/modules/daemon/router/heartbeat.py
  - backend/app/modules/daemon/runtime/service.py
  - backend/app/modules/daemon/tests/test_heartbeat_thin_flows.py
target_files:
  - backend/app/modules/daemon/router/heartbeat.py
  - NEW:backend/app/modules/daemon/tests/test_heartbeat_thin_flows.py
expects_from:
  - 'task-01 contract ThinFlowProgress（backend/app/modules/change/schema.py）'
goal: >
  heartbeat 新增逐变更写入路径（区别既有 sillyspec_status 整包快照直写，backend/app/modules/daemon/runtime/service.py:462-468）：thin_flows 载荷（条目含 workspace_id）解析归一 phase 四枚举后行锁事务落 changes.stages["thin_flow"]，不刷 updated_at。
implementation:
  - '实现首步：逐字核对 sillyspec src/flow.js:3284-3296 phase 推断，归一规则落注释（substeps 含 ledger→closing；docs 齐+approved/autopilot→executing；docs 齐未批准→awaiting_approval；否则 spec）'
  - 'heartbeat.py 新增 DaemonHeartbeatThinFlow 载荷（首键 workspace_id，字段清单=design 接口定义）挂 DaemonHeartbeatSillySpecStatus.thin_flows optional'
  - '消费侧（heartbeat 处理链，落点就近 runtime/service.py:462-468 现有 sillyspec_status 消费位置）：每条目按 workspace_id+change_key 定位 changes 行——行锁事务 SELECT ... FOR UPDATE 读 stages → dict 合并 thin_flow 键 → UPDATE 只 set stages 列（D-014 不刷 updated_at）；坏条目/未匹配行单条丢弃整批不拒（盲区#3 已删变更静默跳过不建行）'
  - 'NEW test_heartbeat_thin_flows.py：主路径（executing/closing 归一+落库断言）/坏条目（phase 空串）单条丢弃整批 200/未知变更跳过/updated_at 写入前后不变断言'
acceptance:
  - '合法条目落 changes.stages["thin_flow"]（phase 四枚举）；坏条目丢弃 heartbeat 200；changes.updated_at 不变'
verify:
  - cd backend && python -m pytest app/modules/daemon/tests/test_heartbeat_thin_flows.py -q
constraints:
  - 'UPDATE 只 set stages 列（D-014）；既有 sillyspec_status 整包快照直写逻辑零改动（语义边界，design 生命周期表）；不加 REST 端点'
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
