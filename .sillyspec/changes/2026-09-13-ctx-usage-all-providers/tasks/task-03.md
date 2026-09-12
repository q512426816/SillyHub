---
id: task-03
title: 'cursor-events mapUsage 派生 ctx_tokens + 修正旧注释 + fixture 断言'
title_zh: 'cursor-events mapUsage 派生 ctx_tokens + 修正旧注释 + fixture 断言'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-13 01:12:24
priority: P0
depends_on: ['task-01']
blocks: ['task-08']
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
expects_from:
  task-01:
    - contract: usage-ctx-helper
      needs: [ctxTokensFromNetInput]
allowed_paths:
  - sillyhub-daemon/src/interactive/cursor-events.ts
  - sillyhub-daemon/tests/interactive/cursor-events.test.ts
target_files:
  - sillyhub-daemon/src/interactive/cursor-events.ts
  - sillyhub-daemon/tests/interactive/cursor-events.test.ts
related_tests:
  - cursor-events.test.ts 五处既有 usage 全对象 toEqual 加 ctx_tokens 键即破须同步——:140 turn1-fresh（+15282）、:188 turn2-resume（+15418）、:238 create-chat-probe（+15270）、:312 tool-use-probe（+30645）、:371 probe-trust-only（+31180）
goal: >
  cursor-events.ts mapUsage（:315-332）四对 camelCase→短名映射后派生
  ctx_tokens = inputTokens + cacheReadTokens + cacheWriteTokens 净值三和（FR-02），
  并修正 :37-40 头注释「cursor 侧无 ctx 维度，ctx_tokens 缺省」——该注释是当时
  未派生的决策记录而非数据缺失（fixture 已实证净值跨轮连续性），回填派生 +
  断言同步后 cursor 会话环显示真实百分比。
implementation:
  - import { ctxTokensFromNetInput } from './usage-ctx.js'（task-01 产出；ESM .js 后缀）
  - mapUsage 四对映射循环后追加——ctx 派生复用已过 typeof+Number.isFinite 校验的短名值，ctxTokensFromNetInput(usage.input_tokens, usage.cache_read_tokens, usage.cache_creation_tokens)，ctx !== undefined 时 usage.ctx_tokens = ctx：任一有效分量存在即派生（缺失分量按 0 计）、三分量全缺 → 不携带 ctx_tokens 键（undefined 分支，与 pi 恒派生口径相反，设计 §总体方案明示两口径并列成立）
  - usage 挂载点 :296-299（result 帧 → ev.usage）零修改——mapUsage 返回值带上 ctx_tokens 即透传（handleResult 只判 usage 真值挂载，无字段级耦合）
  - :37-40 头注释修正——「非 number 字段不设值（不伪造 0）；cursor 侧无 ctx 维度，ctx_tokens 缺省。」改为「非 number 字段不设值（不伪造 0）；ctx_tokens = inputTokens + cacheReadTokens + cacheWriteTokens 净值三和（fixture 跨轮连续性验证）。」（注释与实现一致，规则 18）
  - 断言同步（既有全对象 toEqual 加键即破）——:140 turn1-fresh 加 ctx_tokens 15282（6578+8704+0）；:188 turn2-resume 加 ctx_tokens 15418（186+15232+0，断言注释锚定跨轮连续性 15282+轮间增量≈吻合）；:238 create-chat-probe 加 15270（6566+8704+0）；:312 tool-use-probe 加 30645（21429+9216+0）；:371 probe-trust-only 加 31180（14284+16896+0）
  - 守卫回归确认——:501「result usage 非 number 字段不设值不伪造 0」用例三分量全非法（inputTokens 'NaN-ish' / cacheReadTokens null / cacheWriteTokens 缺）→ 不携带 ctx_tokens，该用例 toEqual 全对象断言（仅 output_tokens=5 一键）原样成立零改动（全缺不携带口径的现成行为守护）
acceptance:
  - turn1-fresh golden——turn_result usage ctx_tokens = 15282（6578+8704+0）
  - turn2-resume golden——turn_result usage ctx_tokens = 15418（186+15232+0；与 turn1 的 15282 跨轮连续吻合）
  - 三分量全缺/全非法 → usage 对象不含 ctx_tokens 键（:501 守卫用例零改动通过）
  - 全部产出事件仍过 safeParseAgentEvent（ctx_tokens 为 schema 既有可选键，零 schema 改动）
verify:
  - pnpm -C sillyhub-daemon exec vitest run tests/interactive/cursor-events.test.ts
  - pnpm -C sillyhub-daemon run typecheck
constraints:
  - 只改 cursor-events.ts + cursor-events.test.ts；不动 types.ts / agent-event-schema.ts、不动 CursorDriver 与 usage 挂载点 :296-299
  - 非 number（含 NaN/Infinity）字段不设值不伪造 0 的既有守卫口径不变——ctx 派生只消费已校验短名值，不读原始 raw 字段绕过校验
  - output_tokens 不进 ctx（ctx 为输入侧三分量和）；fixture 只读不改
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
