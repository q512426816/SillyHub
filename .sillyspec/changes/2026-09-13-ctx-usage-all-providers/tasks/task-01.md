---
id: task-01
title: 'shared ctx derivation helper'
title_zh: '共享 ctx 派生 helper + 单测'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-13 01:12:24
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/usage-ctx.ts
  - sillyhub-daemon/tests/interactive/usage-ctx.test.ts
target_files:
  - NEW:sillyhub-daemon/src/interactive/usage-ctx.ts
  - NEW:sillyhub-daemon/tests/interactive/usage-ctx.test.ts
provides:
  - contract: usage-ctx-helper
    fields: [ctxTokensFromNetInput, ctxTokensFromGrossInput]
goal: >
  新建共享 ctx 派生 helper——ctxTokensFromNetInput（净值三和）与 ctxTokensFromGrossInput
  （毛值直取），全缺返回 undefined 不伪造 0，为 Wave 2 四引擎 ctx_tokens 派生回填提供
  口径单源（FR-05：口径永远一处定义），配纯函数单测。
implementation:
  - '新建 sillyhub-daemon/src/interactive/usage-ctx.ts，按 design「接口定义」导出两函数——ctxTokensFromNetInput(input: number | undefined, cacheRead: number | undefined, cacheCreation: number | undefined): number | undefined 返回 input + cacheRead + cacheCreation（净值口径：input 为未命中缓存的净输入，claude / pi / cursor 同式）；ctxTokensFromGrossInput(grossInput: number | undefined): number | undefined 返回 grossInput 原值（毛值口径：grossInput 已含 cached + cacheWrite，对应 codex last.inputTokens）'
  - 语义（两函数一致）：全部分量缺省 → 返回 undefined，不伪造 0（事件不含 ctx_tokens 键 → 消费侧缺键即跳过，与 claude 子桶同契约）；任一分量存在 → 缺失分量按 0 计（与 claude-events startInput ?? 0 同口径）
  - JSDoc 锚定两口径差异与 pi 特记——pi 路径 numOr0 归一使入参恒 number、全缺分支恒不触发，错误轮全零 usage 携带 ctx_tokens=0 是有意口径（Grill D-1：全零是该轮真实用量事实，与 claude「事件缺键」未知态语义并列）
  - 新建 sillyhub-daemon/tests/interactive/usage-ctx.test.ts（vitest describe/it 纯函数断言，落点参照同目录既有测试如 provider-registry.test.ts）；daemon 为 NodeNext ESM，测试内相对 import 必须带 .js 后缀（from '../../src/interactive/usage-ctx.js'，knowledge conventions「相对路径 import 必须带 .js 后缀」）
  - 单测覆盖矩阵——全缺 → undefined；部分缺（仅 input / 仅 cacheRead + cacheCreation / 缺任一分量）→ 缺失分量按 0 计求和；正常三和非零值；毛值直取（number 原值返回 / undefined 直通返回 undefined）；0 为有效数据不视作缺失（入参 0 参与求和，非 undefined 分支）
acceptance:
  - 两函数为纯函数、模块零依赖（不 import 任何其他源文件），Wave 2 task-02/03/04/05 可直接 import './usage-ctx.js' 复用
  - 单测四类分支全绿：全缺 → undefined / 部分缺按 0 计 / 正常三和 / 毛值直取（含 undefined 直通与 0 有效值）
verify:
  - cd sillyhub-daemon && pnpm test -- usage-ctx
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 只新建上述两文件，不改任何既有源文件（claude-events 重构引用 helper 属 task-05，本卡不动）
  - helper 只做数值派生，不做事件对象组装 / ctx_tokens 键挂载（挂载归各归一化器）；不引入运行时依赖
  - daemon ESM 相对 import 带 .js 后缀（NodeNext）；Windows 兼容（纯 TS 无 shell 依赖）
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
