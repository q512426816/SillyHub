---
id: task-07
title: 'change-write WS 推送 daemon 侧（protocol.ts 对齐+分发+独立 120s 兜底）+ 契约测试'
title_zh: 'change-write WS 推送 daemon 侧（protocol.ts 对齐+分发+独立 120s 兜底）+ 契约测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-16 10:13:55
priority: P0
depends_on: ['task-06']
blocks: []
requirement_ids: [FR-07, FR-08]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/protocol.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/config.ts
  - sillyhub-daemon/tests/protocol.contract.test.ts
  - sillyhub-daemon/tests/config.test.ts
  - sillyhub-daemon/tests/daemon-change-write-push.test.ts
target_files:
  - sillyhub-daemon/src/protocol.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/config.ts
  - sillyhub-daemon/tests/protocol.contract.test.ts
  - sillyhub-daemon/tests/config.test.ts
  - NEW:sillyhub-daemon/tests/daemon-change-write-push.test.ts
expects_from:
  - contract: task-06.protocol
    needs: ["常量 daemon:change_write_available", "payload 含 type/runtime_id/workspace_id(可 null)"]
goal: >
  daemon 收到 change_write_available 推送立即拉取待写任务；兜底轮询独立为 120s——稳态轮询请求降 ~75%。
implementation:
  - 改 sillyhub-daemon/src/protocol.ts：加 MSG.CHANGE_WRITE_AVAILABLE='daemon:change_write_available' 与 payload 类型（与 backend task-06 逐字对齐）
  - 改 sillyhub-daemon/src/daemon.ts WS 分发：新 case 校验 runtime_id 非空（缺失 warn 丢弃，对齐 SILLYSPEC_TOMBSTONE_CLEANUP 先例）→ 调 this._pullPendingChangeWritesOnce(rid)
  - 改 sillyhub-daemon/src/config.ts：加 change_write_poll_interval 默认 120；改 sillyhub-daemon/src/daemon.ts:6169-6175 _pollLoop change-write 分支改用新间隔（lease 轮询节奏不变）
  - 改 sillyhub-daemon/tests/protocol.contract.test.ts 补双端契约用例；改 config.test.ts 补默认值用例
  - 新建 sillyhub-daemon/tests/daemon-change-write-push.test.ts：推送→立即拉取（断言 getPendingChangeWrites 被调）/缺 runtime_id warn 丢弃/无推送纯 120s 兜底（旧 backend 形态）
acceptance:
  - 收推送后立即发起拉取（测试断言调用与参数）
  - 缺 runtime_id 的非法消息 warn 丢弃不崩（盲区1 回归）
  - 无推送时 change-write 兜底轮询按 120s 独立节奏（lease 仍 30s 门控节奏）
  - pnpm typecheck 通过 + 既有 daemon 测试全绿
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm vitest run tests/daemon-change-write-push.test.ts tests/protocol.contract.test.ts tests/config.test.ts
constraints:
  - 旧 backend 兼容：无推送时纯兜底轮询行为完整
  - lease/controls 轮询节奏不动（LEASE_POLL_SKIP_MS 门控语义不变）
  - 不改 hub-client.ts（HTTP 层无变化）
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
