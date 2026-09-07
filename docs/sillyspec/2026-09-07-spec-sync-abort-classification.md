# spec-sync 间歇 "aborted" 异常——CLI 侧已治理，平台侧行动项

- 创建：2026-09-07（sillyspec 仓，quick-2c6da904 / commit 6f17a56 同日闭环 CLI 侧）
- 状态：**双侧均已闭环（2026-09-07 下午）**——CLI 侧修复待发版（npm latest 仍 3.28.0）；平台侧行动项 1 已落地（daemon 注入缺省 20s，commit e0af8e3a0 + 阿里云上架分发），行动项 2 核对后**无需开发**（监控早已存在，见 §4.1 补记）
- 涉及版本：sillyspec ≥ 3.28.1（未发版修复，以 main HEAD 为准）；multi-agent-platform 后端（平台执行环境）

## 1. 现象

平台执行环境（daemon 托管的 quick 流程）跑 `sillyspec run quick --done` 时，终端间歇出现：

```
[spec-sync] 拉取清单异常（文件树本次未同步，下次自动重试）: <change>: This operation was aborted
```

或「[spec-sync] 同步异常 …: This operation was aborted」。间歇出现、**不影响同步结果**（下一条命令自动重试补齐），但英文原始串像未知异常，用户排查一轮才发现无害。

## 2. 根因（CLI 视角的完整链路）

1. CLI 每步 `--done` 后的自动同步走 `src/run/shared.js raceWithAbort` 的 **8s 总预算熔断**（HUB-09，commit e2c9f90 防 `--done` 体感 hang / e1be9b 确定性取消）——整个同步（清单 GET + ops POST 串行）共用 8s，超时即 `controller.abort()` 取消在飞 fetch。
2. 被取消的 fetch 抛 undici AbortError，原始 message 即 "This operation was aborted"。spec-sync.js 两处 catch 此前用 `err.message` 原样拼进 warn（sync.js / quicklog 链路早有人话翻译，仅 spec-sync 漏网）。
3. 间歇性 = **平台后端响应时间抖动**：`GET /api/changes/-/spec-manifest`（与 ops POST）忙时偶发超 8s，空闲时几百毫秒返回。非平台环境本机执行（daemon 不在场）几乎不触发。

历史背景：sillyspec 仓债 E22b（commit b15c222）当时 defer 的判断「8s 熔断仅在平台 hang 时触发且需真实平台环境复现；连续失败退避降频属设计决策，随 sillyhub 后端排期」——本次正是该 defer 场景在真实平台环境复现。

## 3. CLI 侧已落地的修复（commit 6f17a56，2026-09-07）

- **warn 分类翻译**（`spec-sync.js describeSyncError`）：AbortError →「平台响应慢，本轮同步被总预算熔断让路（best-effort，下一条命令自动重试）」；TimeoutError →「单请求超时（清单 10s / 推送 30s 口径）」；其余错误原样。英文原始串不再出现在终端。
- **熔断总预算 env 可调**（`run/shared.js resolveSyncTotalTimeoutMs`）：`SILLYSPEC_SYNC_TIMEOUT_MS` 整数毫秒 [1000, 120000]，非法/越界回退默认 8s。
- 回归测试 16 断言（`test/spec-sync-abort-classification.test.mjs`），npm test 358/358 绿。
- 详细复盘见 sillyspec 仓 `docs/sillyspec/troubleshooting.md` 条目 #54。

**daemon/平台执行环境如需立即缓解**：给 sillyspec 命令环境注入 `SILLYSPEC_SYNC_TIMEOUT_MS=20000`（示例值），熔断预算从 8s 放宽到 20s。代价是 `--done` 最坏等待同比例变长；不改也仅是 warn 噪音，数据不丢。

**✅ 平台侧已落地（2026-09-07，multi-agent-platform commit e0af8e3a0，ql-20260907-007-67df）**：
- `sillyhub-daemon/src/spawn-env.ts`——`buildSpawnEnv` 填补缺省注入 20000（**填补非覆盖**：process.env / tool_config.env 已预设保留原值，空串视同未配置），batch / interactive / restore / reload 全部 agent 子进程路径单点覆盖；
- `sillyhub-daemon/src/sillyspec-manager.ts`——`runProgressJsonDefault`（daemon 自身跑 sillyspec 命令的 execFile 执行器）显式传 env「缺省垫底 + process.env 覆盖」，覆盖 runResolve / ghostCleanup（含平台同步收敛）；
- 同日随 backend 镜像重建上架阿里云 `/daemon/` 分发（BUILD_ID 9a9bd881-20260907132501），存量 daemon 经自更新拉新 bundle 后生效；vitest 80 passed + tsc 0。
- 生效前提：sillyspec npm 发版 ≥3.28.1（3.28.0 不认该 env，注入空转无害；daemon preflight/1h 循环装 latest 自动跟上）。

## 4. 平台侧行动项（治本：为什么 manifest 会 >8s）

### 4.1 【已核对，无需开发】端点响应时长观测——平台早已有

> **补记（2026-09-07）**：本文档初稿「平台侧没有任何 per-endpoint 耗时统计」系误判。backend 监控三件套 **2026-07-27 已上线**（commit `3a181291a`，`backend/app/core/monitoring.py`，main.py 已挂 middleware）：①慢请求日志（任何接口 >1s 打 `slow.request`，含 path/status/duration/request_id）；②慢查询日志（SQL >500ms 打 `slow.query`）；③请求 ≥10s 自动异步采样 `pg_stat_activity`（含 wait_event 与锁等待链，打 `db.stat_activity_sample`，30s 节流）。
>
> 熔断预算注入 20s 后，任何熔断类事件都蕴含**服务端耗时 ≥20s**——必然先触发 slow.request 日志并大概率触发 pg_stat_activity 采样（并发状态快照正中 §4.2 要查的池位/锁争抢）。观测链已闭环，本节原建议的「加 p50/p95/p99 middleware」不必再做；若将来需要长期分位数面板再议。

`GET /api/changes/-/spec-manifest`、`POST /api/changes/-/spec-sync`（以及同族 progress/approval 推送端点）目前**没有 per-endpoint 耗时统计**。建议（任一即可，按平台现有监控体系选最小改造）：

- FastAPI middleware 按路由记录响应时长（p50/p95/p99），进现有日志或监控面板；
- 或 SQLAlchemy 事件层记慢查询（`statement_timeout` 已在 30s，但这只防失控全表扫描，不管「正常但慢」的查询）。

验收标准：下次 CLI 侧再报熔断类 warn 时，能在平台侧直接查到该时刻 manifest 端点耗时与并发状态，不用靠推断。（已由监控三件套满足，见上方补记。）

### 4.2 【按观测结果决定】排查忙时慢点

已知事实（本仓代码核对，2026-09-07）：

- `get_spec_manifest` 是单表查询（`spec_file_manifest`，有 `(workspace_id, path)` 唯一索引 + version 索引，`backend/app/modules/spec_workspace/service.py:498`），逻辑上不该慢——**慢大概率不在 SQL 本身**；
- 更可疑的争抢来源：执行忙时多 worker 并发跑 `--done`，各自 POST progress/ops，共享 `AsyncSession` 连接池（`core/db.py`：pool 20 + overflow 30）与 PG 写锁（manifest/change 行级锁），读请求排队等池位/等锁；
- 相关先例：core/db.py 的 `_IDLE_IN_TXN_TIMEOUT_MS` 注释记录过「事务内 await 慢外部调用导致全站周期性卡 ~17s」（2026-07-28 阿里云实测，ql-20260728-008）——同形态的事务持锁等待是本类抖动的已知家族。

若观测确认是池位/锁争抢，可选方向（按成本排序）：① manifest 读端点用独立短事务/只读会话减少与写事务的池位竞争；② 推送端点入队削峰（执行并发高时）；③ 池子扩容（治标，先确认不是泄漏）。

### 4.3 明确不需要做的

- **不需要**改 CLI 的 best-effort 重试契约（本轮放弃、下条命令补推）——它是刻意设计（spec 树推送无 base_ts 自愈兜底，宁可本轮不推也不半推）。
- **不需要**上连续失败退避降频——债 E22b 已裁决为设计决策，随 sillyhub 后端排期，与本坑独立。

## 5. 复现 / 验证 CLI 修复

```bash
# sillyspec 仓，node ≥ 20.3
node test/spec-sync-abort-classification.test.mjs   # 16 断言全绿
```

测试 A2 段即生产场景复现：本地 mock 服务器挂 8s 应答，外部 400ms abort（模拟熔断），断言 warn 走分类文案、不再露 "This operation was aborted"。
