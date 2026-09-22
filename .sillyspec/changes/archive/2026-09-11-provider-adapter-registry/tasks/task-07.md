---
id: task-07
title: '全量回归与防遗漏演示验证——既有套件全绿 + 「临时抽走一份声明 → tsc 红」验证记录'
title_zh: '全量回归与防遗漏演示验证——既有套件全绿 + 「临时抽走一份声明 → tsc 红」验证记录'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-12 00:00:07
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04', 'task-05', 'task-06']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-001@v1, D-002@v1, D-003@v2]
allowed_paths:
  - sillyhub-daemon/src/interactive/providers.ts
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  全链回归与防遗漏演示验证——本变更全部修改相关套件逐套跑绿（行为零漂移判定，规则 0 不跑全量），
  并以「临时抽走聚合表一份声明→tsc 编译红→还原复绿」演示实证 FR-01 编译期字段完备强制真实生效，
  输出完整验证记录（含六处硬编码字面量 grep 归零复核）。
implementation:
  - 逐套回归（规则 0 铁律——只跑本变更修改相关套件，全量留 CI）——sillyhub-daemon 侧 pnpm typecheck + vitest run 逐套跑 tests/provider-adapter-registry.test.ts（task-06 新守护）/ tests/pi-settings.test.ts / tests/codex-settings.test.ts / tests/provider-file-settings-reload.test.ts（21 矩阵）/ tests/daemon-provider-file-dispatch.test.ts（22）/ tests/provider-injection-smoke.integ.test.ts（6）/ tests/interactive/session-recovery.test.ts / tests/interactive/session-manager-config-switch.test.ts / tests/interactive/session-manager-reload-provider.test.ts / tests/daemon-provider-config-changed-handler.test.ts / tests/cli-session-manager-injection.test.ts / tests/credential-injector.test.ts / tests/credential-injector-pi.test.ts / tests/interactive/provider-registry.test.ts（nineKeys 10 键联动）共 14 套件；frontend 侧 pnpm gen:types 全流程（链尾挂 caps 生成）+ pnpm exec tsc --noEmit 0 错 + vitest run src/components/sessions/__tests__/session-config-bar.test.tsx（35）与 src/components/daemon/__tests__/session-panel-provider-caps.test.tsx（20）两套件；backend 侧 uv run pytest app/modules/agent/tests/test_provider_caps_alignment.py（10 键对齐）
  - 防遗漏演示（FR-01 实证，全程留痕）——先 git status 记录工作树基线 → 临时注释 sillyhub-daemon/src/interactive/providers.ts 聚合表 codex 条目任一必填字段（如 smokeSuite 一行）→ cd sillyhub-daemon && pnpm typecheck 期望 TS2741 红（Property 'smokeSuite' is missing 之类输出）并记录 → git checkout -- sillyhub-daemon/src/interactive/providers.ts 完整还原 → pnpm typecheck 复绿 → git diff --exit-code 该文件输出为空的证据链，前后输出一并记入验证记录
  - 六处字面量 grep 归零复核（plan 全局验收 5）——daemon.ts 热切换重写判断 / _cleanupProviderFileDirs / _sweepOrphanProviderFileDirs 三处、session-manager/persistence.ts 的 restore 外层门控与 codex 探测两处、session-manager.ts reload 合并块门控一处，原 'codex'/'pi' kind 字面量组合判断在对应文件 grep 命中归零（残留=task-03 漏改，回补而不是放过）
  - 汇总验证记录并判定行为零漂移——既有测试唯一改动=键集合 9→10 联动两处（backend 对齐测试 EXPECTED_CAPS_KEYS 与 daemon provider-registry.test.ts nineKeys），其余零改动；任何套件红先定位根因回对应前序 task 修复后重跑（非测试逻辑有误禁改测试迁就，规则 9）
acceptance:
  - 上述修改相关套件全部绿——daemon typecheck + 14 套件、frontend gen:types 全流程 + tsc 0 错 + config-bar 35 + provider-caps 20、backend 对齐测试 10 键，无跳过无兜底
  - 演示证据链完整在案——抽走声明的 TS2741 红输出、git checkout 还原、typecheck 复绿、git status 工作树与基线一致且演示对象 git diff 为空（演示零残留）
  - 六处硬编码字面量 grep 归零输出在案
  - 行为零漂移确认——既有测试改动仅 9→10 键联动两处，工作树除本变更各 task 产出外无其它 diff
verify:
  - cd sillyhub-daemon && pnpm typecheck && pnpm vitest run tests/provider-adapter-registry.test.ts tests/pi-settings.test.ts tests/codex-settings.test.ts tests/provider-file-settings-reload.test.ts tests/daemon-provider-file-dispatch.test.ts tests/provider-injection-smoke.integ.test.ts tests/cli-session-manager-injection.test.ts tests/daemon-provider-config-changed-handler.test.ts tests/credential-injector.test.ts tests/credential-injector-pi.test.ts tests/interactive/provider-registry.test.ts tests/interactive/session-recovery.test.ts tests/interactive/session-manager-config-switch.test.ts tests/interactive/session-manager-reload-provider.test.ts
  - cd frontend && pnpm gen:types && pnpm exec tsc --noEmit && pnpm vitest run src/components/sessions/__tests__/session-config-bar.test.tsx src/components/daemon/__tests__/session-panel-provider-caps.test.tsx
  - cd backend && uv run pytest app/modules/agent/tests/test_provider_caps_alignment.py -q --no-cov
constraints:
  - 规则 0——不跑全量测试（daemon/frontend/backend 全量均留 CI），仅跑本 task 列明的修改相关套件清单
  - 演示还原纪律（钉死）——providers.ts 仅为演示的临时操作对象（抽走→还原），列进 allowed_paths 只为对账该演示动作；还原后必须以 git status 对照基线 + git diff --exit-code 空为证据，任务完成时该文件零净改动（diff 空即验收通过）；禁止把红态留在工作树、禁止顺手「改进」聚合表任何内容
  - 纯验证零净改动——本 task 不新增/修改任何源码与测试文件；发现红先修根因（前序 task 缺陷回对应 task），非测试逻辑有误禁改测试迁就（规则 9）
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
