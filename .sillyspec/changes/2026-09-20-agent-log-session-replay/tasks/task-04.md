---
id: task-04
title: 'db.sqlite token 可得性实证 + read-zcode-sqlite 透传（可得→透传/不可得→缺省，双分支测试）'
title_zh: 'db.sqlite token 可得性实证 + read-zcode-sqlite 透传（可得→透传/不可得→缺省，双分支测试）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-20 09:50:21
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/agent-log/read-zcode-sqlite.ts
  - sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts
target_files:
  - sillyhub-daemon/src/agent-log/read-zcode-sqlite.ts
  - sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts
expects_from:
  task-01:
    - contract: NormalizedLogMessage
      needs: [usage, turn_id, model]
goal: >
  实证 zcode 持久库 db.sqlite 中 token 数据可得性（zcode 读取的优先路径），可得则读取器
  透传 usage/轮边界/totalUsage，不可得则缺省（前端显示未知），双分支都有既定行为不炸。
implementation:
  - 只读实证本机 ~/.zcode/cli/db/db.sqlite（sqlite3/python 只读连接）：part 表 step-finish 类 part 的 data JSON 是否含 token 字段、message.data 是否含轮边界/模型信息；结论与证据落本 change QUICKLOG（ql 条目）
  - 可得：sillyhub-daemon/src/agent-log/read-zcode-sqlite.ts readZcodeSqliteMessages 透传 usage（键归一 snake_case 全量口径，input 含缓存则原样）/turn_id/model/totalUsage（全 message/part 求和）
  - 不可得：读取器新字段不产出（undefined 缺省），docstring 注明实证结论与日期
  - sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts 双分支 fixture（createZcodeFixtureDb 造库）：可得库断言透传值；不可得库断言缺省不炸
acceptance:
  - QUICKLOG 落实证结论（可得/不可得 + 证据路径与字段名）
  - 双分支测试绿：可得→usage/totalUsage 命中；不可得→字段 undefined、既有消息解析不回归
  - 既有 read-zcode-sqlite.test.ts 用例全绿；zcode-sqlite-dispatch.test.ts 不受影响（新字段可选）
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/agent-log/read-zcode-sqlite.test.ts tests/agent-log/zcode-sqlite-dispatch.test.ts
constraints:
  - 实证只读（mode=ro 连接），绝不写库；不落库不缓存（读取器保持读即弃）
  - 不得为 token 双读 rollout 文件（一次回放两次 20MB 解析得不偿失，design §1.2 裁决）
  - 结论只影响本任务透传面，不影响 task-01/05 契约
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
