---
id: task-02
title: 'daemon 共享词表 thinking-levels.ts+映射矩阵+单测'
title_zh: 'daemon 共享词表 thinking-levels.ts+映射矩阵+单测'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-15 00:48:35
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/thinking-levels.ts
  - sillyhub-daemon/tests/interactive/thinking-levels.test.ts
target_files:
  - NEW:sillyhub-daemon/src/interactive/thinking-levels.ts
  - NEW:sillyhub-daemon/tests/interactive/thinking-levels.test.ts
provides:
  - contract: thinking-levels 单源
    fields: [THINKING_LEVELS, mapPlatformLevelToEngine, isValidPlatformLevel]
goal: >
  daemon 新增思考档位共享单源 thinking-levels.ts（FR-02）：THINKING_LEVELS 七档常量 +
  mapPlatformLevelToEngine(provider, level) 三引擎映射矩阵（含 off/minimal/max 降级规则）+
  isValidPlatformLevel 校验，供 task-03 守卫/归一化与 task-04 三 driver 消费——统一词表
  单源避免各层自拼档位串；矩阵全组合单测兜底 R-05（矩阵为纯函数易改）。
implementation:
  - 'NEW thinking-levels.ts——export const THINKING_LEVELS = ["off","minimal","low","medium","high","xhigh","max"] as const（七档词表单源，design §接口定义原文）+ export type PlatformThinkingLevel = (typeof THINKING_LEVELS)[number] 便利类型；文件头注释标 FR-02 与前端/ backend 两侧镜像同源关系'
  - 'mapPlatformLevelToEngine(provider: string, level: string): string | undefined——三引擎矩阵：pi 七档直传（含 off=真关，rpc.md:281-295）；claude：low/medium/high/xhigh/max 直传 EffortLevel（sdk.d.ts:1735 五档）、minimal→low 降级、off→undefined（不设 effort）；codex：minimal/low/medium/high/xhigh 直传（二进制枚举实证）、max→xhigh 降级、off→undefined（不设 reasoningEffort）；未知 provider 或非法 level → undefined；矩阵逐格注释引调研锚点'
  - 'off 语义差异注释必写（design P2-11 口径）——pi=真关（引擎停止思考）/ claude=不设 effort=引擎默认思考通常开（非关闭）：同返回 undefined 但语义不同，注释钉死供前端 tooltip（task-06）与 onboarding 文档（task-07）同源引用'
  - 'isValidPlatformLevel(level: string): boolean——THINKING_LEVELS.includes 窄化守卫（daemon RPC 归一化与 backend 镜像共用语义）'
  - 'NEW thinking-levels.test.ts——① 全组合矩阵：七档 × claude/pi/codex 逐格断言期望值（21 格表驱动）② 降级规则显式用例：claude minimal→low、claude off→undefined、codex max→xhigh、codex off→undefined ③ 非法输入：未知 provider（"cursor"/任意串）→ undefined、"ultra"/空串/大小写变体 → undefined / isValidPlatformLevel=false ④ THINKING_LEVELS 长度=7 且顺序 off→max 锁定（防词表漂移）'
acceptance:
  - 全组合 21 格表驱动断言绿（七档 × 三引擎期望值与 design FR-02 矩阵逐格一致）
  - 降级四例（claude minimal→low/off→undefined、codex max→xhigh/off→undefined）与非法输入用例绿；THINKING_LEVELS 长度=7 顺序锁定
  - 纯常量+纯函数零副作用（不 import driver/session-manager 任何符号）+ daemon typecheck 绿
verify:
  - pnpm -C sillyhub-daemon exec vitest run tests/interactive/thinking-levels.test.ts
  - pnpm -C sillyhub-daemon exec tsc --noEmit
constraints:
  - 纯常量+纯函数模块：不依赖 driver/session-manager 任何符号（避免环依赖；消费方归 task-03/04）
  - off 语义差异以注释显式写死（pi=真关 / claude=不设=引擎默认思考通常开）——前端 tooltip 与文档口径同源此注释，不许两侧各说各话
  - 词表与矩阵为纯数据易改（R-05 应对）：真机不符只改矩阵一格+单测同步，机制不动；未知 provider 一律 undefined（不猜测直传）
  - daemon ESM 相对 import 带 .js 后缀（如需）；Windows / Linux / macOS 兼容
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
