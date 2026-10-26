---
author: flow-machine-draft
created_at: 2026-10-26T14:58:48.944Z
---
# 任务注册表（Tasks）— 2026-10-26-ws-evict-close

- [x] task-01: 测试先行——test_ws_hub.py 新增四用例（超时逐出 close(4000) / 异常逐出 close(4000) / close 失败不反噬逐出 / 身份校验放过新连接不误关），先跑确认新用例红
- [x] task-02: 实现——ws_hub._evict_stale pop 成功后锁外 best-effort close(code=4000, reason="evicted")，新用例转绿
- [x] task-03: 全量回归——test_ws_hub.py / test_ws_hub_session_control.py / test_ws_hub_permission.py / test_ws_hub_policy.py 四文件全绿
