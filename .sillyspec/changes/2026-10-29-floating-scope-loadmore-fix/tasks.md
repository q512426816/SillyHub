---
author: flow-machine-draft
created_at: 2026-10-28T23:13:04.592Z
---
# 任务注册表（Tasks）— 2026-10-29-floating-scope-loadmore-fix

- [x] task-01: 测试先行——session-list-panel.test.tsx 新增三用例：①FR-01 组件级（首屏+续拉后 rerender 同值新引用 scope，断言条目不回跳/游标延续 offset=累计/零多余请求）②FR-02 组件级（同 kind 换 workspaceId，断言附加段清空+游标复位 offset=新口径首屏长度）③sessionScopeStableKey 纯函数四分支键唯一性；跑红（新用例失败、键不存在）
- [x] task-02: 实现——session-list-panel.tsx 新增导出 sessionScopeStableKey（判别联合四分支 kind+全部标识字段标量键），清理 effect 依赖 scope→稳定键；task-01 三用例跑绿
- [x] task-03: 回归验证——session-list-panel 测试套件全量绿 + tsc 0 error + eslint 改动文件 0 error（FR-03 收口实测）
