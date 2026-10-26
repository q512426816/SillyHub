---
id: task-07
title: 'Assemble thin_flows heartbeat payload'
title_zh: 'daemon hub-client heartbeat 载荷组装 thin_flows（workspace_id+白名单，仅活跃 thin）+断言并入采集测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 14:17:38
priority: P0
depends_on: [task-01, task-06]
blocks: []
requirement_ids: [FR-03, FR-06]
decision_ids: ['D-008@v2']
allowed_paths:
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/daemon.ts
  - NEW:sillyhub-daemon/tests/sillyspec-flow-status-collector.test.ts
  - sillyhub-daemon/tests/daemon-heartbeat-pending.test.ts
  - sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts
  - sillyhub-daemon/tests/sillyspec-platform-command.test.ts
  - sillyhub-daemon/tests/integration/selfupdate-scenarios.test.ts
target_files:
  - sillyhub-daemon/src/hub-client.ts
expects_from:
  - 'task-01 contract DaemonHeartbeatThinFlow 字段清单（design 接口定义；daemon 侧手写载荷 interface 过渡，task-11 统一 gen:types 收口）'
  - 'task-06 采集摘要槽（daemon 内部）'
goal: >
  hub-client heartbeat 载荷 sillyspec_status 加 thin_flows 键：从 task-06 摘要槽组装白名单字段条目（首键 workspace_id），供 backend task-05 消费。
implementation:
  - 'hub-client.ts heartbeat 组装处（sillyspec_status 键构造，先例 sillyhub-daemon/src/hub-client.ts:47/860）加 thin_flows 可选键：条目=workspace_id+change+phase/designFilled/frFilled/bindings/tasksChecked/tasksTotal/substeps/substepsTotal/specApproved/autopilot/legacyFallback 白名单'
  - 'thin_flows 缺席语义：采集槽空（无活跃 thin/采集失败）时键省略不发（旧 daemon 形态），backend 侧不写不清'
  - '组装断言并入 sillyspec-flow-status-collector.test.ts（design 清单无独立 hub-client 测试文件）：条目字段齐全性+空槽省略键'
acceptance:
  - '有活跃 thin 时载荷含 thin_flows 条目（字段白名单齐全）；空槽时键省略'
verify:
  - cd sillyhub-daemon && pnpm vitest run src/__tests__/sillyspec-flow-status-collector.test.ts
constraints:
  - 'daemon 类型手写 interface 过渡不跑 gen:types（task-11 收口）；字段名与 design 接口定义逐字对齐'
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
