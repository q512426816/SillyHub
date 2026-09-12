---
id: task-04
title: 'codex driver 解析 last + 两路 usage 附加 ctx_tokens + 测试'
title_zh: 'codex driver 解析 last + 两路 usage 附加 ctx_tokens + 测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-13 01:12:24
priority: P0
depends_on: ['task-01']
blocks: ['task-08']
requirement_ids: [FR-03]
decision_ids: [D-001@v1]
expects_from:
  task-01:
    - contract: usage-ctx-helper
      needs: [ctxTokensFromGrossInput]
allowed_paths:
  - sillyhub-daemon/src/interactive/codex-app-server-driver.ts
  - sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts
target_files:
  - sillyhub-daemon/src/interactive/codex-app-server-driver.ts
  - sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts
goal: >
  codex-app-server-driver.ts _extractTokenUsage（:1407-1466）解析
  thread/tokenUsage/updated 通知的 params.tokenUsage.last（单调用毛值
  inputTokens）存 h.lastCallCtxTokens = ctxTokensFromGrossInput(last.inputTokens)，
  并在 _usageDelta 返回 usage（usage_update 事件载体）与 _applyTurnUsageDelta
  填充的 turn result usage 两路附加 ctx_tokens（FR-03）——现行只解析 total
  （线程累计），ctx 维缺失致 codex 会话环未知态；回填后 codex 会话环显示真实百分比。
implementation:
  - import { ctxTokensFromGrossInput } from './usage-ctx.js'（task-01 产出；ESM .js 后缀）
  - CodexHandle 接口（:429 起）加 lastCallCtxTokens 字段（number | undefined，docblock 注明「最近一次 API 调用 ctx——last.inputTokens 毛值直取；undefined = last 缺失/非法不携带」）；handle 创建处（:785 附近）初始化 undefined
  - _extractTokenUsage 解析扩展——msg 类型声明加 params.tokenUsage.last（可选 record）；total 解析赋值后、_usageDelta 调用前追加 last 分支——last.inputTokens 为有限数值时 h.lastCallCtxTokens = ctxTokensFromGrossInput(last.inputTokens)，否则 h.lastCallCtxTokens = undefined（不伪造 0）；total 缺失仍整体忽略（:1423-1424 既有提前返回语义不动，total 与 last 同帧真源）
  - '_usageDelta（:1477-1495）返回对象附加展开——...(h.lastCallCtxTokens !== undefined ? { ctx_tokens: h.lastCallCtxTokens } : {})（全字段 Δ≤0 返回 null 的既有语义不变——无新用量即无 usage_update，ctx 无从携带语义自洽）'
  - _applyTurnUsageDelta（:1502-1527）outcome.usage = delta 直接复用 _usageDelta 返回对象 → usage_update 事件与 turn result usage 两路同源携带 ctx_tokens（单点附加即双路生效，等价于两处显式附加且无对象分叉风险）
  - 测试——tokenUsageNotif 助手（:215-240）已建模 last 与 total 同形态（:235 last 为 total 展开），「轮内多次调用」用例（:640 起）补断言两次 usage_update 事件与 result.usage 的 ctx_tokens=10000/20000（末次 20000 进 result）；「跨轮基线」用例（:726 起）第 2 轮 result.usage ctx_tokens=35000；新增无 last 用例（助手加可选参省略 last 键）断言 usage 四维照旧且 ctx_tokens 键不存在（反断言）；last.inputTokens 非法（非有限数值）样本同断言不携带
acceptance:
  - tokenUsageNotif 带 last 样本——usage_update 事件 usage.ctx_tokens = last.inputTokens（毛值直取），turn result usage 同值（两路一致）
  - 无 last / last.inputTokens 非法通知——usage 仅四维短名字段，ctx_tokens 键不存在（精确反断言），四维 token 上报照旧
  - 既有 tokenUsage 系用例（toMatchObject 宽断言，加键不破）全绿零回归；全部产出过 safeParseAgentEvent
verify:
  - pnpm -C sillyhub-daemon exec vitest run tests/interactive/codex-app-server-driver.test.ts
  - pnpm -C sillyhub-daemon run typecheck
constraints:
  - last 缺失/非法不伪造 0——codex ctx 保持未知态如实降级（设计兼容策略，纯降级无破坏）；四维 token 毛值拆桶差值口径照旧不动
  - 不改 total 解析与 threadUsageTotal / usageBaseline / modelUsageSnapshot / turnApiCallCount 既有语义（ql-20260909-027 / ql-20260910-003 口径零变化）
  - spike-01 真机 last 形态验证归 task-08（Wave 3）不在本卡；本卡按测试助手已建模形态实现，真机 last 缺失时 task-08 走降级路径、本卡代码天然兼容（undefined 不携带）
  - 只改 codex-app-server-driver.ts + 对应测试
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
