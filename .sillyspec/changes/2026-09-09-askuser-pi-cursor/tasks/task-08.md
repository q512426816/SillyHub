---
id: task-08
title: 'daemon marker prompt 注入（caps 分派）+ 单测'
title_zh: 'daemon marker prompt 注入（caps 分派）+ 单测'
author: 'qinyi'
created_at: 2026-09-09 23:09:21
priority: P0
depends_on: ['task-05', 'task-12']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-003@v2, D-005@v1]
expects_from:
  - 'task-12: caps dialog 键（getProviderCaps(provider).dialog 等于 marker 为分派依据，providers.ts:187）'
  - 'task-05: spike go 结论（≥8/10）——no-go 时 caps 落 none、本卡取消'
allowed_paths:
target_files:
goal: >
  caps=marker 的 provider（cursor）每轮用户消息前注入 askuser 标记协议说明常量（何时问/格式样例/答案作为下一条消息回来/推荐人可选）——Wave B daemon 侧唯一改动（FR-03）。
implementation:
  - session-manager.ts 新增协议前缀常量（中文文案 + ```askuser JSON 样例，字段词汇对齐 AskUserMarkerPayload：kind/question/options/allowCustom/recommendResponders）
  - 注入 helper：getProviderCaps(state.provider).dialog 为 marker 时在用户文本前拼接前缀（换行分隔），其余 provider 原样返回
  - 接三个用户消息入队点：inject() 主漏斗（turn-control.ts:145/298，含 pendingFirstPrompt 首轮）、create firstPrompt 超时 fallback push（session-manager.ts:874）、reloadWithConfig 切换轮 push（session-manager.ts:1640）
  - 单测（session-manager-askuser-dialog.test.ts 新增 describe）：marker provider 三入口均带前缀；native/none 零注入；前缀不吞原文
acceptance:
  - marker provider 每轮入队 prompt 均带协议前缀（首轮/inject 轮/切换轮）
  - claude/codex/pi 消息零变化（零回归）
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/interactive/session-manager-askuser-dialog.test.ts tests/interactive/session-manager-inject-attachment.test.ts
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - spike no-go（task-05 判 <8/10）→ 本卡整体取消（plan Spike 前置验证）
  - 注入只在 session-manager 消息入队层：不改 cursor-driver.ts / backend / 前端
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
