---
id: task-05
title: 'CodexAppServerDriver.compact() + 新 id→pending response 机制 + 测试'
title_zh: 'CodexAppServerDriver.compact() + 新 id→pending response 机制 + 测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 11:03:19
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-003@v3]
allowed_paths:
  - sillyhub-daemon/src/interactive/codex-app-server-driver.ts
  - sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts
target_files:
  - sillyhub-daemon/src/interactive/codex-app-server-driver.ts
  - sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts
provides:
  - contract: CodexAppServerDriver.compact
    fields: [参数命名实证结论]
expects_from:
  task-03:
    - contract: InteractiveDriver.compact
      needs: [CompactResult]
goal: >
  CodexAppServerDriver 实现 compact()：先新增 id→pending response 等待机制（driver 现全
  fire-and-forget，照 pi h.pending 先例移植——R-06 如实标注新机制并配独立单测），再发
  JSON-RPC thread/compact/start {threadId} 等 response（空对象=受理），10s 超时降级 error
  不上抛（FR-05）。
implementation:
  - '新增 pending response 等待机制——codex handle 加 pending: Map<id, { resolve; reject; timer }>（照 pi h.pending 先例移植）：消息接收分支识别 JSON-RPC response（有 id 无 method）→ pending.get(id)?.resolve(result) 并清理 timer；未注册 id 的 response 照旧忽略——既有 fire-and-forget 路径（turn/start 等全部 :1578-1593 无等待发送）零改动零行为变化'
  - 'compact(handle)——取自增 id → 注册 pending（10s unref timer 超时 reject + 清理）→ 发 {"jsonrpc":"2.0","id":N,"method":"thread/compact/start","params":{threadId: h.threadId}} → 等 response：空对象受理响应 → { ok: true }（无数字回执，D-004 codex「已触发」文案依据）；response error 对象 → { ok: false, error: 原文 }；超时/写失败 → { ok: false, error: 文案 } 不上抛'
  - 'codex-app-server-driver.test.ts——① pending 机制独立单测：按 id resolve（resolve 值正确）/ 未知 id response 不干扰既有路径 / 超时清理不泄漏 timer ② compact 断言：发送 JSON-RPC 形态（method、params.threadId、自增 id）、空对象 response → {ok:true} 无数字键、error response → error 原文 ③ 既有全套件回归全绿（R-06：fire-and-forget 路径不受 pending 分支影响）'
acceptance:
  - pending map 机制独立单测绿（按 id resolve / 未知 id 忽略 / 超时清理）
  - 'compact() JSON-RPC 形态断言绿；空对象 response → {ok:true} 不挂数字键；error response 原文进 error'
  - 既有 codex-app-server-driver 全套件零回归（R-06 兜底）+ typecheck 绿
verify:
  - pnpm -C sillyhub-daemon exec vitest run tests/interactive/codex-app-server-driver.test.ts
  - pnpm -C sillyhub-daemon exec tsc --noEmit
constraints:
  - 既有 fire-and-forget 消息路径零改动（pending 只新增 response 消费分支，通知类消息不经 pending）
  - 参数命名按 driver 现用 camelCase threadId（R-03；spike-02 真机实证归 task-07，不符只改 params 组装处）
  - 不等 thread/compacted 完成通知（受理即回）；10s 超时
  - daemon ESM 相对 import 带 .js 后缀；Windows / Linux / macOS 兼容
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
