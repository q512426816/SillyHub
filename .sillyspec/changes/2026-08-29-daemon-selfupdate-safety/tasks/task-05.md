---
id: task-05
title: 'daemon 心跳携带 pending_update（hub-client 可选参数+组装注入）（depends_on: task-03, task-04）'
title_zh: 'daemon 心跳携带 pending_update（hub-client 可选参数+组装注入）（depends_on: task-03, task-04）'
author: 'qinyi'
created_at: 2026-08-29 15:04:03
priority: P0
depends_on: [task-03, task-04]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-004@v1]
expects_from:
  task-03:
    - contract: DiskProbeAndPending
      needs: [writePendingUpdate]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/tests/daemon-heartbeat-pending.test.ts
goal: >
  daemon 心跳请求体携带可选 pending_update 字段（仅推迟期间携带），
  把 task-03/04 记录的 pending 状态经心跳透传给 backend（design S3 可见性链
  daemon 侧出口）；无 pending 不带该键保证旧 backend 兼容、既有 3 参调用零破坏。
implementation:
  - hub-client.ts heartbeat（约 621 行，现有 daemonLocalId/providers/startedAt 三个位置参数）追加第 4 个可选位置参数 pendingUpdate（reason/current_version/target_version 三字段对象），HeartbeatBody 增可选 pending_update 字段；body 组装仅该参数非空时携带，undefined 时键完全不出现
  - daemon.ts _sendHeartbeatOnce（约 2811 行；2263 行附近是 run-result 组装勿动）在调 _client.heartbeat 处读当前 pending 注入第 4 参——读法取其一（依 task-03 实际产物定）——task-03 提供读取口则用之；未提供则 daemon.ts 持有 pending 内存态引用（与 task-04 写入同源）
  - 新增 tests/daemon-heartbeat-pending.test.ts——pending 期心跳 body 含 pending_update 三字段；无 pending 心跳 body 无该键；不传第 4 参时请求体与现状逐字段一致
acceptance:
  - pending 期心跳请求体含 pending_update 且 reason/current_version/target_version 齐全（reason 取 server_command 或 disk_change）
  - 无 pending 时心跳请求体不含 pending_update 键（旧 backend 兼容；与 task-06「无字段=清除」语义对齐）
  - hub-client.test.ts 零改动通过——既有 3 参调用与请求体组装零破坏
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/daemon-heartbeat-pending.test.ts tests/hub-client.test.ts
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 第 4 参数必须可选且追加在末位，不改既有 3 参签名与顺序（design S3 兼容约束）
  - 仅 pending 期携带，禁止空对象或 null 兜底（无字段即清除，勿破坏 task-06 约定）
  - 不动 heartbeat 响应处理（pending_controls 补拉等既有逻辑不变）；pending 写入归 task-03/04 本卡只读
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
