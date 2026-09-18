---
id: task-03
title: 'codex 驱动输入循环接 turn/steer 分支（turn 活跃直发，被拒回落轮边界；含单测）'
title_zh: 'codex 驱动输入循环接 turn/steer 分支（turn 活跃直发，被拒回落轮边界；含单测）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-19 00:36:51
priority: P0
depends_on: ['task-02']
requirement_ids: [FR-06]
decision_ids: [D-003@v1]
blocks: [task-09]
allowed_paths:
  - sillyhub-daemon/src/interactive/codex-app-server-driver.ts
  - sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts
target_files:
  - sillyhub-daemon/src/interactive/codex-app-server-driver.ts
  - sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts
goal: >
  codex 驱动忙轮注入从「等 turn/completed 轮边界消费」升级为 turn/steer 直发、被拒安全回落轮边界，
  使 codex 获得与 pi/claude 同语义的 mid-turn 引导能力（FR-06），供 task-09 端到端引导用例消费。
implementation:
  - '在输入循环（codex-app-server-driver.ts:1231-1239，while :1236 / _takeNextTurn :1238）加 turn/steer 分支：SESSION_INJECT 到达且 currentTurnId 活跃（turn/started 已见、turn/completed 未到）时向 app-server 发 turn/steer（参数形状严格按 task-02 落盘的 spike-codex-turn-steer.md 探测结论），不再压回输入队列等轮边界'
  - '被拒回落：turn/steer 错误回执（参数不符/版本不支持）或无活跃 turn → 维持既有轮级串行路径（消息回落输入队列、下一轮 turn/start 消费），不抛错不挂死'
  - '单测（codex-app-server-driver.test.ts，沿用 mock transport TDD-3 既有模式）新增三用例：忙轮注入直发 turn/steer（断言参数形状与 spike-01 结论一致）；被拒回落轮边界（断言后续 turn/start 仍携带该输入且会话收敛不挂死）；无活跃 turn 注入行为与现状一致'
acceptance:
  - '忙轮（currentTurnId 活跃）注入 → mock transport 断言发出 turn/steer 且未等 turn/completed，参数形状与 spike-01 探测结论一致'
  - 'turn/steer 被拒 → 驱动不抛错不挂死，消息回落轮边界并在下一轮正常消费（断言下一条 turn/start 携带该输入）'
  - '既有轮级串行 / resume / threadId 竞态用例全部零回归通过（禁并发 turn 不变式不破坏）'
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/codex-app-server-driver.test.ts
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/codex-app-server-driver.test.ts -t steer
constraints:
  - 'codex turn/steer 被拒必须回落轮边界消费（不报错不挂死，plan 全局硬约束）；轮级串行不变式（禁并发 turn）不破坏'
  - 'turn/steer 参数形状以 task-02 探测结论为准，不凭二进制字符串痕迹猜测编造；spike 失败则本任务按 plan spike-01 豁免条款取消'
  - '禁跑全量测试，仅跑本测试文件相关用例；改动仅限 allowed_paths 两文件'
expects_from:
  task-02:
    - contract: spike-codex-turn-steer
      needs: [turn/steer 请求参数形状, 响应与错误回执样例]
provides:
  - contract: codex_mid_turn_inject
    fields: [turn/steer 直发分支, 被拒轮边界回落]
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
