---
id: task-12
title: '会话列表移动页 sessions/page.tsx（含预会话态承载与切真会话路由）（FR-06/FR-08）'
title_zh: '会话列表移动页 sessions/page.tsx（含预会话态承载与切真会话路由）（FR-06/FR-08）'
author: 'qinyi'
created_at: 2026-08-27 01:45:00
priority: P0
depends_on: ['task-02', 'task-04', 'task-11', 'task-13']
blocks: ['task-16']
requirement_ids: [FR-06, FR-08]
decision_ids: [D-003@V1, D-004@V1]
allowed_paths:
  - frontend/src/app/m/workspaces/[id]/sessions/page.tsx
  - frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx
goal: >
  新增会话列表移动页 sessions/page.tsx：装配 MobileSessionList 与 MobileWorkspaceHeader，承载新建
  两步浮层（PreSessionPicker bottomSheet）与页内预会话态，首句创建成功切真会话路由（FR-06/FR-08）。
expects_from:
  task-11:
    - contract: MobileSessionList
      needs: [workspaceId, onSelect, onNew, 同 key query 数据 + 机器分组 + 状态Tab + 菜单操作]
  task-13:
    - contract: PreSessionPicker variant bottomSheet
      needs: ['variant?: "center" | "bottomSheet"（默认 center）', open, machines, onCancel, onPick(runtimeId)]
implementation:
  - 新建页面："use client" + useParams；MobileWorkspaceHeader tab="sessions"（task-04 契约）+ '<MobileSessionList workspaceId={id} onSelect={(sid) => router.push(`/m/workspaces/${id}/sessions/${sid}`)} onNew={…} />'（task-11 契约）
  - '新建：＋ → useDaemonMachines({ limit: 100 }) 的 machines 传 <PreSessionPicker variant="bottomSheet" open machines onCancel onPick />；onPick(runtimeId) 置 preContext（对齐 sessions-portal.tsx:369 workspace 入口语义：workspaceId + runtimeId）进入页内预会话态'
  - 预会话态用列表页内状态切换（design §5.4 两选项裁决，少一个路由文件）：preContext 非空时整页切渲染 '<SessionPanel key={`pre:${workspaceId}:${runtimeId}`} mode="page" variant="mobile" sessionId={null} machines={machines} llmProviders={providers} preContext={preContext} onPreSessionCreated={handlePreSessionCreated} />'，附返回列表入口
  - handlePreSessionCreated（对齐 sessions-portal.tsx:396-405 语义）：清 preContext + router.replace 到 /m/workspaces/[id]/sessions/[sid]（key 变化重挂载自然接管）+ invalidateQueries(["agentSessions"])；providers 同源 useQuery listProviders（@/lib/api/llm-providers，staleTime 30s）
  - 测试：列表装配与 onSelect 导航、＋入口弹 bottomSheet、onPick 切预会话态、onPreSessionCreated 后 router.replace 断言
acceptance:
  - /m/workspaces/[id]/sessions 展示 MobileSessionList 分组卡片，点卡片钻取 sessions/[sid]
  - ＋ 弹 PreSessionPicker variant="bottomSheet" 两步；选定后页内切预会话 SessionPanel（sessionId=null + preContext）
  - 预会话首句创建成功 → router.replace 到 /m/workspaces/[id]/sessions/[sid]，["agentSessions"] 已失效刷新；列表态保留底部 5 Tab（非钻取路由，FR-09）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- 'src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx'
constraints:
  - 预会话态采用列表页内状态切换承载（design §5.4 允许「列表页内」或独立路由，取少一个路由文件的方案），不新增 /sessions/new 路由
  - 不改 SessionPanel/PreSessionPicker 本体（variant 分别由 task-14/task-13 提供，均为 W1 任务、W3 前就绪；遵循 plan 依赖图不追加 depends_on）；machines/providers 数据与悬浮宿主同源复用，纯前端无 API/DTO 改动
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
