---
id: task-06
title: 'Collect flow status in daemon'
title_zh: 'daemon flow status 采集执行器（progress 同拍三态矩阵、失败静默、仅活跃 thin）+测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 14:17:38
priority: P0
depends_on: [task-01]
blocks: [task-07]
requirement_ids: [FR-03, FR-06]
decision_ids: ['D-008@v2']
allowed_paths:
  - sillyhub-daemon/src/sillyspec-manager.ts
  - NEW:sillyhub-daemon/tests/sillyspec-flow-status-collector.test.ts
target_files:
  - sillyhub-daemon/src/sillyspec-manager.ts
  - NEW:sillyhub-daemon/tests/sillyspec-flow-status-collector.test.ts
goal: >
  daemon 采集器补 flow status --json 执行器：与现有 progress show --json 采集（sillyhub-daemon/src/sillyspec-manager.ts:948）同拍同三态矩阵模式，逐活跃 thin 变更采集，失败静默不阻塞主采集。
implementation:
  - 'sillyspec-manager.ts 新增 flow status 采集执行器：spawn node <sillyspec-bin> flow status --json --change <名>（execFile 数组形参，对齐 progress 采集执行器范式），解析 JSON 提取白名单字段'
  - '三态矩阵同款（ok/stale/error）：CLI 不存在/exit 非零/输出非 JSON → error 态静默降级，不影响 progress 采集与 heartbeat 其他载荷（FR-07）'
  - '仅对活跃（非归档）thin 变更采集；结果存 daemon 内部摘要槽供 hub-client 组装（task-07）'
  - 'NEW __tests__/sillyspec-flow-status-collector.test.ts：成功解析/CLI 缺 flow 命令 exit 非零/输出畸形三态用例（mock execFile）'
acceptance:
  - '三态用例全绿：成功态产出白名单摘要；失败态静默不抛不影响 progress 采集'
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/sillyspec-flow-status-collector.test.ts
constraints:
  - '不改 sillyspec CLI；采集失败仅记日志（try-catch 吞噬）；Windows/Linux/macOS 路径兼容（spawn 数组形参）'
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
