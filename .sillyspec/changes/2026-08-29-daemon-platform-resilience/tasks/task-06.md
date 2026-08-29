---
id: task-06
title: daemon-ws-backoff-control-dispatch-reconcile
title_zh: daemon 连接韧性+控制指令消费+统一对账
author: 'qinyi'
created_at: 2026-08-29 03:07:34
priority: P0
depends_on: [task-04]
blocks: []
requirement_ids: [FR-01, FR-05]
decision_ids: [D-005@v1]
expects_from:
  task-04:
    - contract: ControlCommandItem
      needs: [id, kind, payload]
related_tests:
  - path: sillyhub-daemon/tests/ws-client.test.ts
    reason: 固定 5s 重连间隔恒等断言与重连时序用例需同步更新为退避序列与消息重置语义
allowed_paths:
  - sillyhub-daemon/src/ws-client.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/control-dispatcher.ts
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/protocol.ts
  - sillyhub-daemon/tests/ws-client.test.ts
  - sillyhub-daemon/tests/control-dispatcher.test.ts
goal: >
  给 daemon 补连接韧性——WS 指数退避重连（替换固定 5s）、register 周期重试、
  重连后统一对账（心跳→drain outbox→补拉控制指令→补拉 pending leases），
  并新增 control-dispatcher 统一消费控制指令（LRU 去重+ACK），
  实现断线窗口控制指令零丢失零重复（design A1 + A2 消费端）。
implementation:
  - ws-client.ts 将固定 5s 的 RECONNECT_INTERVAL_MS 替换为退避档位序列 1/2/4/8/16/30 秒封顶 30s，每档叠加正负 20% 随机抖动；_scheduleReconnect 按当前档位取延时；收到任何 WS 消息或 pong（_handleMessage/_handlePong 既有锚点）把档位重置回第 0 档
  - daemon.ts 心跳循环内 _registeredRuntimes 为空时不再纯 continue 跳过——按退避周期重试 _registerDaemon（15s 起步连续失败退避封顶 60s，成功清计数恢复正常心跳）；心跳成功响应读 pending_controls 计数大于 0 时触发对账第 3 步（仅补拉控制指令）
  - 新增 control-dispatcher.ts——控制指令统一消费入口，WS 推送与 HTTP 补拉共用按 kind 路由到 daemon.ts 既有 handler（SESSION_INJECT/INTERRUPT/END/RESUME、PLAN_RESPONSE、PERMISSION_RESPONSE、PROVIDER_CONFIG_CHANGED）；LRU 256 条 command_id 去重窗防「补拉在途时 WS 同条到达」竞态；处理成功与业务失败均 POST ack（毒丸指令不无限重投）；daemon.ts _handleWsMessage 控制类消息改经 dispatcher 分发
  - daemon.ts 新增 _reconcileAfterReconnect——幂等且 _reconciling 防重入，顺序固定为立即拍一次 HTTP 心跳（加速 backend 在线状态恢复）、drain outbox、经 dispatcher 补拉控制指令并 ack、补拉 pending leases（含 change-write 分支保持现状）；WS onConnected 回调由单纯 drainOutbox 换为本方法
  - hub-client.ts 新增 getPendingControls（GET pending-controls）与 ackControls（POST controls/ack）两方法（错误语义同 getPendingLeases）；protocol.ts 加控制指令 kind 常量（与 backend 控制指令表 kind 枚举逐字对齐）及心跳响应 pending_controls 类型
  - 测试——ws-client.test.ts 固定 5s 断言（RECONNECT_INTERVAL_MS 恒等 5000 用例与 5s 重连时序用例）同步更新为退避序列断言；新增 control-dispatcher.test.ts 覆盖 kind 路由/去重/ack 与补拉+WS 双通道同 command_id 只执行一次
acceptance:
  - 退避重连单测通过——档位序列、抖动区间、收到消息重置第 0 档均有断言；固定 5s 旧断言无残留
  - 补拉消息与 WS 推送同 command_id 只执行一次（LRU 去重用例）；处理成功与业务失败均发 ack
  - _reconcileAfterReconnect 幂等可重入（并发触发只跑一轮）且四步顺序固定；心跳响应 pending_controls 大于 0 也触发第 3 步
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/ws-client.test.ts tests/control-dispatcher.test.ts
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 握手超时 10s/主动关闭 5s/keepalive ping-pong 既有逻辑不动；旧 backend 无 pending-controls 端点（404/网络错）时补拉降级 warn 不崩，对账后续步骤照常
  - dispatcher 只做路由/去重/ack 不内嵌业务逻辑，handler 全部复用 daemon.ts 既有实现（R4 防 god 文件膨胀）；SELF_UPDATE 与 CLEANUP 维持现状不入消费链（非目标）
  - ws-client.test.ts 断言更新属预期失效修复——只改时序断言形态，不删减重连用例覆盖面
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
