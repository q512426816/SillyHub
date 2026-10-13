---
id: task-04
title: 'session change-files hover panel component'
title_zh: '悬浮变更文件组件（胶囊入口+hover 下拉+大弹窗）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-13 12:20:26
priority: P0
depends_on: ['task-02', 'task-03']
blocks: []
requirement_ids: [FR-02, FR-03, FR-04, FR-05]
decision_ids: [D-001@v2, D-004@v1]
allowed_paths:
  - frontend/src/components/daemon/session-change-files-hover.tsx
  - frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx
target_files:
  - NEW:frontend/src/components/daemon/session-change-files-hover.tsx
  - NEW:frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx
expects_from:
  - contract: ChangeFileTree 可选自动刷新 prop
    needs:
      - 'autoRefreshMs 可选 number prop（弹窗内传 15000）'
  - contract: 会话变更数据层 hook
    needs:
      - 'useSessionChanges(workspaceId, sessionId, { active }) 返回 data 为 ChangeSummary[]（消费 location/is_thin/current_stage/updated_at 字段）'
goal: >
  会话页面悬浮 UI 主体（FR-02/03/04/05）：胶囊入口（hover 弹下拉分组列表）→ 点项开
  大弹窗（ChangeFileTree 复用 + Select 切换 + 15s 自动刷新）。
implementation:
  - NEW frontend/src/components/daemon/session-change-files-hover.tsx 导出 `SessionChangeFilesHover({ workspaceId, sessionId, running }: Props)`：容器 div `relative` 内 absolute 右下角（bottom 输入条上方、right-4 bottom-20 量级，对齐原型 prototype-session-change-files-hover.html .hover-entry）
  - 数据：`const { data } = useSessionChanges(workspaceId, sessionId, { active: open })`（open = 下拉或弹窗任一打开）；数据为空/undefined 不渲染任何入口（FR-02 显隐）
  - 分组纯函数 `splitByArchive(changes)`：进行中组（location !== "archive"，保持后端排序=最新优先）+ 归档组；导出供测试
  - 胶囊入口：shadcn Button（variant outline，rounded-lg，非圆圈）「🗂 变更文件」+ 进行中数徽标（running && 进行中数>0 时加呼吸动画类，CSS keyframes 对齐原型 pillPulse）；antd Popover trigger=["hover","click"] 包裹（触屏点击兜底）
  - 下拉内容（Popover content，w-80 max-h-[60vh] overflow-auto）：「进行中 N」组标题 + 变更项（change_key 截断 + is_thin 徽标「轻量」/「全量」+ 阶段 pill（current_stage 中文映射，参照 frontend/src/components/changes/detail/change-stage-header.tsx WORKFLOW_STAGE_LABELS 口径）+ updated_at 相对时间 toLocaleString("zh-CN")）；「已归档 (N)」默认折叠（antd Collapse 或受控 disclosure），点击展开；点击项 → setSelectedId + 开弹窗
  - 大弹窗：shadcn Dialog（对齐 frontend/src/components/changes/detail/change-files-card.tsx 规格 DialogContent h-[85vh] max-w-6xl flex-col gap-0 p-0）——头部「变更文件实时预览」+ antd Select（全部变更选项，轻量/全量/已归档后缀）+ 关闭；body `<ChangeFileTree key={selectedId} workspaceId={workspaceId} changeId={selectedId} autoRefreshMs={15000} />`；默认选中进行中组第一个（全归档时归档组第一个）
  - 同卡写测试 NEW frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx（vitest + testing-library，mock useSessionChanges 与 ChangeFileTree）：①无关联变更（data=[]）不渲染入口；②分组渲染（进行中置顶/归档默认收起）；③归档组展开交互；④点项开弹窗且 ChangeFileTree 收到正确 changeId 与 autoRefreshMs=15000；⑤Select 切换变更后 key 变化（重挂载）；⑥running=true 时入口徽标含呼吸类名
acceptance:
  - 无关联变更时会话页面零渲染痕迹；有关联变更显示胶囊入口+进行中数徽标
  - hover/点击弹出下拉：进行中置顶（轻量/全量徽标+阶段），归档默认折叠可展开
  - 点项开弹窗：ChangeFileTree 接收正确 changeId + autoRefreshMs=15000，Select 可切换（key 重挂载）
  - vitest 新测试全绿
verify:
  - cd frontend && pnpm vitest run src/components/daemon/__tests__/session-change-files-hover.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - ChangeFileTree 只消费不修改（task-02 已完成 prop 扩展）
  - 样式走 tailwind class + 既有组件（shadcn Button/Dialog、antd Popover/Select/Collapse），颜色不硬编码 hex（FRONTEND_PAGE_STYLE §0）
  - 弹窗用 Modal 形态不用 Drawer（FRONTEND_PAGE_STYLE §6）
  - 中文文案；日期 toLocaleString("zh-CN", …)
  - 不做移动端独立适配（触屏点击兜底即可，design 非目标）
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
