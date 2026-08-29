---
id: task-09
title: frontend-connection-banner-watchdog-approval-reconnect
title_zh: 前端连接状态+看门狗+预算重置+审批重连
author: 'qinyi'
created_at: 2026-08-29 03:07:34
priority: P1
depends_on: [task-04]
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-003@v1]
allowed_paths:
  - frontend/src/lib/daemon.ts
  - frontend/src/lib/agent-stream.ts
  - frontend/src/components/permissions/session-permission-panel.tsx
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/components/daemon/__tests__/session-panel-connection.test.tsx
goal: >
  前端断线可见可自愈——streamSession 外露连接状态回调驱动 session-panel 断线/恢复横幅、
  running 轮 90s 看门狗对账兜底（不伪造终态）、run 流成功事件重置重试预算、
  审批面板 SSE 无限退避重连（design A6，D-003 前端回显范围）。
implementation:
  - lib/daemon.ts streamSession 处理器类型新增可选 onStatusChange 回调，状态取值 reconnecting/reconnected/live 并携带重试次数 attempt——进入退避重连回调 reconnecting，resync 完成建连回调 reconnected，收到实时事件后转 live；既有 retryCount 退避与 resync 行为不变
  - session-panel.tsx 顶部连接横幅（复用现有离线只读横幅样式位与主题 token）——断开重连中 warning 色显示第 N 次尝试，恢复同步中 success 色 2s 后自动消失；由 onStatusChange 驱动本地态
  - session-panel.tsx 运行轮看门狗——turn running 且 90s 无新日志/SSE 事件时调 getAgentSession 与 listSessionRuns 对账一次；连续 3 轮（30s 间隔）仍 running 且 SSE 处于断开态时显示本轮长时间无响应正在与平台核对提示（accent 色）；对账发现 run 已终态则走既有 resync 路径刷新轮次，不本地伪造终态
  - agent-stream.ts 收到任一成功事件即把 retryCount 重置为 0——修复 5 次耗尽永久停连，预算重置后可恢复连流；disconnect 归零语义保持
  - session-permission-panel.tsx SSE 断线套用列表事件流的无限退避重连模式（subscribeAgentSessionsEvents 先例，共享 RECONNECT_BACKOFF_MS）——替换 onerror 空处理仅靠 refetchInterval 兜底的现状；重连成功后补拉 dialogs 列表
  - 新增 session-panel-connection.test.tsx——覆盖横幅出现与消失时序、看门狗触发对账且不改终态语义、run 流预算重置、审批面板重连补拉
acceptance:
  - 断线期间重连中横幅出现（含第 N 次尝试），恢复后横幅切 success 并 2s 自动消失（用例断言时序）
  - 看门狗用例——90s 无事件触发一次对账 API 调用；对账发现终态走 resync 刷新且未本地伪造终态
  - run 流收到成功事件后 retryCount 归零可再次连流（预算重置用例）；审批面板 SSE 断开后按退避自动重连且重连成功补拉 dialogs
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-panel-connection.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不伪造终态——看门狗只做对账与提示，终态一律以 backend 数据刷新为准（session-panel 既有语义）
  - streamSession 既有退避/resync/去重行为语义不变，仅外露状态回调；不做 SSE 协议层改造（非目标）
  - 横幅与提示复用现有横幅样式位与主题 token（原型②③④），不新增设计系统元素、不动消息组件内存态（D-003 范围外）
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
