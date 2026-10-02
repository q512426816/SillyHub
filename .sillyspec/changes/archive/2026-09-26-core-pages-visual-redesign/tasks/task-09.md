---
id: task-09
title: '会话门户左栏展示层 Primer 化 + 测试同步'
title_zh: '会话门户左栏展示层 Primer 化 + 测试同步'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-27 00:40:13
priority: P0
depends_on: ['task-02', 'task-03']
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - frontend/src/components/sessions/
  - frontend/src/app/(dashboard)/sessions/__tests__/
related_tests:
  - frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
target_files:
  - frontend/src/components/sessions/session-list-panel.tsx
expects_from:
  task-02:
    needs: [StateIcon, StateLabel, EmptyState]
goal: >
  会话门户左栏（session-list-panel.tsx 3665 行）展示层 Primer 化：两段式条目+选中
  蓝条+分组头，红线=只动 render 与样式类，状态机/数据流/深链零改动。
implementation:
  - frontend/src/components/sessions/session-list-panel.tsx：列表条目重排为两段式（状态点+标题 14px+右上相对时间 / 引擎 chip+轮数+创建人），选中态=白底+左侧 2px 主题色指示条；群聊分区/工作区树手风琴组头 Primer 化（名称+Counter+操作按钮）；chips 密度收敛（引擎/供应商合并 mono 12px）；筛选下拉与搜索框视觉统一
  - frontend/src/components/sessions/sessions-portal.tsx（1137 行）：左栏挂载容器样式统一（拖宽把手/二模切换按钮视觉）；左栏空态用 EmptyState
  - 保留：置顶/重命名/归档/导出/删除 hover 操作、批量模式、?session= 深链、?new=1 直达、组内 50 截断逻辑（全部仅换壳不换逻辑）
  - 同步修 sessions 相关既有测试断言（如有；改断言不改意图）
acceptance:
  - 左栏条目/组头/选中态对照原型「会话」视图左栏一致
  - 状态机/props/数据流 diff 为零（git diff 仅 className/JSX 结构）；深链 ?session= 行为不变
  - 既有测试全绿
verify:
  - cd frontend && pnpm vitest run src/components/sessions "src/app/(dashboard)/sessions"
  - cd frontend && pnpm typecheck
constraints:
  - 红线：MUST NOT 改动 hooks 调用/状态机/事件处理逻辑（仅 render 与样式类）
  - 拖宽范围（240-560px）与 localStorage 记忆零改动
  - 移动端 /m/sessions 零波及（不改 app/m/）
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
