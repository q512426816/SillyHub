---
id: task-09
title: '三端测试收口 + api-types 重新生成（backend 忙轮三分支/dispatch_now 回归、daemon codex 单测、前端组件测试、群聊零回归用例）'
title_zh: '三端测试收口 + api-types 重新生成（backend 忙轮三分支/dispatch_now 回归、daemon codex 单测、前端组件测试、群聊零回归用例）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-19 00:36:51
priority: P0
depends_on: ['task-03', 'task-05', 'task-06', 'task-07', 'task-08']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v1]
expects_from:
  task-03: 'codex 驱动 turn/steer 分支与被拒回落单测已落地（spike-01 失败豁免时按 plan 依赖列改写为 task-05~08）'
  task-05: 'SessionInjectResponse 出参 steered（OpenAPI 已含，gen:types 应生成对应字段）'
  task-06: 'QueueDispatchNowResponse 出参 dispatch_mode 三态（OpenAPI 已含，gen:types 应生成）'
  task-07: '前端引导中/已引导/终态收敛实现（page.test 断言面）'
  task-08: 'message-queue-bar ⚡ 引导语义 title 与降级标注（组件测试断言面）'
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - backend/app/modules/daemon/tests/test_session_queue.py
  - backend/app/modules/daemon/tests/test_session_queue_actions.py
  - frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx
  - frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx
  - backend/app/modules/daemon/session/service/__init__.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/tests/test_session_router.py
  - backend/app/modules/daemon/tests/test_inject_empty_prompt.py
  - backend/app/modules/daemon/tests/test_session_user_preamble.py
target_files:
  - frontend/src/lib/api-types.ts
  - backend/app/modules/daemon/tests/test_session_queue.py
  - backend/app/modules/daemon/tests/test_session_queue_actions.py
  - frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx
  - frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
goal: >
  三端测试收口与类型同步（design.md Wave C1-C3/D1 / FR-04 零回归）——api-types 重新生成纳入 steered/dispatch_mode 契约，backend 忙轮三分支与 dispatch_now 引导式回归、前端组件与页面断言同步，群聊等既有行为零回归用例守护。
implementation:
  - 前置健康检查：cd frontend && pnpm exec tsc --version 确认 node_modules 健康（CLAUDE.md 规则 21——node_modules 半坏会报假的 CSSProperties 不存在属性 / Cannot find module '@ant-design/icons' 错误，误判成代码问题）；异常先 pnpm install --force 修复再继续
  - 类型重生成：跑 pnpm gen:types 刷新 frontend/src/lib/api-types.ts（steered/dispatch_mode 等新出参入生成物），backend/openapi.json 随链刷新并一并提交（gen:types 链尾自动执行 gen-provider-caps）；核对 frontend/src/lib/daemon/sessions.ts:274 手写镜像 steered 字段（task-07 手补）与生成物语义一致不漂移
  - backend 单聊忙轮三分支用例：backend/app/modules/daemon/tests/test_session_queue.py 追加——支持引导 provider 忙轮发送走 inject（steered=true、user_input 留痕挂活跃 run、不建新 run 不 interrupt）/ 不支持 provider（cursor/未知）降级 queue_when_busy 排队现状 / 带切换维度消息维持排队或 409（既有守卫零改动断言）；同文件补群聊 @ steering 零回归用例（同一 _inject_mid_turn_into_run 入口，design.md R-05）
  - backend dispatch_now 用例：backend/app/modules/daemon/tests/test_session_queue_actions.py TestDispatchNow 追加——支持引导 provider 点 ⚡ 不再 interrupt（dispatch_mode=steered、条目留痕转挂活跃 run）/ 不支持维持 interrupt 接力（dispatch_mode=interrupted，现 test_dispatch_now_busy_prepends_and_interrupts 语义按 provider 能力分叉）/ 空闲当场派发（dispatch_mode=dispatched）；scheduled send 忙轮策略不变断言
  - 前端断言同步：frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx 断言 ⚡ 新 title「立即引导进当前轮（不打断）」与降级标注渲染；frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx 发送/排队断言随 steering 行为更新，mock 响应补 steered/dispatch_mode 字段——若暴露与本次无关的旧测试债（mock 缺字段）按惯例顺手补字段修好，不为躲报错改回手写
  - daemon codex 单测复跑：sillyhub-daemon 侧 codex-app-server-driver.test.ts 已由 task-03 落地，本 task 仅定向复跑确认仍绿不重写；收口后对照 plan 全局验收标准第 1/3/4 条自查
acceptance:
  - pnpm gen:types 后 api-types.ts 含 steered 与 dispatch_mode 字段且与后端 OpenAPI 一致，backend/openapi.json 同步提交，pnpm exec tsc --noEmit 通过
  - backend 新用例全绿——pytest 定向跑 test_session_queue.py（-k 忙轮/steering 相关）与 test_session_queue_actions.py（-k dispatch_now 相关）通过，含群聊 @ steering 零回归用例
  - 前端定向全绿——vitest 跑 message-queue-bar.test.tsx 与 page.test.tsx 通过（断言已同步新文案/新状态）
  - PROVIDER_CAPS alignment 测试通过（steering 键三端一致，task-01 产出复核）；全程未跑任何全量测试
verify:
  - cd frontend && pnpm exec tsc --version
  - cd frontend && pnpm gen:types && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/message-queue-bar.test.tsx
  - cd frontend && pnpm exec vitest run "src/app/(dashboard)/sessions/__tests__/page.test.tsx"
  - cd backend && python -m pytest app/modules/daemon/tests/test_session_queue.py -k "busy or steer or inject" -q
  - cd backend && python -m pytest app/modules/daemon/tests/test_session_queue_actions.py -k "dispatch_now" -q
  - cd backend && python -m pytest app/modules/agent/tests/test_provider_caps_alignment.py -q
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/codex-app-server-driver.test.ts
constraints:
  - 禁止跑全量测试（前端 vitest 全量/后端 pytest 全量均禁止），仅定向跑本 task 涉及文件与 -k 关键词；全量留 CI
  - api-types.ts 必须生成链产出禁手改；gen:types 前先确认 node_modules 健康（pnpm exec tsc --version），异常用 pnpm install --force 修复而非绕过
  - 非测试逻辑本身有误时禁止改测试凑通过；实现缺陷回上游 task（task-05/06/07/08）修正后重跑
  - 群聊 @ steering、停止按钮 interrupt、scheduled send、服务身份 409、排队编辑/删除/拖拽零回归——回归失败即视为实现缺陷，不放宽断言
  - 代码与命令兼容 Windows/Linux/macOS（括号路径加引号执行）
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
