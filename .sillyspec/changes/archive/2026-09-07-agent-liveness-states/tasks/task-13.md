---
id: task-13
title: 'sillyspec 仓派发模板改写——blocked→升级不 kill / working→再等（repo:sillyspec）'
title_zh: 'sillyspec 仓派发模板改写——blocked→升级不 kill / working→再等（repo:sillyspec）'
author: 'qinyi'
created_at: 2026-09-07 13:43:27
priority: P0
depends_on: ['task-12']
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-001@v1]
repo: sillyspec
base_commit: f05701b12276f5ac3c9a6b889675796147081ce8
head_commit: 4aa40c6183686a906a87025a04b572fe0d802e4e
base_commit: f05701b12276f5ac3c9a6b889675796147081ce8
head_commit: f05701b12276f5ac3c9a6b889675796147081ce8
expects_from:
  task-12:
    - contract: worker_liveness_field
      needs: [liveness.state, liveness.evidence, liveness.derived_at]
allowed_paths:
  - src/dispatch/backends/sillyhub-mcp.js
target_files: []
goal: >
  改写 sillyspec 仓派发模板「终态轮询 + 超时 kill lease」指令段（sillyhub-mcp.js :231 起）：
  编排 agent 从"超时即 kill lease"升级为按 worker.liveness 知情决策——blocked 超阈值升级
  给人不 kill、working 久无终态按既有超时再等不抢跑。纯指令模板文本，不改执行逻辑。
implementation:
  - 通读 src/dispatch/backends/sillyhub-mcp.js 终态轮询段（:231-244）及其上下文（worker_prompt 覆写段、${recycleRule} 回收约定、local.yaml poll_interval_ms / worker_timeout_ms 引用），确认模板字符串拼接边界
  - 段内说明 liveness 字段语义（跨仓契约随文交付）：list_workers 返回的 worker 在 running 期间附 liveness{ state, evidence, derived_at }；state 取值 working/blocked/idle/ended/unknown；blocked 主源为第一方权限事件（D-012，优先于日志推导）
  - 决策规则改写为三条：① worker liveness.state=blocked 且超阈值（对齐 backend BLOCKED_ALERT_MS=120s 口径）→ 升级给人（agent_blocked 通知 + 平台待办），绝不 kill、绝不自动批准（D-010）；② liveness.state=working 久无终态 → 属长任务场景，按既有 worker_timeout_ms 继续等待，不抢跑 kill；③ 仅 status 超时兜底（无 liveness 或 unknown）才走既有三步（report_progress 标记 → kill lease 防双写 → fallback Local 重派）
  - 保持与回收约定（${recycleRule}）及 Wave/mission 串行描述的衔接不变，kill lease 措辞限定在"超时兜底"路径，避免编排 agent 误读为 blocked 也 kill
  - 语法自检 + 既有 dispatch 相关测试跑通（sillyspec 仓 test/ 目录，test script = node test/run-tests.mjs）
acceptance:
  - 指令段含三条硬规则且互斥清晰：blocked→升级不 kill；working→按既有超时再等；kill lease 仅超时兜底
  - liveness 字段语义在段内自成一体（编排 agent 只读模板即可正确使用，无需查 backend 源码）
  - 模板渲染产物（dispatch 指令文本）语法正常，sillyspec 仓 check-syntax 与既有 dispatch 测试零回归
verify:
  - cd C:\Users\qinyi\IdeaProjects\sillyspec && node test/check-syntax.mjs
  - cd C:\Users\qinyi\IdeaProjects\sillyspec && node test/run-tests.mjs（dispatch 模板相关用例须全绿）
constraints:
  - 只改指令模板文本，不改任何代码执行逻辑（strategy.js / client.js 等行为零变更）
  - 跨仓路径相对 sillyspec 仓根（src/dispatch/...）；主仓侧不改文件（liveness 字段由 task-12 供给）
  - 模板输出是给编排 agent 的自然语言指令，规则措辞须无歧义（"不 kill"要写明例外条件=超时兜底）
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
