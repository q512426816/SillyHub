---
id: task-02
title: 'add-session-row-liveness-dot-and-unread-badge'
title_zh: 'SessionRow 行尾 antd Popover 小灯 + 组合渲染悬停卡 + 未读红点（selected 置真清除）+ props 链透传'
author: 'qinyi'
created_at: 2026-09-08 00:30:00
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-001@v2, D-002@v1]
allowed_paths:
  - frontend/src/components/sessions/session-list-panel.tsx
target_files:
  - frontend/src/components/sessions/session-list-panel.tsx
expects_from:
  task-01:
    - contract: useSessionLiveness
      needs: [bySessionId, isUnread, clearUnread]
goal: >
  在 SessionRow 第一行行尾加 antd Popover 包裹的 18px 活性小灯与组合渲染悬停卡、
  working/blocked 到 idle 转移的未读红点（selected 置真清除），hook 数据经 props 链透传到行。
implementation:
  - SessionListPanel 调一次 useSessionLiveness 建 bySessionId map，经既有 props 链 WorkspaceTreeList 到 WorkspaceGroupNode 到 SessionRow 传可选 liveness（map 命中 session.id 才有值）与 livenessUnread（isUnread 命中才有值）；不改 SessionListPanel 对外 props 契约
  - SessionRow 第一行行尾（相对时间之后、hover 操作按钮之前）渲染 antd Popover（trigger 为 hover，默认 portal 渲染到 body，防行根节点 overflow-hidden 裁剪）包裹 18px LivenessDot（state 取 liveness.state，复用五态视觉不重写）
  - Popover content 组合渲染四项——LIVENESS_META 状态全名与五态色点、静默时长（last_event_at 相对时间）、证据摘要（state_evidence 截断）、推导时间（state_derived_at）；不设「关联」行（无 change_key 数据源）
  - 未读红点——livenessUnread 时小灯右上角 7px bg-destructive 红点带背景色描边，aria-label 为「有新的空闲状态未读」
  - selected 清除——useEffect 监听 selected prop 的 false 到 true 边沿调 clearUnread（覆盖点击/Enter/深链三路入口）；批量模式勾选不触发清除
acceptance:
  - map 未命中的行不渲染小灯，列表布局零变化（不新增列，行内 flex 尾部 flex-none 18px 节点）
  - 悬停卡经 portal 渲染不被裁剪且四行信息齐全；红点随 selected 置真消失
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 布局零变化硬约束——不新增列、不碰归档分组与机器小节与批量模式既有逻辑（R-01）
  - 双主题语义阶（info/warning/destructive/muted 等 themes.ts 单源），无 hex 色值、antd 色经 ConfigProvider 不手写
  - 无关联日志不渲染灯（fail-open）；批量勾选不触发清除
  - 本 task 不写测试文件，组件用例由 task-03 统一补
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
