---
id: task-04
title: 'restore 自愈——persistence.ts 恢复路径 codex/pi 注文件层 env + codex null per-session 目录探测修法'
title_zh: 'restore 自愈——persistence.ts 恢复路径 codex/pi 注文件层 env + codex null per-session 目录探测修法'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-11 18:57:36
priority: P0
depends_on: ['task-02', 'task-03']
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager/persistence.ts
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  修复 daemon 重启恢复链路的供应商丢失缺口——restoreAndReconnect 对 codex/pi 会话同样经
  ForReload 写盘 + 注文件层 env（providerConfig 非 null 时），并对 providerConfig 为空但
  确定性 per-session codex 目录存在的会话按 null 切换语义镜像 + 注 CODEX_HOME，使切换后
  daemon 重启不静默回宿主凭证、codex thread 历史不丢（FR-01/FR-02，Grill 附带发现收编）。
implementation:
  - persistence.ts restoreAndReconnect 在 restoreEnv=buildSpawnEnv（:290-300）构造之后、applyTranscriptConfigDir（:314）之前，对 state.provider 为 codex 或 pi 增文件层恢复块——await applyProviderFileSettingsForReload(入参 sessionKey=state.sessionId, provider=state.providerConfig ?? null, daemonApiKey=mgr.deps.daemonApiKey ?? null, priorEnv=undefined)，Object.assign(restoreEnv, fileEnv)（providerConfig 非 null 即重写 per-session 目录 + 注 CODEX_HOME/PI_CODING_AGENT_DIR；priorEnv 传 undefined = 恢复时无旧 env 快照，IO 失败兜底返空对象降级 = 按宿主现状运行，error 可归因——R-05 落地点）
  - codex null 目录探测修法（Grill 复审 P2-3）——state.provider 为 codex 且 state.providerConfig 为空时 stat 确定性目录 join(daemonStateDir(), 'codex', state.sessionId)（需从 ../../config.js 补 daemonStateDir import）：目录存在 → 按 null 切换语义处理，await mirrorCodexHostAuth(codexHome) 幂等重镜像 + restoreEnv 注 CODEX_HOME=codexHome（persistence 仅落盘非 null providerConfig，null 切换会话恢复按此探测保住 thread 历史，否则新进程回宿主 CODEX_HOME 找不到 thread 必断）；目录不存在 → 零动作，行为与现状逐字一致
  - pi null 恢复不适用（null=回宿主即语义本身，pi 历史在 daemon 自管 --session-dir 不丢）；claude 恢复链路零变化（record.providerConfig 落盘语义、claude 迁移块 :301-313、applyTranscriptConfigDir 均逐字不动）
  - 恢复失败收敛语义不变——ForReload 绝不抛，文件层块不进既有 catch（catch 仍只收敛 driver.start 失败路径的 store 删除 + onSessionEnd failed），恢复主路径不因文件层降级而 fail
acceptance:
  - 带 providerConfig 的 codex 会话恢复后 restoreEnv / state.env 带新写 CODEX_HOME，daemonStateDir()/codex/<sessionId> 下 auth.json / config.toml 按持久化供应商配置重写
  - 带 providerConfig 的 pi 会话恢复后自定义端点带 PI_CODING_AGENT_DIR、官方端点不带（对齐 spawn 路径产物语义）
  - providerConfig 为空的 codex 会话且确定性 per-session 目录存在 → 恢复触发 mirrorCodexHostAuth 且 env 注该目录 CODEX_HOME（幂等重镜像无害）；目录不存在 → 零动作、恢复行为逐字同现状
  - claude 会话恢复 env 逐字不变，既有 session-recovery / resume-config-dir / resume-fallback 套件不改预期全绿
  - ForReload 写盘失败（providerConfig 非 null）时恢复不 fail，env 不带文件层键（空对象降级），error 日志可归因
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
  - cd sillyhub-daemon && pnpm vitest run tests/interactive/session-recovery.test.ts tests/interactive/session-manager-resume-config-dir.test.ts tests/interactive/session-manager-resume-fallback.test.ts（claude 恢复链路零漂移；新增 restore 四态用例归 task-06）
constraints:
  - 仅 persistence.ts 一个文件；不改 session-manager.ts（reload 侧归 task-03）、不改 provider-file-settings.ts / codex-settings.ts（helper 归 task-02）
  - claude 恢复链路与 pi null 恢复逐字不变；ForReload 失败兜底（返空对象降级）由 task-02 提供，本卡不重复实现
  - daemonApiKey 经 mgr.deps.daemonApiKey 消费（task-03 provides 的 SessionManagerDeps.daemonApiKey 字段），不引入第二传递通道
  - 不在本卡加测试（restore 四态用例归 task-06 统一收口）
  - CLAUDE.md 规则 0——禁止跑全量测试，仅跑本卡相关套件
expects_from:
  task-02:
    - contract: reload 文件层分派与 codex 宿主镜像 helper
      needs: [applyProviderFileSettingsForReload, mirrorCodexHostAuth]
  task-03:
    - contract: SessionManagerDeps.daemonApiKey
      needs: [daemonApiKey]
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
