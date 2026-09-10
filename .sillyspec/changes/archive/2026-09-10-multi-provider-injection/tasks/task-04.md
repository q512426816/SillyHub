---
id: task-04
title: '热切换按会话重写 + per-session 目录生命周期'
title_zh: '热切换按会话重写 + per-session 目录生命周期'
author: 'qinyi'
created_at: 2026-09-10 23:27:51
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-009, D-011]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/tests/daemon-provider-config-changed-handler.test.ts
  - sillyhub-daemon/tests/daemon-provider-session-dir-lifecycle.test.ts
target_files:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/daemon-provider-config-changed-handler.test.ts
  - NEW:sillyhub-daemon/tests/daemon-provider-session-dir-lifecycle.test.ts
expects_from:
  task-03:
    - contract: applyProviderFileSettings
      needs: [applyProviderFileSettings, per_session_dir_layout]
provides:
  - contract: hot_switch_rewrite
    fields: [rewrite_observable, session_dir_cleanup]
goal: >
  PROVIDER_CONFIG_CHANGED 处理器（daemon.ts:7452 _routeProviderConfigChanged）扩展为对活跃会话按
  session_id 复用 task-03 分派函数精准重写 per-session 目录文件（尽力语义 D-009——CLI 进程内是否重读
  不保证），并把目录清理接入既有会话终态收口（onSessionEnd + SESSION_END WS 路径），完成 per-session
  目录全生命周期（D-011 spawn 前创建 → 活跃期重写 → 终态删除）。
implementation:
  - 热切换重写复用 applyProviderFileSettings 同一函数——保证与新会话 spawn 产物逐字一致（design D-009/D-011）
  - _routeProviderConfigChanged 取到 session 后复用 task-03 分派函数重写该会话目录（provider_config 为 null → 不重写仅记日志）；重写放 markPendingSwitch 旁路，失败 warn 不阻断（既有 catch 收敛风格）
  - session_id → 目录路径映射登记（_mcpBundleBySession 同款 Map 模式，daemon.ts:4509 一带同收口清理）
  - 会话终态清理——onSessionEnd 兜底收口（daemon.ts:4493-4513 一带）rm per-session 目录（recursive+force，幂等）；SESSION_END WS 路径经 SessionManager 终态同收口
  - batch 侧 per-task 目录清理接 TaskRunner 既有 run 收尾（无现成收尾点则 finally 尽力 rm，尽力语义）
  - 扩展 tests/daemon-provider-config-changed-handler.test.ts 断言按会话重写分派（codex/pi 两形态 + null 不重写）；新增 lifecycle 测试锁定创建→热切换重写→会话结束删除全链
acceptance:
  - 活跃会话收到 PROVIDER_CONFIG_CHANGED 后其 per-session 目录文件按新供应商重写（codex/pi 两形态各有断言），重写产物与新会话 spawn 前产物一致
  - 会话结束（end/fail/SESSION_END 三路径）后 per-session 目录被删除且映射条目清空，无泄漏
  - session 不存在/迟到消息仍走既有 warn 丢弃路径零回归；日志文案为尽力语义不含「已切换」确定性承诺（R-05）
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/daemon-provider-config-changed-handler.test.ts tests/daemon-provider-session-dir-lifecycle.test.ts && pnpm typecheck
constraints:
  - 不改 PROVIDER_CONFIG_CHANGED 协议形状与 WS 消息类型（复用既有推送，D-009）
  - 不动 task-03 分派函数本体只消费——如需签名扩展回 task-03 卡补契约
  - task-runner.ts 仅限批任务目录清理接线，不得改 spawn/分派逻辑（task-03 已定）
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
