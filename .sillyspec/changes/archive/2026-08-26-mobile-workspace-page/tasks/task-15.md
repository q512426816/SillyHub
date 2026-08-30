---
id: task-15
title: '会话对话移动页 sessions/[sid]/page.tsx（SessionPanel 第四宿主，machines/llmProviders 页面级数据同源）（FR-07/FR-09）'
title_zh: '会话对话移动页 sessions/[sid]/page.tsx（SessionPanel 第四宿主，machines/llmProviders 页面级数据同源）（FR-07/FR-09）'
author: 'qinyi'
created_at: 2026-08-27 01:45:00
priority: P0
depends_on: ['task-01', 'task-02', 'task-14']
blocks: ['task-16']
requirement_ids: [FR-07, FR-09]
decision_ids: [D-001@V1, D-003@V1, D-004@V1]
allowed_paths:
  - frontend/src/app/m/workspaces/[id]/sessions/[sid]/page.tsx
  - frontend/src/app/m/workspaces/[id]/sessions/[sid]/__tests__/page.m-session-chat.test.tsx
goal: >
  新增会话对话钻取移动页 sessions/[sid]/page.tsx：SessionPanel 第四宿主（key=sid/mode="page"/variant="mobile"），
  machines/llmProviders 页面级数据与悬浮宿主同 key 同源（FR-07/FR-09）。
expects_from:
  task-14:
    - contract: SessionPanel variant=mobile
      needs: ['variant?: "desktop" | "mobile"（默认 desktop，仅渲染层）', mode, sessionId, machines, llmProviders, onSessionListRefresh]
implementation:
  - 新建页面："use client" + useParams 取 sid；路由命中 task-01 DRILL_ROUTES 裸容器（无底部 Tab，FR-09）
  - '页面级数据同源（对齐 floating-session-host.tsx:86-96）：useDaemonMachines({ limit: 100 })（内部 15s 无条件轮询）取 machines；useQuery({ queryKey: ["llmProviders", "floating-session"], queryFn: listProviders, staleTime: 30_000 }) 取 providers（@/lib/api/llm-providers，与悬浮宿主同 key 共享缓存）'
  - '主体渲染 <SessionPanel key={sid} mode="page" variant="mobile" sessionId={sid} machines={machines} llmProviders={providers} onSessionListRefresh={() => qc.invalidateQueries({ queryKey: ["agentSessions"] })} />（调用形态对齐 floating-session-host.tsx:307-315；key={sid} 使路由参数变化天然触发重挂载，清 SSE/消息队列）'
  - 测试（mock SessionPanel）：透传 props 断言（key/sessionId/mode/variant/machines/llmProviders/onSessionListRefresh）、sid 变化重挂载、invalidate 调用
acceptance:
  - /m/workspaces/[id]/sessions/[sid] 渲染 SessionPanel variant="mobile" 全功能（SSE 流式/发消息/中断/结束重开/消息队列/子代理目录/上下文用量），输入条贴底可见
  - 路由 sid 变化 → key 变化重挂载，SSE/队列状态干净重建（既有契约）
  - machines（15s 轮询）/llmProviders（30s staleTime）与悬浮宿主同 key 同源，零重复请求实现
  - 钻取页无底部 Tab（DRILL_ROUTES 生效）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- 'src/app/m/workspaces/[id]/sessions/[sid]/__tests__/page.m-session-chat.test.tsx'
constraints:
  - 不改 SessionPanel 本体（variant="mobile" 已由 task-14 完成），本页仅装配与页面级数据
  - 数据层零新增实现：machines 走 useDaemonMachines、providers 走 listProviders，queryKey 与悬浮宿主一致
  - 纯前端，无 API/DTO 改动；不改 (dashboard)/sessions 任何文件
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
