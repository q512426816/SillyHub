---
id: task-08
title: '前端会话页 reconnecting 本地计时>240s 显示"重新开启"入口（复用 handleReopen）；409 提示中文化；OpenAPI schema 变更则跑 pnpm gen:types 提交 api-types.ts + openapi.json'
title_zh: '前端会话页 reconnecting 本地计时>240s 显示"重新开启"入口（复用 handleReopen）；409 提示中文化；OpenAPI schema 变更则跑 pnpm gen:types 提交 api-types.ts + openapi.json'
author: 'qinyi'
created_at: 2026-08-21 11:55:44
priority: P1
depends_on: [task-03]
blocks: []
requirement_ids: [FR-09, NFR-01]
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/sessions/page.tsx
  - frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
goal: >
  DS-5/DS-8 前端侧（FR-09）：reconnecting 卡死 >240s 的会话在详情页显示
  "重新开启"入口（复用 handleReopen），后端 409 提示中文化；task-03 若改
  OpenAPI 则 gen:types 产物同步提交，不让类型落后后端（NFR-01）。
expects_from:
  task-03:
    - contract: SessionRuntimeRequest
      needs: [lease_id]
      note: task-03 落地后 SessionRuntimeRequest 含可选 lease_id 进 OpenAPI（backend/openapi.json dump），本卡据此跑 pnpm gen:types 再生成 api-types.ts，双产物提交无漂移
implementation:
  - sessions/page.tsx 本地计时——进入 restoring（status pending/reconnecting，:517）时以 Date.now() 起算（锚点存 ref/state），status 离开 reconnecting（active/ended/failed）即清零重置；驱动重渲染用秒级 interval 或复用页面既有轮询 tick（组件卸载清理，不新增常驻定时器泄漏）
  - 显示条件——status === "reconnecting" 且本地计时 > 240_000ms（240s = 后端 180s 窗口 + 60s 缓冲，保证按钮出现时后端必已放行，DS-5）→ 在 ended/failed 横幅同位置（:1010-1019）渲染同款"重新开启"入口，onClick 复用既有 handleReopen（:746，含 reopening loading 与 invalidateQueries 刷新），不复制回调；横幅渲染条件改为 ended || reconnecting 超时二者其一，超时场景文案区分（如"会话恢复超时"），ended 横幅既有文案不动
  - 409 中文化——查证现状，errMessage（frontend/src/lib/errors.ts）默认透传 err.message，而 reopen 409 的后端 message 为英文原文（如 DaemonSessionNotActive "Session ... use inject instead of reopen."）；errors.ts 不在本卡 allowed_paths → 在 page.tsx 内加小映射表 ApiError.code → 中文文案——HTTP_409_DAEMON_SESSION_NOT_ACTIVE（窗口内重开，如"会话仍在恢复中，请稍后再试"）、HTTP_409_DAEMON_SESSION_NO_AGENT_SESSION（如"该会话缺少恢复凭证，无法重新开启"）、HTTP_409_DAEMON_SESSION_RESUME_UNSUPPORTED（如"该会话类型不支持重新开启"）、HTTP_409_DAEMON_OFFLINE（如"执行代理当前不在线，请先启动 daemon 后重试"）、以及 task-04 新增的 cwd 空 409 码（以 task-04 实际落地错误码为准补一行）；handleReopen 的 notify.error(err, "重新开启失败") 前先查映射，命中用中文文案，未命中回退现有 errMessage 行为
  - gen:types（NFR-01，CLAUDE.md 规则 21）——若 task-03 已给 SessionRuntimeRequest 加可选 lease_id（进 OpenAPI），先确认 node_modules 健康（cd frontend && pnpm exec tsc --version 能跑、.bin 有 shim；坏则 pnpm install --force 修），再 cd frontend && pnpm gen:types，提交 frontend/src/lib/api-types.ts + backend/openapi.json 两产物；api-types.ts 禁止手写
  - __tests__/page.test.tsx 补用例（风格照抄 :435 既有 ended 横幅用例 + vi.useFakeTimers 推进计时）——①status=reconnecting 且计时 >240s → 出现"重新开启"按钮且点击触发 reopenSession mock；②<240s 不出现；③恢复成功（status 变 active）后入口消失且计时重置；④reopen 409（如 HTTP_409_DAEMON_SESSION_NOT_ACTIVE）notify 文案为映射表中文而非后端英文原文
acceptance:
  - reconnecting 本地计时 >240s 显示"重新开启"入口，<240s 不显示；离开 reconnecting 后入口消失、计时重置不残留
  - 后端 409（含窗口内二次重开 NOT_ACTIVE）提示为中文文案，不再透传英文原文
  - gen:types 无漂移——pnpm gen:types:check 通过；schema 有变时 api-types.ts 与 backend/openapi.json 一并提交
  - 既有 sessions 页测试（ended 横幅/重开按钮用例 :435）零回归
verify:
  - cd frontend && pnpm test -- sessions
  - cd frontend && pnpm lint
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm gen:types:check（task-03 有 schema 变更时必跑）
constraints:
  - 240s 是前端本地判断（后端 180s 为权威校验，DS-5）——不加 DTO 字段、不改后端代码；backend/openapi.json 仅作为 gen:types 产物提交
  - handleReopen 复用不复制（ended 与超时两处入口同一回调）；错误映射表收敛在 page.tsx 内，不动 frontend/src/lib/errors.ts（不在 allowed_paths，要提升为全局映射另开 change）
  - api-types.ts 只允许 gen:types 生成（CLAUDE.md 规则 21）；gen:types 暴露的与本次改动无关的旧测试债按惯例顺手补字段修好，不为躲报错改回手写
  - 横幅/按钮样式沿用页面现有类名与双主题 token（CLAUDE.md 规则 20），不引入新 UI 组件
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
