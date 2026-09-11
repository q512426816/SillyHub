---
id: task-06
title: 'daemon 测试收口——ForReload 分派矩阵 / mirror / 迁移 / reload / restore / 热切换语义更新（含既有测试 import 迁移 + session-manager-config-switch / session-manager-reload-provider 两文件 claude-only 断言改写）'
title_zh: 'daemon 测试收口——ForReload 分派矩阵 / mirror / 迁移 / reload / restore / 热切换语义更新（含既有测试 import 迁移 + session-manager-config-switch / session-manager-reload-provider 两文件 claude-only 断言改写）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-11 18:57:36
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04']
blocks: []
requirement_ids: [FR-01, FR-02, FR-04, FR-05]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - NEW:sillyhub-daemon/tests/provider-file-settings-reload.test.ts
  - sillyhub-daemon/tests/daemon-provider-file-dispatch.test.ts
  - sillyhub-daemon/tests/provider-injection-smoke.integ.test.ts
  - sillyhub-daemon/tests/daemon-provider-config-changed-handler.test.ts
  - sillyhub-daemon/tests/interactive/session-manager-config-switch.test.ts
  - sillyhub-daemon/tests/interactive/session-manager-reload-provider.test.ts
  - sillyhub-daemon/tests/interactive/session-recovery.test.ts
  - sillyhub-daemon/tests/cli-session-manager-injection.test.ts
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  daemon 侧测试收口——为 ForReload 失败兜底矩阵 / mirrorCodexHostAuth / migrateCodexThreadFromHost /
  reload 内核合并与迁移钩子 / restore 自愈 / reloadWithProvider 热切换新语义补齐单测，并完成
  既有测试的 import 迁移与两处 claude-only 断言改写，锁定 task-01~04 全链路产物。
implementation:
  - 新建 tests/provider-file-settings-reload.test.ts——ForReload 全分派矩阵（非 null codex 成功返 CODEX_HOME 键 / pi 自定义端点返 PI_CODING_AGENT_DIR / pi 官方端点返空 / codex 门槛缺且 priorEnv 有键返 prior 键 / 门槛缺且无键返空 / 写盘 IO 失败且 priorEnv 有键返 prior 键 / IO 失败且 priorEnv 为 undefined 返空 / null 且 priorEnv 带 CODEX_HOME 时镜像成败均返 prior 键（成功与失败两用例）/ null 且无 prior 键返空 / null 且 pi kind 返空）
  - 同文件——mirrorCodexHostAuth 三态（宿主 auth.json+config.toml 存在则拷入覆盖 per-session 产物 / 宿主无则删 per-session 同名两文件 / IO 失败 error 不抛）+ migrateCodexThreadFromHost 三态（宿主 rollout 首行会话 id 匹配 threadId 命中则按 sessions/ 相对路径拷入返 true，首行兼容读 payload.session_id 与 session_meta.id / 无命中返 false / 宿主目录缺 warn 返 false）
  - tests/daemon-provider-file-dispatch.test.ts 与 tests/provider-injection-smoke.integ.test.ts——applyProviderFileSettings 的 import 自 ../src/task-runner.js（各自 :63 / :44）改指 ../src/provider-file-settings.js，既有断言零改动全绿（task-01 平移回归）
  - tests/daemon-provider-config-changed-handler.test.ts——import 迁移（:37）+ 热切换语义更新（task-03 删守卫后 PROVIDER_CONFIG_CHANGED 对 codex/pi 从尽力重写升级为确定性 reload，与 claude 同语义 D-003；既有「重写产物与新会话 spawn 前产物逐字一致」断言按幂等预写语义保留，补 handler 走 reloadWithProvider 不再撞 not-yet-supported 的接线断言）
  - tests/interactive/session-manager-config-switch.test.ts（REG-4 :382-393）与 tests/interactive/session-manager-reload-provider.test.ts（边界-2 :596-608）——claude-only 抛错断言改写为 codex 走通 reload（mock codex driver 注册进 drivers registry 或白盒改 provider 后断言 reload 成功、文件层 env 合并生效、会话不破坏）
  - reload 内核用例（codex/pi env 合并结果 + codex 迁移钩子三联触发条件矩阵）加在 session-manager-reload-provider / config-switch 套件；restore 四态（providerConfig 非 null happy / ForReload IO 失败返空降级 / codex null 且确定性目录存在镜像+注 env / 目录不存在零动作）加在 session-recovery.test.ts；cli daemonApiKey 注入锚定（捕获 SessionManager 构造 deps 断言 daemonApiKey=config.api_key ?? null）加在 cli-session-manager-injection.test.ts——两落点为 interactive/cli 现有套件，已预置进本卡 allowed_paths
  - 全部新用例遵循既有套件桩策略（SILLYHUB_DAEMON_DIR stub 到 tmpdir、fake child / mock driver 复用 helpers），不新造第二套 mock 体系
acceptance:
  - ForReload 全分派矩阵用例覆盖 design 接口定义全部返回值语义（含 null 镜像成败两分支与 priorEnv 为 undefined 降级分支）全绿
  - mirror 三态与迁移三态用例全绿（迁移命中用例的 rollout fixture 以实际首行为准，兼容两种 id 字段读法）
  - 两测试文件 import 迁移后 daemon-provider-file-dispatch / provider-injection-smoke 既有断言零改动全绿
  - REG-4 与 边界-2 改写为 codex 走通 reload（断言新 env、会话保持 active），config-switch / reload-provider 两套件全绿
  - 热切换 handler 语义更新断言（codex/pi PROVIDER_CONFIG_CHANGED 确定性 reload）全绿；restore 四态与 reload 内核 / cli 注入锚定用例全绿
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
  - cd sillyhub-daemon && pnpm vitest run tests/provider-file-settings-reload.test.ts tests/daemon-provider-file-dispatch.test.ts tests/daemon-provider-config-changed-handler.test.ts tests/interactive/session-manager-config-switch.test.ts tests/interactive/session-manager-reload-provider.test.ts tests/interactive/session-recovery.test.ts tests/cli-session-manager-injection.test.ts
  - cd sillyhub-daemon && pnpm vitest run tests/provider-injection-smoke.integ.test.ts（integ 冒烟，按其文件头运行约定执行）
constraints:
  - 不跑全量，只跑本卡相关套件（CLAUDE.md 规则 0）
  - 断言改写是 design 已裁定的语义升级（Wave 2 步骤 3），非为绿放水——改写后断言强度不低于原 REG-4 / 边界-2（CLAUDE.md 规则 9）
  - 本卡只改测试文件，不改 src/——发现 task-01~04 实现缺口回报主代理回对应卡修，不在本卡顺手改源码
  - reload 内核 / restore / cli 注入用例优先落 allowed_paths 既有套件；确需其它落点先补进本卡 allowed_paths 再写（session-recovery 与 cli-session-manager-injection 两落点已预置）
  - R-03——热切换语义升级后 verify 阶段同步 _module-map / 模块卡描述（本卡测试为其提供证据，文档同步不在本卡 allowed_paths）
related_tests:
  - sillyhub-daemon/tests/daemon-provider-file-dispatch.test.ts（task-01 平移后 applyProviderFileSettings 符号自 task-runner 搬至 provider-file-settings，import 须迁移否则编译失败）
  - sillyhub-daemon/tests/provider-injection-smoke.integ.test.ts（:44 直引 task-runner 符号，同上 import 迁移）
  - sillyhub-daemon/tests/daemon-provider-config-changed-handler.test.ts（:37 import 迁移 + task-03 删守卫后热切换语义升级，既有断言按新语义更新）
  - sillyhub-daemon/tests/interactive/session-manager-config-switch.test.ts（REG-4 断言因 task-03 删守卫失效，改写为 codex 走通）
  - sillyhub-daemon/tests/interactive/session-manager-reload-provider.test.ts（边界-2 断言同上失效改写）
  - sillyhub-daemon/tests/interactive/session-recovery.test.ts（restore 四态新用例落点，既有断言不动）
  - sillyhub-daemon/tests/cli-session-manager-injection.test.ts（cli daemonApiKey 注入锚定新用例落点，既有断言不动）
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
