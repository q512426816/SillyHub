---
id: task-03
title: 'zcode sqlite 读取器补字段（spike-01 fixture 核对 db.sqlite JSON 含 usage 与否，结论记 verify-facts）'
title_zh: 'zcode sqlite 读取器补字段（spike-01 fixture 核对 db.sqlite JSON 含 usage 与否，结论记 verify-facts）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-19 21:03:54
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-004@v1]
allowed_paths:
  - sillyhub-daemon/src/agent-log/read-zcode-sqlite.ts
  - sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts
  - .sillyspec/changes/2026-09-19-tool-report-session-replay/verify-facts.json
target_files:
  - sillyhub-daemon/src/agent-log/read-zcode-sqlite.ts
  - sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts
expects_from:
  task-01:
    - contract: NormalizedLogMessage
      needs: [usage, turn_id]
    - contract: AgentLogMessagesResult
      needs: [totalUsage]
related_tests:
  - sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts
goal: >
  zcode sqlite 读取器（sillyhub-daemon/src/agent-log/read-zcode-sqlite.ts:495 readZcodeSqliteMessages）
  同步补 usage/turn_id 等字段与 totalUsage，消除持久库主路径 token 缺口（FR-03，R-01 spike-01）。
implementation:
  - spike-01 先行（R-01 前置核对）——只读开真实 ~/.zcode/cli/db/db.sqlite（mode=ro，复用 loadNodeSqliteDatabaseSync 入口 read-zcode-sqlite.ts:118），抽样 message.data/part.data JSON 键集核对 usage（五项）/turnId/model/durationMs 是否落盘；结论（含与否 + 采纳路径）写入变更目录 verify-facts.json
  - 主路径（JSON 含字段）——双层遍历时提取消息级 usage/turn_id/model/duration_ms 附着到该消息产出的全部段（makeSegment 扩展 read-zcode-sqlite.ts:726，口径对齐 task-02 文件解析器）；totalUsage 全量段（窗口截断前）usage 四项求和；fixture 种子行（SEED_MESSAGES/SEED_PARTS）补对应新字段形状
  - 降级路径（JSON 缺字段）——usage/totalUsage 恒置 null 不伪造 0（token 显示「未知」，R-01 降级不阻塞）；turn_id/model/duration_ms 同缺省；status 分层与窗口语义零改动
  - read-zcode-sqlite.test.ts 断言同步（agent-log 测试平铺无 fixtures 子目录，并入既有文件）——新字段附着与 totalUsage（或 null）按核对结论覆盖，userInput 全字段 toEqual（read-zcode-sqlite.test.ts:354）连带更新，隐藏过滤/tool 四态零回归
acceptance:
  - verify-facts.json 落盘 spike-01 结论（db.sqlite JSON 含 usage/turnId 与否及采纳路径）
  - 按核对结论实现主路径或降级路径之一并有 fixture 断言覆盖；token 缺失路径不显示 0 不抛错
  - 既有 status/truncated/totalSegments/skippedLines 与隐藏过滤/tool 四态断言零回归
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/agent-log/read-zcode-sqlite.test.ts tests/agent-log/zcode-sqlite-dispatch.test.ts && pnpm typecheck
constraints:
  - 恒 mode=ro 只读开库（read-zcode-sqlite.ts:481 先例），spike 与读取器均不写库、不伪造空结果
  - 降级不阻塞——缺字段不改错误语义（「未知」兜底归前端）；verify-facts.json 只记字段形态结论不落真实会话内容；fixture 禁带真实路径/业务内容统一脱敏占位
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
