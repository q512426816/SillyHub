---
id: task-06
title: ppm-mention-groups-and-relation-filter
title_zh: '前端 @联想与筛选——mention-sources PPM 分组 + query-keys + popover 渲染 + 会话列表筛选 ppm 选项（W4, depends_on: task-04）'
author: 'qinyi'
created_at: 2026-08-28 03:19:00
priority: P1
depends_on: [task-04]
blocks: []
requirement_ids: [FR-02, FR-05]
decision_ids: [D-001@v1, D-002@v1]
expects_from:
  task-04:
    - contract: injectSession bind 参数
      needs: [bind_ppm_item_kind, bind_ppm_item_id]
    - contract: listAgentSessions ppm 筛选
      needs: [ppm_item_kind, ppm_item_id]
    - contract: createSession ppm 参数
      needs: [ppm_item_kind, ppm_item_id]
allowed_paths:
  - frontend/src/lib/session-mention-sources.ts
  - frontend/src/lib/session-mention.ts
  - frontend/src/lib/query-keys.ts
  - frontend/src/components/daemon/session-mention-popover.tsx
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/components/daemon/session-input-bar.tsx
  - frontend/src/components/sessions/session-list-panel.tsx
  - frontend/src/lib/ppm/task.ts
  - frontend/src/lib/ppm/problem.ts
  - frontend/src/lib/__tests__/session-mention-sources.test.tsx
  - frontend/src/lib/__tests__/session-mention.test.ts
  - frontend/src/components/daemon/__tests__/session-mention-popover.test.tsx
  - frontend/src/components/daemon/__tests__/session-input-bar-mention.test.tsx
  - frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx
related_tests:
  - frontend/src/lib/__tests__/session-mention-sources.test.tsx
  - frontend/src/lib/__tests__/session-mention.test.ts
  - frontend/src/components/daemon/__tests__/session-mention-popover.test.tsx
  - frontend/src/components/daemon/__tests__/session-input-bar-mention.test.tsx
  - frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
goal: >
  实现 FR-02/FR-05 @联想与筛选侧双向入口（D-001@v1）：useMentionSources 新增「PPM 任务」
  「PPM 问题」分组（默认进行中可切全部，D-002@v1），选中经 pendingMentions.ppmItem 随首句
  createSession 绑定（预会话）或 injectSession bind 参数追问绑定（真会话，只写 link 不注入
  前导），并给会话列表「关联」筛选 Select 增 ppm 选项透传 listAgentSessions。
implementation:
  - query-keys.ts mentionSources 分组新增 ppmTasks/ppmProblems 键（进行中/全部的状态维度
    进键，切开关换键重新拉取）
  - session-mention-sources.ts useMentionSources 新增两分组：任务走
    listPersonalPlanTasks(status=["进行中"])（PlanTaskPageReq.status 为 string[] 多值，
    lib/ppm/types.ts:1083 已核实，不含 user_id 按当前登录用户过滤）；问题走
    listProblems(duty_user_id=当前用户, status=["进行中"])（对齐 PPM「我的任务」口径，
    ProblemListPageReq.duty_user_id 已核实）；默认进行中、提供切全部开关（D-002@v1 全状态
    可关联）；条目标注 project_name（PlanTask/ProblemList 响应自带，零额外请求）；PPM
    查询 enabled 沿用 atEnabled 门控（无 workspace 会话 @ 联想整体禁用，PPM 分组不单独
    放开，X-06），但条目不按会话 workspace 过滤（PPM 实体与工作区为软关联多对多）
  - session-mention.ts 与 session-input-bar.tsx：mention 条目类型扩展 ppmItem——
    SessionInputMentions（session-input-bar.tsx:92）新增 ppmItem 键（kind+id），联想判别
    类型同步扩展
  - session-mention-popover.tsx：SessionMentionItem kind 扩展 PPM 任务/问题两类，
    GROUP_LABELS 增「PPM 任务」「PPM 问题」分组标签（变更/快速修复之后），buildMentionItems
    组装新分组条目，分组头渲染「切全部/仅进行中」开关；选中回填 pendingMentions.ppmItem
  - session-panel.tsx 只加 mention 相关最小接线：handlePreSessionSend 首句 createSession
    携带 ppm_item_kind/ppm_item_id（pendingMentions.ppmItem 优先、preContext.ppmItem 兜底，
    合并语义对齐 change/quick）；mentionBindOptions（session-panel.tsx:400）扩展
    bind_ppm_item_kind/bind_ppm_item_id（真会话 inject 追问路径，只写 link 不注入前导，
    对齐 quicklog 行为），四个 inject 发送点位经既有共用组装自动生效
  - session-list-panel.tsx 关联筛选 Select 新增 PPM 分组选项（数据源同 @联想口径）：
    value 编码 ppm:plan_task:<uuid> / ppm:problem:<uuid>，选中值解析为
    listAgentSessions 的 ppm_item_kind/ppm_item_id 透传（沿现有 relationFilter → 参数
    对象槽位惯例，仅 workspace scope 提供）
  - lib/ppm/task.ts / problem.ts 仅在确缺参数透传时补（当前参数面已够，见上）
  - 测试适配（GAP-1）：session-mention-sources.test.tsx 补 PPM 分组拉取/切全部/atEnabled
    门控；session-mention-popover.test.tsx 补分组渲染与选中；session-input-bar-mention.
    test.tsx 补 pendingMentions.ppmItem 回填；session-mention.test.ts 补条目判别；
    session-list-panel.test.tsx 补 ppm 选项透传断言
acceptance:
  - FR-02 GWT-1：有 workspace 的会话输入 @ → 出现「PPM 任务」「PPM 问题」分组——任务=
    listPersonalPlanTasks(status=["进行中"])、问题=问题列表 duty_user_id=me+status 进行中，
    均可切全部（D-002@v1），条目标注项目名；无 workspace 会话 atEnabled=false 时 @ 整体
    禁用，PPM 分组随之禁用不单独放开（X-06）
  - FR-02 GWT-2：预会话选中 PPM 条目后发送首句 → createSession 携带 ppm_item_kind/
    ppm_item_id 创建（走 FR-01 链路）
  - FR-02 GWT-3：真会话中选中 PPM 条目后追问 → injectSession 携带 bind_ppm_item_kind/
    bind_ppm_item_id 只追加 link，不注入前导；重复选择追问绑定幂等（对齐 quicklog 行为）
  - FR-05：会话列表「关联」筛选选择 PPM 任务/问题选项（value 编码 ppm:plan_task:<uuid>/
    ppm:problem:<uuid>）→ listAgentSessions 透传 ppm_item_kind/ppm_item_id，列表命中该
    item 关联的会话
verify:
  - cd frontend && pnpm exec vitest run src/lib/__tests__/session-mention-sources.test.tsx src/lib/__tests__/session-mention.test.ts src/components/daemon/__tests__/session-mention-popover.test.tsx src/components/daemon/__tests__/session-input-bar-mention.test.tsx src/components/sessions/__tests__/session-list-panel.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 执行顺序在 task-05 之后（plan Wave 4 task-05→task-06 串行——两者共改 session-panel.tsx
    /session-mention 链路避免同文件冲突；depends_on 只记契约依赖 task-04，串行约束见
    plan.md Wave 4 说明）
  - session-panel.tsx 只加 mention 相关最小接线（pendingMentions.ppmItem 消费 +
    mentionBindOptions 扩展），不动 task-05 的 preContext.ppmItem 通道与其它逻辑（R-06）
  - FR-02 三块 GWT 与 FR-05 的用例必须进验收（plan-review NOTE-2，已逐条落 acceptance）
  - PPM 分组不按会话 workspace 过滤条目（软关联多对多），但不放宽 atEnabled 门控（X-06）
  - 不改后端与 lib/daemon.ts（injectSession bind 参数 / listAgentSessions 筛选参数来自
    task-04，见 expects_from；task-04 由另一 batch 生成，按契约对齐）
  - 不做移动端 @联想适配（design §3 非目标）
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
