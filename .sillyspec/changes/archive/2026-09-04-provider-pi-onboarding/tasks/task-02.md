---
id: task-02
title: 'PiRpcDriver 核心（rpc 子进程/LF 分帧/命令收发/handle 契约/get_state 握手）'
title_zh: 'PiRpcDriver 核心（rpc 子进程/LF 分帧/命令收发/handle 契约/get_state 握手）'
author: 'qinyi'
created_at: 2026-09-04 11:38:51
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
  - sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts
goal: >
  PiRpcDriver 核心：spawn pi --mode rpc 长驻子进程 + LF 严格分帧 + JSONL 命令收发
  （id 关联）+ InteractiveDriver 契约（handle/provider='pi' E5）+ get_state 握手
  （FR-01 / D-001@v1）。
implementation:
  - 新建 pi-rpc-driver.ts：spawn（exe 路径经 resolveWindowsCmdShim 解 pi.cmd shim；args: --mode rpc --session-dir <daemon 隔离> + provider/model/thinking 透传参照 CreateSessionInput 既有链路 pathToAgentExecutable）；LF-only 分帧器自实现（逐字节 \n 切分+尾部 \r 剥离，禁 readline——U+2028/29 不合规，rpc.md 明示）
  - 命令收发：pending Map<id, {resolve,reject}>；response 带 id 关联；success:false reject（上层转 error 事件）；事件型行交 PiEventNormalizer
  - InteractiveDriver 契约对齐 driver.ts 实签名（start(input: AsyncIterable<UserTurnInput>, options)→InteractiveDriverHandle；consume(handle, callbacks)；interrupt(handle)→boolean；handle.close）——实读 driver.ts 为准
  - get_state 握手：启动后发 get_state 取 data.sessionId → 合成 status/session_started 事件（resume 指针）；握手超时对齐 codex driver 先例
  - 测试（pi-rpc-driver.test.ts）：mock 子进程（fake stdin/stdout 流回放 fixture）——握手/session_started 合成/response 关联/未知行容错/子进程非正常退出触发 onError 会话 fail
acceptance:
  - LF 分帧合规（U+2028 不切分——构造含 U+2028 的 JSON 字符串用例）
  - get_state 握手成功合成 session_started；超时/失败走 error 不挂死
  - implements InteractiveDriver 编译通过（handle.provider='pi'）
  - 既有 interactive 家族测试零回归（driver.test/session-manager 家族）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/pi-rpc-driver.test.ts
  - cd sillyhub-daemon && pnpm run typecheck
constraints:
  - 高级语义（inject 三模式/agent_settled/ui_request/resume/interrupt）归 task-03——本 task 只做通道与握手
  - 不动 SessionManager/daemon.ts/backend/前端（四承诺区）
  - spawn 参数组装参照 codex driver 先例；凭证注入走既有 spawn-env 链
expects_from:
  - task-01: PiEventNormalizer
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
