---
author: flow-machine-draft
created_at: 2026-10-14T02:52:48.814Z
---
# 任务注册表（Tasks）— 2026-10-14-logout-localstorage-user-data-cleanup

- [x] task-01: 全仓清查 localStorage 键并区分用户域（按 sessionId/groupId/会话内容索引）与设备级偏好（主题/输入框高度/浮球位置等），清单落 design（6 前缀 + 保留面已落 design.md 注册表，来源文件锚点齐全）
- [x] task-02: 主动登出（桌面+移动）与 401 被动登出在整页跳转前统一清理（app-shell / m-account / lib/api.ts 三处挂载，实测通过）
- [x] task-03: 清理逻辑集中一处注册表实现（lib/logout-storage.ts：USER_SCOPED_LS_PREFIXES + clearUserScopedLocalStorage 容错遍历）
- [x] task-04: 补清理行为测试（logout-storage.test.ts 4 用例：全清/尾分隔符精确匹配/容错/空转；两处登出组件用例追加清理被调断言）
- [x] task-05: 现有相关测试不回归（6 文件 47 用例全过 + typecheck 全绿）
