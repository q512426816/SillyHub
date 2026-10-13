## 2026-10-13-daemon-log-config-view — daemon 诊断端点 client 与类型产物

- lib/daemon/machines.ts 新增 fetchMachineLogTail/fetchMachineConfig（ApiError 承载 422/504/502）。
- api-types.ts（gen:types 产物）新增 DaemonLogTailResponse/DaemonConfigResponse schema 类型。
