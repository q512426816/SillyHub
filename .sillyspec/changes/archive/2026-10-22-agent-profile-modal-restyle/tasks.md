---
author: flow-machine-draft
created_at: 2026-10-22T01:29:54.658Z
---
# 任务注册表（Tasks）— 2026-10-22-agent-profile-modal-restyle

- [x] task-01: skillOptions 扩为 {name, desc} 并集（Map 去重自定义优先，desc 取数据源 description）；用例「技能简介来自数据源并集渲染」绿（pnpm -C frontend exec vitest run agent-profile-form）
- [x] task-02: SkillPickerGroup 受控控件：全选三态（仅作用筛选集）+ 搜索（名称∪简介）+ 已选计数 + 清空 + 两行芯片网格（键盘可达/空态/限高内滚）；新用例全选/半选/搜索下全选绿
- [x] task-03: 弹窗观感重构：品牌图标头+副标题、页脚红线注脚（单行省略+title）、品牌竖条小节头（说明文案逐字不变）；新用例「弹窗观感」绿 + 既有用例查询适配后全绿
- [x] task-04: globals.css 加 .thin-scroll 作用域工具类 + 三主题 --scroll-thumb/--scroll-thumb-hover；grep 确认无新增硬编码 hex（FR-05）
- [x] task-05: 全量回归：pnpm -C frontend exec vitest run src/components/__tests__/agent-profile-form.test.tsx + typecheck + lint 全绿
- [x] task-06: 实页视觉对照：dev server 起 /agent-profiles 弹窗，三主题截图对比原型，结论落 visual-evidence.md；local.yaml 补 ui_prototype 登记
