## 2026-10-13-daemon-log-config-view — daemon 诊断端点 client 与类型产物
- change 2026-11-06-session-git-approval | gen:types 义务产物：api-types.ts 重生成（git-diff 端点 schema 增量，openapi.json +167 行）；组件内 apiFetch 会话级 git-diff 调用。

- lib/daemon/machines.ts 新增 fetchMachineLogTail/fetchMachineConfig（ApiError 承载 422/504/502）。
- api-types.ts（gen:types 产物）新增 DaemonLogTailResponse/DaemonConfigResponse schema 类型。
