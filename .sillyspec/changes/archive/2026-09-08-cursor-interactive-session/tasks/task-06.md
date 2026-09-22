---
id: task-06
title: 'Finish daemon registration points (cli.ts drivers wiring + session-store-persistence.ts VALID_PROVIDERS)'
title_zh: 'daemon 注册点收尾（cli.ts drivers 装配行 + session-store-persistence.ts VALID_PROVIDERS）'
author: 'qinyi'
created_at: 2026-09-08 13:00:34
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/cli.ts
  - sillyhub-daemon/src/interactive/session-store-persistence.ts
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  收尾 daemon 侧注册表覆盖不到的两处硬编码引擎清单——cli.ts drivers 装配对象加 cursor
  driver（SessionManager._getDriver 走 deps.drivers 注入而非 descriptor 的 createDriver
  工厂，不改此处则建 cursor 会话抛 UnsupportedProviderError）+ session-store-persistence.ts
  VALID_PROVIDERS 加 'cursor'（防 daemon 重启静默丢弃 cursor 本地会话记录）——注册表
  就位后 cursor 会话真正可建、可恢复（FR-04 / D-002@v1，design Wave 1 注册节收尾两点）。
implementation:
  - cli.ts 照 piDriver 先例接入——头部 import CursorDriver（./interactive/cursor-driver.js），装配区加 const cursorDriver = new CursorDriver()（对齐 L763 const piDriver = new PiRpcDriver() 形态），L807 drivers 装配对象由 { claude, codex, pi } 扩为 { claude, codex, pi, cursor }
  - cli.ts 装配处加中文注释说明依据——_getDriver 走 deps.drivers 注入、descriptor 的 createDriver 工厂不被消费，providers.ts 注册表加键而不改装配行则 cursor 会话 UnsupportedProviderError（docs/agent-provider-onboarding.md 档B 步骤 10 补充·三处硬编码必改点之一）
  - session-store-persistence.ts L85 VALID_PROVIDERS Set 加 'cursor' 成员，注释照 pi 冒烟 F-2 同坑记录——载入白名单缺 provider 会静默丢弃会话记录，daemon 本地重启恢复缺失（只能靠 backend sweep 兜底，pi 接入实证）
acceptance:
  - deps.drivers 注入 cursor driver 后，SessionManager.create provider='cursor' 经 _getDriver 命中 CursorDriver（不再 UnsupportedProviderError，与 INTERACTIVE_PROVIDERS 注册键一致）
  - daemon 重启后 cursor 会话记录可从 sessions.json 载入（VALID_PROVIDERS 含 'cursor'，不静默丢弃、不依赖 backend auto-recover 兜底）
  - pnpm -C sillyhub-daemon run typecheck 零错；provider-registry.test.ts 跑一遍不回归
verify:
  - pnpm -C sillyhub-daemon run typecheck
  - pnpm -C sillyhub-daemon exec vitest run tests/interactive/provider-registry.test.ts
constraints:
  - 只加注册不改装配结构——drivers 对象仅加 cursor 键，旧 driver 兼容入口、onTurnResult/onTurnMessage 回调、persistence 等其余 deps 一律不动
  - cli.ts 装配行注释用中文说明依据（deps.drivers 注入 vs createDriver 工厂）
  - VALID_PROVIDERS 只加成员，载入/校验/容错逻辑不动；backend InteractiveProviderLiteral 与前端两处引擎白名单不在本卡（归 task-07/08）
  - 不新增测试（装配 wiring 由 typecheck + task-05 已同步的 provider-registry 测试守护，端到端归 task-10 真机冒烟）
expects_from:
  task-04:
    - contract: CursorDriver
      needs: [CursorDriver]
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
