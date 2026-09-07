---
id: task-01
title: 'backend-ws-message-contract'
title_zh: 'backend WS 消息契约（protocol.py 两条 MSG 常量 + ws_hub.py 两个 send 方法）'
author: 'qinyi'
created_at: 2026-09-04 22:40:15
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/protocol.py
  - backend/app/modules/daemon/ws_hub.py
goal: >
  为冲突裁决与 ghost 清理建立 backend 侧 Server→Daemon WS 下发契约——protocol.py 两条
  MSG 常量加 ws_hub.py 两个照 send_sillyspec_update 先例的 fire-and-forget 发送方法，
  供 task-02 端点调用、task-05 daemon 对端逐字消费。
implementation:
  - protocol.py：在 DAEMON_MSG_SILLYSPEC_UPDATE 先例（约 protocol.py:90）之后新增 DAEMON_MSG_SILLYSPEC_RESOLVE（值 daemon:sillyspec_resolve）与 DAEMON_MSG_SILLYSPEC_GHOST_CLEANUP（值 daemon:sillyspec_ghost_cleanup）两条 Server→Daemon 常量，带同款方向注释块——注明 fire-and-forget 无回执、结果经心跳 sillyspec_command_result 回传（链路归 task-03 与 task-06）、旧 daemon default 仅 warn 向后兼容、与 sillyhub-daemon/src/protocol.ts MSG 逐字对齐
  - ws_hub.py：紧邻 send_sillyspec_update（约 ws_hub.py:411-424）新增 send_sillyspec_resolve(daemon_id, change, strategy) 与 send_sillyspec_ghost_cleanup(daemon_id) 两个 async 方法，均照先例走 send_to_runtime（锁内 10s 发送超时、失败或超时逐出连接、返回 bool，见 ws_hub.py:157-196）——resolve 组装含 change 与 strategy 两键的 payload，ghost_cleanup 发空 payload；change 格式与 strategy 合法值（keep_local 与 take_platform 下划线字面量）校验归调用方端点（task-02），ws_hub 只透传不重复校验
acceptance:
  - 两条常量字符串 daemon:sillyspec_resolve 与 daemon:sillyspec_ghost_cleanup 和 design.md §7 WS 消息定义逐字一致，注释块标明 Server→Daemon 方向与 fire-and-forget 语义
  - 两个 send 方法均复用 send_to_runtime 并返回 bool，payload 组装正确（resolve 带 change 与 strategy，ghost_cleanup 为空对象），不新增连接管理逻辑；daemon 模块既有测试零回归、ruff 无新告警
verify:
  - cd backend && uv run pytest app/modules/daemon -q --no-cov -n auto
  - cd backend && uv run ruff check app/modules/daemon
constraints:
  - 本任务只加常量与发送方法，不加独立测试——契约与端点行为测试归 task-04（test_sillyspec_platform_commands.py）
  - 不动 router.py 端点（归 task-02）、不动 send_to_runtime 本体与连接管理、不动 sillyspec_update 既有路径；不建命令队列表、不加 ack 重试（D-001@v1）
  - strategy 值域为 keep_local 与 take_platform 下划线字面量，映射 CLI 中划线 flag（--keep-local 与 --take-platform）归 daemon 侧 task-06 单点实现，backend 不做映射
provides:
  - contract: SillySpecResolveCommand
    msg_type: 'daemon:sillyspec_resolve'
    fields: [change, strategy]
    sender: send_sillyspec_resolve 方法（daemon 实例 id、change、strategy 三参，返回 bool）
  - contract: SillySpecGhostCleanupCommand
    msg_type: 'daemon:sillyspec_ghost_cleanup'
    fields: []
    sender: send_sillyspec_ghost_cleanup 方法（daemon 实例 id 单参，返回 bool）
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
