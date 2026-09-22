---
id: task-03
title: 'caps 第 16 键 sessionFork——providers.ts 单源+生成器枚举先例扩展+三端镜像刷新+alignment 升 16 键+缺键 none 兜底（depends_on: task-02）'
title_zh: 'caps 第 16 键 sessionFork——providers.ts 单源+生成器枚举先例扩展+三端镜像刷新+alignment 升 16 键+缺键 none 兜底（depends_on: task-02）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-22 20:33:49
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-004@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/providers.ts
  - sillyhub-daemon/scripts/gen-provider-caps.mjs
  - backend/app/modules/agent/provider_caps.py
  - frontend/src/lib/provider-caps.ts
  - backend/app/modules/agent/tests/test_provider_caps_alignment.py
  - sillyhub-daemon/tests/interactive/provider-registry.test.ts
target_files:
  - sillyhub-daemon/src/interactive/providers.ts
  - sillyhub-daemon/scripts/gen-provider-caps.mjs
  - backend/app/modules/agent/provider_caps.py
  - frontend/src/lib/provider-caps.ts
  - backend/app/modules/agent/tests/test_provider_caps_alignment.py
  - sillyhub-daemon/tests/interactive/provider-registry.test.ts
goal: >
  引擎分叉能力显式化：ProviderCaps 增第 16 键 sessionFork（枚举 native/seed/none，pi 值按 task-02 spike 的 D-008 定），三端单源生成+alignment 守护+缺键 none 兜底。
implementation:
  - sillyhub-daemon/src/interactive/providers.ts（PROVIDER_CAPS 现 15 键、dialog 枚举先例 :327）增 sessionFork 第 16 键：claude=native、codex=seed、cursor=none、pi=D-008 结论
  - gen-provider-caps.mjs 按既有 dialog 枚举键形态透传 sessionFork 到三端镜像（backend/app/modules/agent/provider_caps.py + frontend/src/lib/provider-caps.ts）+ 取值处缺键按 none 默认拒绝兜底
  - alignment 测试升 16 键：backend/app/modules/agent/tests/test_provider_caps_alignment.py 键数与值域断言；sillyhub-daemon/tests/interactive/provider-registry.test.ts 契约键列表同步
acceptance:
  - 三端镜像 sessionFork 键值一致（claude=native/codex=seed/cursor=none/pi=D-008 值）
  - alignment 断言 15→16 键通过
  - 缺键时 get_provider_caps/前端取值均回落 none（不炸不 undefined）
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_provider_caps_alignment.py -q --no-cov
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/provider-registry.test.ts
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 单源纪律：只改 providers.ts+生成器，镜像文件由生成器产出（对齐 ql-20260921-005 第 15 键先例）
  - 不动其余 15 键任何值
  - 禁跑全量测试
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
