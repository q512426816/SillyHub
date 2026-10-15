---
id: task-01
title: 'daemon 探测与版本门——agent-detector.ts 探测项（bin=zcode / SILLYHUB_ZCODE_PATH / protocol=''ndjson'' / fallbackPaths Desktop 路径 / execNode .cjs 经 node）+ AgentProviderSpec 扩展可选 fallbackPaths/execNode 字段 + version.ts MIN_VERSIONS 加 zcode (0,16,9)，附探测单测（D-001/D-004 → FR-01）'
title_zh: 'daemon 探测与版本门——agent-detector.ts 探测项（bin=zcode / SILLYHUB_ZCODE_PATH / protocol=''ndjson'' / fallbackPaths Desktop 路径 / execNode .cjs 经 node）+ AgentProviderSpec 扩展可选 fallbackPaths/execNode 字段 + version.ts MIN_VERSIONS 加 zcode (0,16,9)，附探测单测（D-001/D-004 → FR-01）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 13:50:04
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-004@v1]
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
provides:
  - AgentProviderSpec 可选字段 fallbackPaths/execNode（探测扩展契约，task-04 驱动依赖 exePath 发现结果）
  - _agentPaths 'zcode' 条目（task-04 消费）
expects_from: []
goal: >
  daemon 能发现 ZCode 引擎（env 覆盖 → PATH → Desktop 固定路径三段式）并把版本纳入警告门，
  为驱动提供二进制路径。zcode 是 .cjs 内嵌引擎（非 PATH bin），需要 spec 扩展支撑。
implementation:
  - sillyhub-daemon/src/agent-detector.ts:52-64 AgentProviderSpec 加可选 readonly fallbackPaths?:string[] 与 readonly execNode?:boolean 两字段
  - 探测优先级链（agent-detector.ts:37-46 现有 env → which → 不可用）插入 fallbackPaths 段：env 命中 → PATH which 命中 → fallbackPaths 逐条展开平台变量（%LOCALAPPDATA%/$LOCALAPPDATA）后 fs.existsSync 判定 → 不可用；execNode=true 时版本探测命令为 [process.execPath, path, '--version']（普通项保持现状 bin --version）
  - 注册 zcode 探测项：bin='zcode'、envPath='SILLYHUB_ZCODE_PATH'、protocol='ndjson'（AgentProtocol 现有枚举，agent-detector.ts:42-46）、versionPattern 匹配 `zcode <semver>` 输出、minVersion=[0,16,9]、fallbackPaths=['%LOCALAPPDATA%/Programs/ZCode/resources/glm/zcode.cjs']、execNode=true
  - sillyhub-daemon/src/version.ts:44 MIN_VERSIONS 加条目 zcode＝[0,16,9]（低于输出与四引擎同格式警告，checkMinVersion 语义不动）
  - 单测：三段式命中/全 miss 不可用/fallbackPaths 平台变量展开/execNode 版本探测命令形态/MIN_VERSIONS 新条目警告文案
  - 连带守护断言更新：sillyhub-daemon/tests/agent-detector.test.ts 精确断言随第 13 探测项同步（:92 toHaveLength(12)→13、:119 键表加 zcode、:347/363/372/775/795 结果数与 unavailable 计数）
acceptance:
  - SILLYHUB_ZCODE_PATH 指向假想路径时探测命中并解析版本；无 env 无 PATH 但 fallbackPaths 文件存在时命中（Windows 实例路径）
  - 三段全 miss → zcode 不在可用引擎列表；既有探测行为断言语义零变化（仅计数/键表精确断言同步加 zcode）
  - 版本低于 0.16.9 时返回与 claude/codex 同格式警告文本（非硬拒）
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/agent-detector.test.ts tests/version.test.ts
constraints:
  - 不改动现有 12 探测项的任何行为（纯增量）
  - 不引入 npm 依赖；Windows/Linux/macOS 三平台路径兼容
  - 探测器不 spawn 常驻进程（仅 --version 一次性执行）
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
