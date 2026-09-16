---
id: task-06
title: 'session-panel-page.tsx 游标二元组化——新 historyCursorIdRef；**翻页 :1074 与初始加载 :689 两写点均设 id**；换会话重置 :662 同步清；请求透传 :1053；pageKey 加游标 id 前 8 位后缀 :1093；loadEarlierOnce 进度判定二元组比较 :1129-1131'
title_zh: 'session-panel-page.tsx 游标二元组化——新 historyCursorIdRef；**翻页 :1074 与初始加载 :689 两写点均设 id**；换会话重置 :662 同步清；请求透传 :1053；pageKey 加游标 id 前 8 位后缀 :1093；loadEarlierOnce 进度判定二元组比较 :1129-1131'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-16 08:17:13
priority: P0
depends_on: ['task-04', 'task-05']
blocks: []
requirement_ids: [FR-01, FR-02, FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
target_files:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
expects_from:
  - field: beforeId (opts field)
    from: task-05 getAgentSessionLogs
goal: >
  翻页游标二元组化——(ts, id) 双 ref，翻页与初始加载双写点均设 id，进度判定二元组比较，
  pageKey 加 id 后缀；同 ts 批次逐页可达、key 撞号根除。
implementation:
  - 新增 historyCursorIdRef（:369 historyCursorRef 声明旁，string | null）
  - 初始加载写点 :689 同步设 historyCursorIdRef.current = logs[0]?.id ?? null（Grill 补的关键点：漏设则首翻 beforeId=undefined 走旧 <= 分支整页重复）
  - 翻页写点 :1074 同步设 historyCursorIdRef.current = older[0]?.id ?? null
  - 换会话重置 :662 同步清 historyCursorIdRef
  - 请求 :1053 带 beforeId: historyCursorIdRef.current ?? undefined
  - pageKey :1093 追加游标 id 前 8 位后缀（cursor 数字串 + '-' + id.slice(0,8)）
  - loadEarlierOnce :1128-1131 进度判定改二元组（ts 与 id 均未变才 false）
acceptance:
  - 初始加载后首翻请求即带 before_id；同 ts 不同 id 的两页判定「有进度」（跳转循环不误 break）
  - 换会话后 historyCursorIdRef 复位（新会话首翻游标正确）
  - pageKey 跨页唯一（同 ts 批次多页不撞 key）
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不动 logsToTurns / 轮序派生（FR-04）
  - 不动 maybeAutoFill/scheduleAutoFill 机制
  - 不改 HISTORY_PAGE_SIZE
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
