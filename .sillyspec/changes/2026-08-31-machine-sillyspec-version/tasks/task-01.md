---
id: task-01
title: 'backend 协议与 WS 通道——protocol.py `DAEMON_MSG_SILLYSPEC_UPDATE` + ws_hub.send_sillyspec_update + backend 契约测试（test_protocol_session_contract.py EXPECTED map；TS 镜像测试归 task-05）'
title_zh: 'backend 协议与 WS 通道——protocol.py `DAEMON_MSG_SILLYSPEC_UPDATE` + ws_hub.send_sillyspec_update + backend 契约测试（test_protocol_session_contract.py EXPECTED map；TS 镜像测试归 task-05）'
author: 'qinyi'
created_at: 2026-08-31 08:31:16
priority: P0
depends_on: []
blocks: []
requirement_ids: [NFR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/protocol.py
  - backend/app/modules/daemon/ws_hub.py
  - backend/tests/modules/daemon/test_protocol_session_contract.py
goal: >
  backend 侧新增 WS 消息通道 daemon:sillyspec_update（协议常量 + ws_hub 发送方法 + 契约测试），
  为 task-03 的 REST 端点与 task-05 的 daemon 侧字面量对齐打协议地基——NFR-01 协议纪律（先改 backend）。
implementation:
  - protocol.py 仿 DAEMON_MSG_CLEANUP（:82）加 DAEMON_MSG_SILLYSPEC_UPDATE = "daemon:sillyspec_update"（Server→Daemon，注释注明 fire-and-forget 同 CLEANUP）
  - ws_hub.py 仿 send_cleanup（:392）加 async def send_sillyspec_update(daemon_id) -> bool——payload {}，message {"type": DAEMON_MSG_SILLYSPEC_UPDATE, "payload": {}}，走 send_to_runtime
  - backend/tests/modules/daemon/test_protocol_session_contract.py 的 EXPECTED map 加 sillyspec_update 条目（该测试无总数断言，安全；TS 镜像在 task-05）
acceptance:
  - DAEMON_MSG_SILLYSPEC_UPDATE 字面量逐字等于 "daemon:sillyspec_update"
  - send_sillyspec_update 对在线连接返回 True、离线 False（测试覆盖或复用 send_cleanup 同款测试模式）
  - test_protocol_session_contract.py 全绿且含新字面量断言
verify:
  - cd backend && uv run pytest tests/modules/daemon/test_protocol_session_contract.py -q --no-cov
constraints:
  - 只做协议常量 + ws_hub 方法 + backend 契约测试；不动 router 端点（task-03）、不动 daemon 侧 protocol.ts（task-05）
  - 字面量必须与 design.md 接口定义逐字一致（daemon:sillyspec_update）
provides:
  - contract: SillySpecUpdateChannel
    fields: [DAEMON_MSG_SILLYSPEC_UPDATE, send_sillyspec_update]
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
