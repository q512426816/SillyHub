---
id: task-11
title: 'verify-acceptance-vs-design-requirements-tests-green'
title_zh: 'verify 验收（对照 design/requirements + 相关测试全绿）'
author: 'qinyi'
created_at: 2026-09-10 19:10:51
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04', 'task-05', 'task-06', 'task-07', 'task-08', 'task-09', 'task-10']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-001@v1, D-002@v1, D-003@v1]
allowed_paths:
  - .sillyspec/changes/2026-09-10-account-avatar-upload/verify-result.md
target_files: []
goal: >
  verify 阶段验收（不写产品码）：对照 design.md 与 requirements.md 对 FR-01~FR-06
  逐条核验证据、汇总执行相关测试全绿、双主题五处展示点目检、PPM 零改动核对，
  产出 verify-result.md（结论枚举三选一显式落行）。
implementation:
  - FR 逐条核验（对照 design 文件变更清单与总体方案）——FR-01 迁移后 users.avatar 列存在且旧行全 NULL、/api/auth/me 响应含 avatar 键；FR-02 PATCH /api/auth/me/avatar 四态（设置/清除/None 不改/401）+ 超长 422 测试证据；FR-03 桌面 /account 个人资料卡片（上传/恢复默认/失败提示）；FR-04 移动 /m/account 整块可点上传 + 恢复默认 + 触控达标；FR-05 五处展示点（桌面/移动个人中心、TopBar、群聊 user 成员回落、1:1 自己气泡）；FR-06 api-types.ts 与 openapi.json 同批提交无类型债
  - 汇总跑相关测试（CLAUDE.md 规则 0 仅相关、全量留 CI）——backend auth 四态 + 群成员回落解析（pytest -q --no-cov）、frontend 三处组件用例（top-bar-avatar / account page / m/account page）+ tsc --noEmit；命令与退出码记入 verify-result.md
  - 双主题目检（blue / ai-native）五处展示点有图/无图两态——无图与现状首字回退一致；截图或目检记录进报告（R-04 应对）
  - PPM 零改动核对（D-003）——git diff 确认 ppm 模块与 WorkbenchProfile.avatar_text 零触碰；非目标复查（无裁剪器/无外链手输 UI/agent 成员头像不受影响）
  - 产出 verify-result.md——结论枚举槽行显式三选一（PASS / PASS WITH NOTES / FAIL），逐 FR 列 PASS 证据（命令+退出码/目检记录），偏差与备注单列；缺证据的 FR 记 FAIL 并打回对应 task 卡
acceptance:
  - FR-01~FR-06 六条全部有 PASS 证据落入 verify-result.md（测试命令+退出码 0 或目检记录）；任一 FR 无证据或失败则结论不为 PASS
  - 相关测试汇总全绿（backend 四态+回落解析、frontend 三组件用例 + tsc 零错），未跑全量（留 CI）且报告中如实注明
  - 双主题目检记录在案——有图渲染头像图、无图首字回退与现状一致（含旧 localStorage user 缺 avatar 字段场景）
  - git diff 证据确认 PPM 零改动（D-003 非目标达成），决策 D-001/D-002/D-003 全部闭环
verify:
  - cd backend && uv run pytest tests/modules/auth/test_my_avatar.py tests/modules/daemon/test_group_member_avatar_fallback.py -q --no-cov
  - cd frontend && pnpm vitest run src/components/__tests__/top-bar-avatar.test.tsx "src/app/(dashboard)/account/page.test.tsx" src/app/m/account/page.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - verify 阶段零产品代码改动——仅产出 verify-result.md，不改 frontend/backend 任何源文件；测试失败不在本卡修码（打回对应 task 卡）
  - 结论只认结论枚举槽行（PASS / PASS WITH NOTES / FAIL），缺证据按 FAIL 处理（fail-closed）
  - 仅跑相关测试（CLAUDE.md 规则 0）；双主题目检必做并留记录（R-04）
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
