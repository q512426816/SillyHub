---
author: flow-machine-draft
created_at: 2026-11-04T14:20:16.936Z
---
# 提案书（Proposal）— 2026-11-04-daemon-spec-sync-chunking

## 动机

任务原话转写：daemon spec 同步推送分批化对齐 CLI 修复
生产实证（2026-11-04）：spec 文件树大积压（multi-agent-platform 工作区 2436 ops/45.7MB）下单批推送在客户端预算内上传+服务端 apply 双超，CLI 侧已修（sillyspec 仓 2026-11-04-sync-push-chunking：双约束切块顺序 POST，1997 ops 23 块全部落地）。daemon 侧 spec-sync.ts 增量推送仍是单批整推（postSpecSyncIncremental 一次传全部 ops），且失败后回退整包 tar 上传——大积压下增量超时→tar 更大必超时的恶性循环，长时间离线再回归时必然复发。

成功标准：
- daemon 增量推送按 op 数与 base64 字节粗估双约束切块（缺省 128 ops / 2MiB，env SILLYSPEC_SPEC_SYNC_CHUNK_OPS / SILLYSPEC_SPEC_SYNC_CHUNK_BYTES 可调，键名与 CLI 一致）顺序提交，块响应合并（conflict 任一块真、server_versions/new_versions 累积）后走既有 conflict re-base 与缓存回写路径，对外行为与单批等价
- 中途块失败且已有块落地时禁止回退整包 tar（部分落地后 tar 全量覆盖有覆盖他端写入风险且必超时），异常上抛由下轮同步以服务器清单为锚断点续传；首块即失败（零落地）维持既有 tar 回退行为不变（旧后端兼容）
- onProgress 进度按块累计上报 files_processed
- 分批纯逻辑有判别性单测（超限单 op 独占一块、恰好等于阈值、双约束同时生效、保序）；集成测试覆盖全落地/中途失败不回退 tar/首块失败仍回退 tar 三态
- 既有 daemon 测试套件全绿

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. daemon 增量推送按 op 数与 base64 字节粗估双约束切块（缺省 128 ops / 2MiB，env SILLYSPEC_SPEC_SYNC_CHUNK_OPS / SILLYSPEC_SPEC_SYNC_CHUNK_BYTES 可调，键名与 CLI 一致）顺序提交，块响应合并（conflict 任一块真、server_versions/new_versions 累积）后走既有 conflict re-base 与缓存回写路径，对外行为与单批等价
2. 中途块失败且已有块落地时禁止回退整包 tar（部分落地后 tar 全量覆盖有覆盖他端写入风险且必超时），异常上抛由下轮同步以服务器清单为锚断点续传；首块即失败（零落地）维持既有 tar 回退行为不变（旧后端兼容）
3. onProgress 进度按块累计上报 files_processed
4. 分批纯逻辑有判别性单测（超限单 op 独占一块、恰好等于阈值、双约束同时生效、保序）；集成测试覆盖全落地/中途失败不回退 tar/首块失败仍回退 tar 三态
5. 既有 daemon 测试套件全绿

## 成功标准（可验证）

1. daemon 增量推送按 op 数与 base64 字节粗估双约束切块（缺省 128 ops / 2MiB，env SILLYSPEC_SPEC_SYNC_CHUNK_OPS / SILLYSPEC_SPEC_SYNC_CHUNK_BYTES 可调，键名与 CLI 一致）顺序提交，块响应合并（conflict 任一块真、server_versions/new_versions 累积）后走既有 conflict re-base 与缓存回写路径，对外行为与单批等价
2. 中途块失败且已有块落地时禁止回退整包 tar（部分落地后 tar 全量覆盖有覆盖他端写入风险且必超时），异常上抛由下轮同步以服务器清单为锚断点续传；首块即失败（零落地）维持既有 tar 回退行为不变（旧后端兼容）
3. onProgress 进度按块累计上报 files_processed
4. 分批纯逻辑有判别性单测（超限单 op 独占一块、恰好等于阈值、双约束同时生效、保序）；集成测试覆盖全落地/中途失败不回退 tar/首块失败仍回退 tar 三态
5. 既有 daemon 测试套件全绿
