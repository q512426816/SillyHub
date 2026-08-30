---
id: task-11
title: 'preContext quickId（session-panel + floating-session + 请求体断言测试）'
title_zh: 'preContext quickId（session-panel + floating-session + 请求体断言测试）'
author: 'qinyi'
created_at: 2026-08-25 22:54:07
priority: P0
depends_on: ['task-09']
blocks: []
requirement_ids: [FR-06]
decision_ids: []
allowed_paths:
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/stores/floating-session.ts
  - frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx
expects_from:
  - 'task-09 contract CreateSessionInput needs [quicklog_id]——preContext.quickId 随首句 createSession 上送 quicklog_id 的客户端通道（服务端落 task-08 创建即绑 quicklog_session_links）'
goal: >
  FR-06 悬浮与面板 preContext 补 quickId——SessionPreContext 加 quickId 可选
  字段（预会话上下文行展示快速修复标题 + 首句创建请求体透传 quicklog_id 落
  绑定），FloatingPreContext 同步加字段补齐悬浮球链路；与 changeId 既有
  链路完全同构，缺省零回归。
implementation:
  - 'session-panel.tsx SessionPreContext（L155-171）加 quickId 可选字段（string 或 null，注释对齐 changeId——快速修复入口传入，调用方显式双传 workspaceId）'
  - '快速修复标题解析 query——对齐 preChangeQuery 模式（L570-585）新增 preQuicklogQuery，queryKey 含 workspaceId 与 quickId，queryFn 调 lib/quicklog 既有 getQuicklogDetail 取 title，enabled 守卫双 id 真值，解析失败静默回退 ql_id 短码展示'
  - '预会话上下文行——quickId 存在时渲染快速修复锁定行（标题取解析结果，展示形态对齐变更名行）'
  - 'handlePreSessionSend 请求体（L1582-1602）——条件展开补 quickId 真值时带 quicklog_id（对齐 change_id 既有展开形态，缺省不进请求体）'
  - 'stores/floating-session.ts FloatingPreContext（L24-28）加 quickId 可选字段——floating-session-host.tsx 经展开透传天然兼容无需改动（不列入 allowed_paths）'
  - 'session-panel-pre-session.test.tsx 更新——补 preContext 带 quickId 用例断言 createSession 请求体含 quicklog_id、既有不带 quickId 用例补断言请求体不含（零回归）；标题解析 query mock 覆盖（标题展示与失败回退）'
acceptance:
  - 'preContext 带 quickId 加 workspaceId 时首句 createSession 请求体含 quicklog_id——创建的会话经 task-08 落 quicklog_session_links 绑定（FR-06）'
  - '不带 quickId 的既有 pre-session 全部用例零回归——请求体不含 quicklog_id'
  - 'quickId 预会话上下文行显示快速修复标题，解析失败回退短码展示不报错'
verify:
  - cd frontend && pnpm exec tsc --noEmit && pnpm test -- --run src/components/daemon/__tests__/session-panel-pre-session.test.tsx
constraints:
  - 'quickId 为 ql_id 短码字符串（D-001 自然键）——前端不做存在性校验只透传（条目行允许后到）'
  - '不动 floating-session-host.tsx（展开透传天然兼容）与 page_context 既有链路；不动创建流程其余字段组装'
  - '与 task-10 同 Wave 类型耦合——SessionPreContext.quickId 本卡落地后 task-10 门户合成分支 tsc 才全绿，两卡文件互不重叠可并行'
related_tests:
  - path: frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx
    reason: createSession 请求体断言既有用例——补 quicklog_id 双向断言（带 quickId 含字段、不带不含）与快速修复标题解析 mock
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
