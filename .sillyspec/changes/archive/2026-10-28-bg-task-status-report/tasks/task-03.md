---
id: task-03
title: 'daemon 事件上报接线+幂等去重（FR-01）'
title_zh: 'daemon 事件上报接线+幂等去重（FR-01）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-27 13:02:37
priority: P0
depends_on: ["task-01", "task-02"]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts
target_files:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/hub-client.ts
goal: >
  上报链接线：session-manager 消费 bg_task_final 段→onTurnMessage 桥发控制标记（turn_phase_report 同款）→daemon 层拦截→HubClient 新方法 notifyBgTaskFinal POST 新端点；daemon 进程级 Set 幂等（有界，first_event 先例）。
implementation:
  - events.ts：bg_task_final 段消费发桥标记 type=bg_task_report
  - daemon.ts：桥拦截分支（turn_phase_report 拦截同款位）转 _client.notifyBgTaskFinal
  - hub-client.ts：notifyBgTaskFinal 方法（notifyTurnPhase 同款形态，camel→snake 映射）
  - 幂等：daemon 层有界 Set 按 task_id 去重
  - 测试：桥标记+拦截+幂等用例
acceptance:
  - 端到端：解析产出→桥→拦截→client 调用（单测链路断言）
  - 重复终态只上报一次
  - 上报失败不阻塞消息主链路（catch 吞噬 debug，D-009 同款）
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/ 相关面
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 不进 submitMessages 日志轨（控制标记零撞车，先例约束）
  - 上报失败绝不阻塞主链路
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
