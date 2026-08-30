---
id: task-02
title: build-session-mention-popover
title_zh: 会话输入联想浮层组件——分组渲染/过滤/键盘/无障碍/空态与叠层互斥
author: qinyi
created_at: 2026-08-26 23:43:50
priority: P0
depends_on: ['task-01', 'task-04']
blocks: [task-03]
requirement_ids: [FR-01, FR-02, FR-04, NFR-02]
decision_ids: [D-002]
allowed_paths:
  - frontend/src/components/daemon/session-mention-popover.tsx
  - frontend/src/components/daemon/__tests__/session-mention-popover.test.tsx
provides:
  - contract: SessionMentionPopover
    fields: [SessionMentionPopoverProps, trigger, query, items, activeIndex, onSelect, onClose]
expects_from:
  task-01:
    - contract: MentionDetection
      needs: [trigger, query, start]
  task-04:
    - contract: useMentionSources
      needs: [skills, changes, quicklogs, atEnabled]
goal: >
  新建输入胶囊上方的联想浮层组件 session-mention-popover——分组渲染、前缀优先过滤、键盘导航、listbox 无障碍与空态引导，onSelect 抛原始实体对象（浮层不读 invoke_name，回填名 invoke_name ?? name 由 task-03 接入层计算）。
implementation:
  - 新建纯受控组件——浮层对齐 team-trigger-popover 自定义浮层惯例（daemon 组件族避用 antd，规避中文按钮 autoLetterSpacing 拆分坑），输入胶囊上方 absolute bottom-full、最大高约 260px 内部滚动；props 含 trigger（/ 或 @）、query、items、activeIndex、onSelect（抛原始实体对象）、onClose
  - 分组渲染——/ 触发分「内置指令」（/team 标注平台指令）与「技能」（name + description 单行截断）；@ 触发分「变更」（title 空时回退 change_key 展示）与「快速修复」（ql_id + title）
  - 过滤与空态——前缀优先、包含次之、大小写不敏感；无匹配展示空态，数据源缺失或 manifest 404 展示引导文案
  - 键盘与无障碍——↑/↓ 循环移动高亮、Enter/Tab 确认调 onSelect、Esc 调 onClose，确认与关闭不冒泡外溢为发送；容器 role=listbox、选项 role=option 且 aria-selected、aria-activedescendant 跟随高亮
  - 新建 __tests__/session-mention-popover.test.tsx——覆盖键盘（↑↓ 循环/Enter/Tab/Esc）、过滤（前缀优先/包含/大小写）、双触发分组、空态与 404 引导、与 team popover 及附件降级提示条的叠层互斥（R-5——同锚区互斥与 z-index 同层族）
acceptance:
  - / 浮层按指令/技能、@ 浮层按变更/快速修复两组渲染，条目字段与单行截断符合 design §3.2
  - 过滤前缀优先于包含且大小写不敏感；无匹配空态与 manifest 404 引导文案可被断言
  - ↑/↓ 循环移动、Enter/Tab 确认、Esc 关闭；确认与关闭事件不外溢为外层发送
  - listbox/option/aria-selected/aria-activedescendant 齐全（NFR-02）；onSelect 参数为原始实体对象且组件内不出现 invoke_name 引用（回填名归 task-03）；与 team popover 及附件降级提示条互斥用例通过（R-5）
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-mention-popover.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 浮层内禁止读 invoke_name（消除与同 Wave task-08 的类型时序风险）；回填名 invoke_name ?? name 计算归 task-03 接入层
  - 不用 antd、不依赖 react-query——数据经 props 注入（hook 组装归 task-04），组件不发任何网络请求
  - 不改 session-input-bar.tsx、team-trigger-popover.tsx、session-panel.tsx——接入归 task-03/05，/team 语义与既有浮层零改动
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
