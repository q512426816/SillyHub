---
id: task-02
title: 'driver-factory-sessionpermission-pi-branch'
title_zh: 'driver-factory sessionPermission 注入 pi 分支 + PiStartOptions 槽位'
author: 'qinyi'
created_at: 2026-09-09 23:09:59
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-002@v1]
provides: 'sessionPermission 注入槽位——driver-factory pi 分支 + PiStartOptions.sessionPermission? 字段（requestPermission/requestUserDialog 两方法引用，形态对齐 CodexSessionPermissionHooks / D-008@v1，未注入维持现状 fail-closed）'
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager/driver-factory.ts
  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
target_files:
  - sillyhub-daemon/src/interactive/session-manager/driver-factory.ts
  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
goal: >
  在 buildDriverOptions 的 sessionPermission 注入处（driver-factory.ts L291-315，现仅 provider==='codex' 硬门控）扩展 pi 分支，并给 PiStartOptions 补 sessionPermission 可选槽位（对齐 CodexStartOptions D-008@v1 形态），为 task-01 的 pi dialog 桥接打开注入通道，本任务不实现桥接本体。
implementation:
  - pi-rpc-driver.ts 定义 PiSessionPermissionHooks（requestPermission/requestUserDialog 签名同 CodexSessionPermissionHooks 的去 sessionId 闭包形态，pi 文件内独立定义避免跨 driver 导入），PiStartOptions 增 sessionPermission? 槽位；start 仅暂存引用，不改 extension_ui_request 现有自动 cancelled 行为
  - driver-factory.ts L291-315 的 provider==='codex' 分支扩为 codex/pi 共用注入块，两方法闭包绑定 state.sessionId 调 mgr.requestPermission/mgr.requestUserDialog，块前注释补 pi 依据（本变更 Wave A / D-002@v1；claude 仍走 canUseTool/onUserDialog 不变）
  - approvalReady=false 或 provider=claude/cursor 路径零改动；providers.ts caps 表不动
  - 类型检查 + pi/session-manager 既有测试回归确认零回归
acceptance:
  - approvalReady=true 且 provider=pi 时 driver start 收到 sessionPermission，含绑定该 session 的 requestPermission/requestUserDialog 引用
  - provider=claude/cursor 及 approvalReady=false 时注入行为不变（pi 不注入）
  - 未注入 sessionPermission 的 pi driver，extension_ui_request dialog 类仍自动 cancelled（现状 fail-closed 不回归）
verify:
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/pi-rpc-driver.test.ts tests/interactive/session-manager-permission.test.ts tests/interactive/session-manager-driver-registry.test.ts
constraints:
  - 不实现 pi 桥接本体（extension_ui_request 分派/挂起表/reply 归 task-01），只开注入通道
  - 不改 SessionManager.requestPermission/requestUserDialog 签名与 claude/codex 既有注入路径
  - 不动 providers.ts caps 表（pi permission_dialog 翻真归 task-12）；不新增测试文件（四态单测归 task-04）
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
