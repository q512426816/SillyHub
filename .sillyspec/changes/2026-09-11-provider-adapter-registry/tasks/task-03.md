---
id: task-03
title: '硬编码收口六处——daemon 热切换/清理/孤儿清扫 + persistence 两处 + session-manager reload 门控改读元数据'
title_zh: '硬编码收口六处——daemon 热切换/清理/孤儿清扫 + persistence 两处 + session-manager reload 门控改读元数据'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-12 00:00:07
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/interactive/session-manager.ts
  - sillyhub-daemon/src/interactive/session-manager/persistence.ts
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  把 daemon/persistence/session-manager 六处 codex/pi 硬编码判断（daemon 热切换门控、
  per-session 目录清理、孤儿清扫 + persistence restore 外层门控、codex 探测 + session-manager
  reload 合并块门控）收口为读聚合表元数据（adapter 的 fileSettings 是否 writer、perSessionDir），
  新引擎接入不再需要记得改这六处（FR-03，design Wave 2 六处逐条）。
implementation:
  - daemon.ts:7815 热切换尽力重写门控——现 if (agentKind !== 'codex' && agentKind !== 'pi') 改为查聚合表 INTERACTIVE_PROVIDERS[agentKind]?.fileSettings 是否为 writer（条目存在且 fileSettings 非 none 声明形态）；claude/cursor/未知 kind（表无条目）零动作，与原判断逐类等价
  - daemon.ts:4735 _cleanupProviderFileDirs——目录清单（:4737-4740 硬编码 join(root,'codex',sessionId) 与 join(root,'pi',sessionId)）改为遍历聚合表 perSessionDir 非 none 条目派生同一路径集
  - daemon.ts:4768 _sweepOrphanProviderFileDirs——孤儿清扫清单（:4774 硬编码 ['codex','pi']）同样改由聚合表 perSessionDir 派生（漏改则新引擎残留目录永不清，Grill 发现）
  - persistence.ts:337 restore 外层门控（provider === 'codex' || 'pi'）改读 INTERACTIVE_PROVIDERS[state.provider]?.fileSettings 是否 writer；:353 codex 专属 stat 探测分支的目录类型判定改读 perSessionDir === 'codex'（保持仅 codex 探测语义——pi 无目录历史；stat/mirrorCodexHostAuth/CODEX_HOME 注入探测体不动）
  - session-manager.ts:1825 一带 _reloadSessionNow 合并块门控（state.provider === 'codex' || 'pi'）改读同款元数据（漏改则新引擎 reload 丢文件层 env）；块内 codex 迁移钩子（:1831-1841 migrateCodexThreadFromHost）为 per-engine 差异，按 design 非目标保留原样
  - import 来源与不变项——daemon.ts 追加自 './interactive/providers.js'（:173 已有 getProviderCaps 导入先例）、persistence.ts 与 session-manager.ts 自 '../providers.js'；daemon.ts:4707 _noteProviderFileDirs 登记键保持不变（env 键名 CODEX_HOME/PI_CODING_AGENT_DIR 仍是唯一事实源，本条为核对项无代码改动）
acceptance:
  - 六处门控/目录清单全部改读聚合表元数据后，daemon.ts、persistence.ts、session-manager.ts 三文件中上述六处的 'codex'/'pi' kind 判断字面量 grep 归零；残留字面量仅允许——聚合表 providers.ts 本体、写盘器本体（codex-settings/pi-settings/provider-file-settings）、env 键名（CODEX_HOME/PI_CODING_AGENT_DIR）、per-engine 差异逻辑（persistence.ts:82 executable 落盘分支、session-manager.ts:1832 codex 迁移钩子、claude 迁移分支）
  - 既有套件全绿零漂移——session-recovery、session-manager-config-switch、session-manager-reload-provider、daemon-provider-config-changed-handler 四套件（另跑 daemon-provider-session-dir-lifecycle、provider-file-settings-reload 加固目录链路）；行为逐类等价（claude/cursor/未知零动作，codex/pi 路径不变）
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/session-recovery.test.ts tests/interactive/session-manager-config-switch.test.ts tests/interactive/session-manager-reload-provider.test.ts tests/daemon-provider-config-changed-handler.test.ts tests/daemon-provider-session-dir-lifecycle.test.ts tests/provider-file-settings-reload.test.ts
  - grep -n "'codex'\\|'pi'" sillyhub-daemon/src/daemon.ts sillyhub-daemon/src/interactive/session-manager.ts sillyhub-daemon/src/interactive/session-manager/persistence.ts 按验收白名单核对残留
constraints:
  - 行为零漂移——claude/cursor/未知 kind 逐类等价零动作，codex/pi 路径行为不变，不改任何既有测试预期
  - 仅改六处判定表达式的数据来源，不动函数结构与 per-engine 差异逻辑（codex 迁移/镜像、claude settings 链路——design 非目标，不塞成接口方法）
  - _noteProviderFileDirs 登记键不动（env 键名仍是唯一事实源）
  - 聚合表查不到条目（未知 kind）视同非 writer 与 perSessionDir none
expects_from:
  - task-01: 聚合表元数据——INTERACTIVE_PROVIDERS 条目的 fileSettings（writer 或显式 none）与 perSessionDir（codex/pi/none）
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
