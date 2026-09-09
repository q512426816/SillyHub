---
id: task-13
title: 'three-wave live smoke acceptance and regression sweep'
title_zh: '三波真机冒烟验收（pi 一问一答同轮 / cursor 标记全流程 / 群聊聚合答题）'
author: 'qinyi'
created_at: 2026-09-09 23:09:21
priority: P0
depends_on: ['task-04', 'task-07', 'task-08', 'task-11']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-002@v1, D-003@v2, D-004@v2]
allowed_paths:
  - .sillyspec/changes/2026-09-09-askuser-pi-cursor/smoke-result.md
target_files:
  - NEW:.sillyspec/changes/2026-09-09-askuser-pi-cursor/smoke-result.md
goal: >
  按 plan.md 全局验收标准对三波（pi 桥接 / cursor 标记 / 群聊聚合）做真机冒烟与
  相关套件回归，逐项记录验收结果到 smoke-result.md，作为变更收口证据（不改产品代码）。
implementation:
  - 真机 pi 会话冒烟：触发一次需澄清提问 → 会话面板弹原生提问卡 → 用户作答 → pi 同轮继续执行（验证 FR-01/FR-02 桥接闭环与会话中止兜底不误触发）
  - 真机 cursor 会话冒烟（仅 task-05 spike go 时）：诱导标记提问 → 前端 marker 卡渲染 → 提交答案作为下一条用户消息发送 → --resume 续答（验证 FR-03/FR-04）
  - 真机群聊冒烟：成员 agent（claude 或 pi）pending 原生卡在群聊流聚合渲染 → 非群主成员作答成功且 answered_by 归属正确 → 另一成员后答见「已被 ×× 回答」关闭态 → 非群成员账号 404（验证 FR-05 + R-08）
  - 跑本变更相关回归套件（见 verify），全部结果与冒烟逐项记录写入 NEW smoke-result.md（含截图/日志摘录与偏差说明）
acceptance:
  - plan 全局验收 1：相关单元/组件测试全绿（pi 四态 + marker 解析 + 前端卡片/聚合/越权反例 + caps 对齐），连带既有测试债同步适配不欠账
  - plan 全局验收 2：真机冒烟三项全过——pi 提问弹卡→作答→同轮继续；cursor 标记提问→卡片→答案作消息→续答（spike go 时，no-go 时记录降级结论）；群聊非群主成员作答成功 + 后答者见关闭态 + 非群成员 404
  - plan 全局验收 3：brownfield 回归——claude/codex 既有会话、普通单聊答题授权、caps=none 引擎行为与今日一致；page.test/sessions-portal/group-chat-panel 等相关既有套件不回归
  - plan 全局验收 4：未启用路径可独立回退验证——pi 桥接异常 fail-closed、cursor 不注入 prompt、授权放开独立提交可单独回退
verify:
  - manual：按 implementation 前三条真机步骤逐项执行，结果记录进 smoke-result.md
  - cd backend && uv run pytest app/modules/daemon/tests -q -k permission
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_permissions.py app/modules/agent/tests/test_provider_caps_alignment.py -q
  - cd frontend && pnpm vitest run src/components/group-chat src/lib/__tests__/askuser-marker.test.ts src/components/ask-user-dialog-card.test.tsx
  - cd sillyhub-daemon && pnpm vitest run tests/interactive/pi-rpc-driver.test.ts
constraints:
  - 本任务只产出验收记录文件（smoke-result.md），禁止改任何产品代码；发现问题回对应 task 修复后复验
  - cursor 冒烟仅在 spike go 时执行；no-go 时该项记录降级结论并跳过（不视为验收失败）
  - 禁止跑全量测试（CLAUDE.md 第 0 条），只跑本变更相关套件；真机使用可重置的本地开发数据
related_tests: {}
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
