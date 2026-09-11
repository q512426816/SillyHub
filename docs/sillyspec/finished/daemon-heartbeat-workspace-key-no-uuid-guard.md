---
author: qinyi
created_at: 2026-09-09T13:38:00
---

# daemon 心跳两键的工作区标识无 UUID 校验——任一非 UUID 键即 422 全心跳被拒

> **修复状态（2026-09-09 当日，commit ef5b3c76a）**：
> - ✅ `_collectSpecCacheEntries` 目录名 UUID 校验（非 UUID 跳过 + warn 一次）已实施；
> - ✅ status-roots.json 写入侧（claim 学习键）+ 读侧（存量污染键过滤）UUID 校验已实施；
> - ⏳ 心跳 422 日志提升 `loc` 到 warn 摘要行——未实施（守卫落地后 422 不再发生，收益归零，
>   建议留档）；
> - ⏳ daemon 发版部署后本条移 finished/。

## 现象（2026-09-09 实证）

daemon 心跳连续 422：`spec_cache[2].workspace_id` uuid_parsing 失败，远程平台拒绝整次
心跳（连带心跳携带的其它状态全部丢失），daemon 进入 heartbeat_failed → reconnect 循环。

## 根因（两个心跳键、两条污染路径）

1. **`spec_cache[]` 实时扫描不校验目录名**（`sillyhub-daemon/src/daemon.ts`
   `_collectSpecCacheEntries`）：每次心跳 `readdir(~/.sillyhub/daemon/specs/)` 把**每个子
   目录名**直接当 `workspace_id` 上报。任何非 UUID 目录名（本次实证：junction 切换时把
   实体目录 rename 成 `b97f8231.pre-junction-backup-20260909` 留在 specs 根下）即毒化
   心跳；backend pydantic 严格 uuid 解析 → 422。备份/临时目录放 specs 根是合理误操作面，
   无人会想到「目录名=协议字段」。
2. **`sillyspec_status_map` 键来自 status-roots.json 学习表**（
   `~/.sillyhub/daemon/sillyspec-status-roots.json`）：同日实证发现 `ws-b1`/`ws-b2`/
   `ws-b3`/`ws-b4`（root_path 全指向 Temp）测试残留被写进生产状态文件——claim 学习映射
   对写入键不校验 UUID，测试联调的假 wsId 持久化后同样进入心跳载荷。

两键共同模式：**生产协议字段（UUID）由宽松来源（目录名/学习表）填充，写入与上报两端
都无 UUID 校验**；一处污染 = 整心跳被拒 = daemon 与平台失联（且日志只有 422 摘要，不含
具体是哪个键非法——`spec_cache[2]` 靠 loc 才定位到）。

## 建议工具修复方向

- daemon `_collectSpecCacheEntries`：目录名做 UUID 形状校验（36 位 4 连字符），非 UUID
  跳过并 `warn` 一次（它可能是备份/临时目录，不该进心跳也不该静默）。
- status-roots 学习表写入侧同款校验（非 UUID 键拒绝登记）。
- 心跳失败日志把 422 响应体里的 `loc`（如 `spec_cache[2].workspace_id`）提升到 warn 摘
  要行，免去从原始 JSON 里挖。

## 现场修复（供复用）

- specs 根下的非 UUID 目录挪出（如 `~/.sillyhub/daemon/spec-backups/`），下一跳心跳自动
  恢复（spec_cache 是实时扫描，无需重启 daemon）。
- status-roots.json 删非 UUID 键后需重启 daemon（该表启动时读入内存）。

## 关联

- junction 治理实操：docs/sillyspec/init-lease-silent-no-local-yaml.md（同日另一坑）
- 2026-09-10 定时复核：修复 commit ef5b3c76a 已验证在 main（UUID 双侧校验两项 ✅；422 日志 loc 提升项按本文件裁决留档不做）；待 daemon 发版部署后归档。

## 处置记录（2026-09-11 定时收口，部署实证，归档）

- 修复已随 daemon 构建分发并落地本机：`~/.sillyhub/daemon/bin/sillyhub-daemon.js`（2026-09-10 23:47 更新的 bundle）实证含 `spec_cache_non_uuid` 守卫标记（commit ef5b3c76a 的写入/读侧/上报三端 UUID 校验）；422 日志 loc 提升项按本文件自身裁决留档不做（守卫落地后 422 不再发生，收益归零）。
- 现场修复指引（specs 根非 UUID 目录挪出 + status-roots.json 清键重启）已无需日常使用，保留备查。归档。
