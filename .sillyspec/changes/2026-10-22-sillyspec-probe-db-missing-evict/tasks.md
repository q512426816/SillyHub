---
author: zcode-agent
created_at: 2026-10-22T15:16:34.258Z
---
# 任务注册表（Tasks）— 2026-10-22-sillyspec-probe-db-missing-evict

- [x] task-01: `_collectOneTarget` 解析失败 envelope codes：db_missing 连败计数、3 次淘汰（skip 表 + evict 回调 + 清心跳槽位）——验证：定向单测绿
- [x] task-02: 非 db_missing 非零退出保持记账且日志附 stdout 首行——验证：定向单测绿
- [x] task-03: daemon.ts 接线 `statusRootEvict`（删 LRU 条目 + `_persistSillySpecStatusRoots`）——验证：接线测试/类型检查绿
- [x] task-04: 采集成功重置连败计数——验证：定向单测绿
- [x] task-05: daemon 定向测试面全绿 + 零回归——验证：`pnpm test -- tests/sillyspec-manager.test.ts` 等全绿、typecheck 零错
- [x] task-06: 同步 sillyspec-manager 模块文档——验证：文档与实现一致
