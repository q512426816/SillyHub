---
id: task-03
title: 'Driver 高级语义（inject 三模式/session_started 合成/agent_settled 收敛/ui_request 取消/resume/interrupt/crash 收敛）'
title_zh: 'Driver 高级语义（inject 三模式/session_started 合成/agent_settled 收敛/ui_request 取消/resume/interrupt/crash 收敛）'
author: 'qinyi'
created_at: 2026-09-04 11:38:51
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
  - sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts
goal: >
  PiRpcDriver 高级语义：inject 三模式（prompt/steer/follow_up+images 多模态映射）、
  agent_settled turn 收敛→onTurnResult、extension_ui_request 自动取消、resume
  （--session-id/switch_session）、interrupt（abort）、streaming 状态判定
  （FR-01 / D-001@v1）。
implementation:
  - inject：非 streaming 走 prompt；streaming 走 steer（默认）/follow_up——streaming 判定参照官方 rpc-client.ts（事件流 agent_start/agent_settled 配对维护 isStreaming 状态，或 get_state 探测）；命令被拒（response success:false 如 streaming 未带 behavior）→ 转 error 事件上报不抛崩
  - 多模态：UserTurnInput.blocks image→rpc images[{type:'image',data,mimeType}]（ImageContent）；document 无通道→文本降级注明
  - agent_settled → onTurnResult（InteractiveDriverResult 结构化 usage/session_id 从 turn_end.usage+sessionId 填充）；turn_end 仅作 usage 载体不收敛（steer 队列防误拆）
  - extension_ui_request（dialog 类，阻塞至应答）→ 默认回 cancelled:true（permission_dialog=false 不死锁，rpc.md:1126-1133）
  - resume：CreateSessionInput resume 语义 → --session-id / switch_session 映射；interrupt → rpc abort（返回 boolean）
  - 测试补：三模式注入用例（mock 流式状态）/settled 收敛/usage 填充/ui_request 取消/resume 命令形状/interrupt
acceptance:
  - inject 三模式按 streaming 状态正确选择；被拒转 error 不崩
  - agent_settled 收敛且 turn_end 不重复收敛；usage/session_id 正确填充 Result
  - ui_request 默认取消（无死锁）；resume/interrupt 命令形状正确
  - tests/interactive 全绿+typecheck 零错
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/pi-rpc-driver.test.ts tests/interactive/
  - cd sillyhub-daemon && pnpm run typecheck
constraints:
  - 只在 pi-rpc-driver.ts+其测试内改（与 task-02 同文件续作）
  - 不动 SessionManager（消费侧零改动承诺）；契约差异=停下报告
  - streaming 判定实现以 rpc-client.ts 参照+注释锚定出处
expects_from:
  - task-02: PiRpcDriver 核心通道
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
