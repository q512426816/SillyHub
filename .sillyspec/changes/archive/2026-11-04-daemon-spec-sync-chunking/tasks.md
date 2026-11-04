---
author: flow-machine-draft
created_at: 2026-11-04T14:20:16.937Z
---
# 任务注册表（Tasks）— 2026-11-04-daemon-spec-sync-chunking

- [x] task-01: daemon 增量推送按 op 数与 base64 字节粗估双约束切块（缺省 128 ops / 2MiB，env SILLYSPEC_SPEC_SYNC_CHUNK_OPS / SILLYSPEC_SPEC_SYNC_CHUNK_BYTES 可调，键名与 CLI 一致）顺序提交，块响应合并（conflict 任一块真、server_versions/new_versions 累积）后走既有 conflict re-base 与缓存回写路径，对外行为与单批等价
- [x] task-02: 中途块失败且已有块落地时禁止回退整包 tar（部分落地后 tar 全量覆盖有覆盖他端写入风险且必超时），异常上抛由下轮同步以服务器清单为锚断点续传；首块即失败（零落地）维持既有 tar 回退行为不变（旧后端兼容）
- [x] task-03: onProgress 进度按块累计上报 files_processed
- [x] task-04: 分批纯逻辑有判别性单测（超限单 op 独占一块、恰好等于阈值、双约束同时生效、保序）；集成测试覆盖全落地/中途失败不回退 tar/首块失败仍回退 tar 三态
- [x] task-05: 既有 daemon 测试套件全绿
