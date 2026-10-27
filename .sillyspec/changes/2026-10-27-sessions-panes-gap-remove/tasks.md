---
author: flow-machine-draft
created_at: 2026-10-27T04:32:48.841Z
---
# 任务注册表（Tasks）— 2026-10-27-sessions-panes-gap-remove

- [x] task-01: sessions-portal.tsx:809 panes 容器 className 删 gap-3（其余类保持）
- [x] task-02: 把手零回归确认——PanelResizer 自身 w-1.5 独立在场（panel-resizer.tsx:144 源码锚），76 用例回归全过
- [x] task-03: sessions-portal.test.tsx 补类名断言（gap-3 不在场）+ 全文件 76 用例 + tsc + eslint 0 errors 全绿
