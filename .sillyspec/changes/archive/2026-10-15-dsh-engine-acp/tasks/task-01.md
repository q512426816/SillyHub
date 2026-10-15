---
id: task-01
title: 'daemon 探测与版本门——agent-detector.ts 第 13 项（bin=dsh / SILLYHUB_DSH_PATH / versionPattern / minVersion=0.2.1 / protocol=''json_rpc''）+ version.ts MIN_VERSIONS 加 dsh [0,2,1]，附探测单测（D-001/D-002 → FR-01）'
title_zh: 'daemon 探测与版本门——agent-detector.ts 第 13 项（bin=dsh / SILLYHUB_DSH_PATH / versionPattern / minVersion=0.2.1 / protocol=''json_rpc''）+ version.ts MIN_VERSIONS 加 dsh [0,2,1]，附探测单测（D-001/D-002 → FR-01）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 12:45:27
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/agent-detector.ts
  - sillyhub-daemon/src/version.ts
  - sillyhub-daemon/tests/agent-detector.test.ts
  - sillyhub-daemon/tests/version.test.ts
target_files:
  - sillyhub-daemon/src/agent-detector.ts
  - sillyhub-daemon/src/version.ts
  - sillyhub-daemon/tests/agent-detector.test.ts
  - sillyhub-daemon/tests/version.test.ts
goal: >
  注册 dsh 的二进制探测与版本门：agent-detector 第 13 项（env 覆盖→PATH→不可用）+ MIN_VERSIONS 最低版本警告，让 daemon 能发现并校验本机 dsh（D-001/D-002）。
implementation:
  - sillyhub-daemon/src/agent-detector.ts 的 AGENT_DEFS 追加 dsh 条目：bin='dsh'、envPath='SILLYHUB_DSH_PATH'、versionPattern 匹配 dsh --version 输出（形如 0.2.x）、minVersion='0.2.1'、protocol='json_rpc'（AgentProtocol 六字面量之一）
  - sillyhub-daemon/src/version.ts 的 MIN_VERSIONS 追加 dsh 条目（SemVerTuple 数组 [0, 2, 1]，对齐既有四引擎条目写法）
  - sillyhub-daemon/tests/agent-detector.test.ts 补 dsh 用例：SILLYHUB_DSH_PATH 覆盖优先于 PATH；探测不到 → 不可用；--version 输出解析
  - sillyhub-daemon/tests/version.test.ts 补 dsh 版本门用例：0.2.1 放行无警告、0.2.0 警告不硬拒（文案与既有 checkMinVersion 输出格式一致）
acceptance:
  - AGENT_DEFS 含 dsh 项且五字段齐（bin/envPath/versionPattern/minVersion/protocol）
  - MIN_VERSIONS 含 dsh [0,2,1]；低版本仅警告不阻断（与四引擎同语义）
  - 两个测试文件新用例全绿，既有用例零回归
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/agent-detector.test.ts tests/version.test.ts
constraints:
  - 不做硬拒分支（D-002）；不加运行时依赖（零依赖先例 agent-detector.ts G-05）
  - 二进制路径注入链不改（_agentPaths 自动流转，daemon.ts:3338/:8424 既有机制）
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
