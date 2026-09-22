---
id: task-01
title: 'Extract provider file settings into shared module provider-file-settings.ts (pure move from task-runner.ts) + rewire both wiring points and two test imports'
title_zh: '共享模块抽取——applyProviderFileSettings 及伴生符号从 task-runner.ts 平移 provider-file-settings.ts + 两接线点/两测试改 import（纯移动零行为）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-11 18:57:27
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/src/provider-file-settings.ts
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/daemon-provider-file-dispatch.test.ts
  - sillyhub-daemon/tests/provider-injection-smoke.integ.test.ts
target_files:
  - NEW:sillyhub-daemon/src/provider-file-settings.ts
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/daemon-provider-file-dispatch.test.ts
  - sillyhub-daemon/tests/provider-injection-smoke.integ.test.ts
provides:
  - 模块 sillyhub-daemon/src/provider-file-settings.ts 导出 applyProviderFileSettings 与 ProviderFileSettingsInput（spawn 版签名与语义逐字不变，自 task-runner.ts:160-305 平移）及伴生判定 isCodexFormSufficient / isPiFormSufficient / nonEmptyStr（原 task-runner.ts 模块私有，平移后升为导出，供 task-02 ForReload 复用）
goal: >
  把 provider 文件层分派逻辑（applyProviderFileSettings 及伴生符号）从 task-runner.ts 单点平移到新共享模块 provider-file-settings.ts，为 task-02 的 ForReload 变体与 task-03/04 的 reload/restore 接线提供不拖起 TaskRunner/daemon 模块的独立消费点；纯移动零行为变化，spawn 路径零漂移（FR-01 前置）。
implementation:
  - 新建 sillyhub-daemon/src/provider-file-settings.ts——把 task-runner.ts:160-305 的 nonEmptyStr / isCodexFormSufficient / isPiFormSufficient / ProviderFileSettingsInput / applyProviderFileSettings 连同注释逐字平移；原模块私有的三个伴生函数平移后加 export；模块头注释注明来源与变更（2026-09-11-session-provider-switch-codex-pi task-01，纯移动）
  - 新文件补齐移动块自身依赖的 import（全部 .js 后缀）——join（node:path）、mkdir（node:fs/promises）、daemonStateDir（./config.js）、writeCodexHome（./codex-settings.js）、writePiDir（./pi-settings.js）、ProviderConfig 类型（./types.js）
  - task-runner.ts 删除上述符号定义及仅被其使用的 import（writeCodexHome/writePiDir 一带；daemonStateDir/mkdir/join 仍被 :992-993 清理路径等使用则保留），新增 import 自 ./provider-file-settings.js 供 :702 batch 接线点调用；不留 re-export（export * 转发面本就不含这些符号，不触碰 ./task-runner/index.js）
  - daemon.ts:125 import 改自 ./provider-file-settings.js；:122-124 注释中「单点定义在 task-runner.ts」口径同步改写为共享模块；:7713 与 :8266 调用点代码零改动
  - tests/daemon-provider-file-dispatch.test.ts:63 拆开——TaskRunner 仍自 ../src/task-runner.js，applyProviderFileSettings 改自 ../src/provider-file-settings.js
  - tests/provider-injection-smoke.integ.test.ts:44 import 改自 ../src/provider-file-settings.js（:43 「分派单点」注释同步指向新模块）
acceptance:
  - sillyhub-daemon/src/provider-file-settings.ts 存在并导出 applyProviderFileSettings / ProviderFileSettingsInput / isCodexFormSufficient / isPiFormSufficient / nonEmptyStr 五符号，函数体与注释与 task-runner.ts 原实现逐字一致（纯移动）
  - grep 确认 src/ 下 applyProviderFileSettings / isCodexFormSufficient / isPiFormSufficient 的定义仅存在于新模块，task-runner.ts 与 daemon.ts 只剩 import 与既有调用
  - daemon.ts:7713（热切换尽力预写）与 :8266（interactive spawn）及 task-runner.ts:702（batch spawn）调用代码逐字未动（仅 import 来源变化）
  - 两测试文件仅改 import 行（断言与用例零改动）且全绿（见 verify）
  - pnpm typecheck 全绿（无残留未用 import、无导出冲突）
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm exec vitest run tests/daemon-provider-file-dispatch.test.ts
  - cd sillyhub-daemon && pnpm exec vitest run tests/provider-injection-smoke.integ.test.ts（真跑 codex/pi 二进制的集成冒烟；环境不具备时以 typecheck + dispatch 单测全绿为准并在汇报注明）
constraints:
  - 纯移动逐字不变——函数体/注释/日志标签一字不改，禁止顺手重构、改名或格式化
  - daemon ESM 铁律——全部相对 import 带 .js 后缀（./provider-file-settings.js）
  - 不留 re-export——测试已直接改 import，task-runner.ts 不再转发这些符号
  - 不改任何调用点行为与入参，不动 writeCodexHome/writePiDir 签名，不新增依赖
  - 不做本卡范围外改动（ForReload/镜像/迁移归 task-02，reload/restore 接线归 task-03/04）
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
