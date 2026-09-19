---
id: task-04
title: '新增 parse-claude-code-jsonl 解析器（行过滤/isMeta+注入前缀→system_event/tool_result 载体→工具段配对/usage 透传）'
title_zh: '新增 parse-claude-code-jsonl 解析器（行过滤/isMeta+注入前缀→system_event/tool_result 载体→工具段配对/usage 透传）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-19 21:03:54
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-003@v1, D-006@v1]
allowed_paths:
  - NEW:sillyhub-daemon/src/agent-log/parse-claude-code-jsonl.ts
  - NEW:sillyhub-daemon/tests/agent-log/parse-claude-code.test.ts
target_files:
  - NEW:sillyhub-daemon/src/agent-log/parse-claude-code-jsonl.ts
  - NEW:sillyhub-daemon/tests/agent-log/parse-claude-code.test.ts
expects_from:
  task-01:
    - contract: NormalizedLogMessage
      needs: [sender, usage]
goal: >
  新建 claude-code JSONL 解析器（现状 unsupported 回落原文，D-006@v1）——行过滤、
  isMeta+注入前缀归 system_event、tool_result 载体配对、message.usage 透传（FR-02/FR-03）。
implementation:
  - 新建 parse-claude-code-jsonl.ts——签名对齐 AgentLogParser（sillyhub-daemon/src/agent-log/registry.ts:53，纯函数 content + beforeSeq 注入）返回 AgentLogMessagesResult；beforeSeq 切片 + 200 段窗口 + truncated/totalSegments/skippedLines 与 20MB 预算/坏行容错口径对齐 parse-zcode-model-io（parse-zcode-model-io.ts:147）
  - 行过滤（design Phase 1.3）——只取 user/assistant 行；queue-operation/attachment/mode/last-prompt/system 等非对话行跳过计入 skippedLines
  - assistant 行——content 块 thinking/text/tool_use → thinking/reply/tool_use 段（tool_use_id=块 id、tool_input JSON.stringify 首 2KB 摘要）；message.usage 五项透传附着到该行全部段（实证日志 562/605 行 usage 非零）；turn_id 取会话内轮序（design 接口定义注释口径）；totalUsage 全量段 usage 四项求和
  - user 行——纯 tool_result 块 → tool_result 段按 tool_use_id 与前置 assistant tool_use 配对（失配孤儿段照产保留 id）；isMeta=true 或文本以注入前缀开头（【当前用户信息】、<command-name>、Caveat:）→ sender='system_event'（R-06 前缀白名单）；其余 text user → user_input 缺省 'human'（漏网保守归 human——错标系统事件会隐藏真人输入）
  - 新建 parse-claude-code.test.ts——脱敏 fixture 覆盖行过滤/注入前缀与 isMeta/tool_result 配对与孤儿/usage 透传与 totalUsage/beforeSeq 窗口
acceptance:
  - 非对话行零段产出且计入 skippedLines；assistant 段带透传 usage 与会话内轮序 turn_id
  - tool_result 载体行按 tool_use_id 配对成功，失配孤儿段保留；isMeta/白名单前缀 → system_event，其余 user 缺省 human
  - totalUsage 等于全量段 usage 四项之和，无 usage 行不影响；窗口与容错语义与既有解析器对齐
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/agent-log/parse-claude-code.test.ts && pnpm typecheck
constraints:
  - 本卡不注册 registry（PARSERS 增键归 task-06）、不改 host-fs-handler；不 import RpcError/ws-client/fs
  - 前缀白名单外未识别注入保守归 human（R-06 代价不对称裁决）；不伪造 CLI 命令文本与 token
  - fixture 禁带真实路径/业务内容，统一脱敏占位
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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
