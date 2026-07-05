---
author: qinyi
created_at: 2026-06-23 10:38:24
change: 2026-06-23-spec-transport-tar-sync
---

# Proposal: spec 文档回传 backend 独占（transport 双模式）

## 动机

daemon 与 backend 部署在两台独立物理设备、无共享磁盘时，scan（及所有写 `.sillyspec/` 的
stage：propose/plan/execute）生成的 spec 文档物理落盘在 daemon 设备本地，backend 服务器
读不到——文件「存到了用户本地」而非「存到服务器」。当前落盘机制依赖「daemon 与 backend
同机 + Docker bind mount 共享物理盘」的隐含假设（前置变更 `2026-06-22-a1-backend-host-path`
/ commit `fcbf3fa7` 方案 B），异机拓扑下该假设失效。

## 关键问题（现有方案为何不够）

1. **prompt 路径写死宿主路径**：`build_scan_bundle` 在 prompt 写 `--spec-root
   spec_data_host_dir/{ws}`（生产 `C:/data/spec-workspaces/{ws}`），daemon 在自己机器跑
   scan 写该路径，同机时 backend 经 bind mount 见到；异机时该路径只是 daemon 本地盘，
   backend 的 `/data/` 是空的。
2. **interactive 路径无回传机制**：scan/stage 走 interactive lease（不经 task-runner），
   daemon interactive 路径只有 SPEC_ROOT_MAP 翻译，没有 pull/回传逻辑，文件无法跨设备到达 backend。
3. **backend 非真理源**：异机场景 backend 不持有 spec 文档，reparse 读不到，ScanDocument
   表空，下游 stage 读不到 scan 产物。

## 变更范围

- 引入 transport 维度（`shared`/`tar`，全局 `SPEC_TRANSPORT` 开关，正交于
  `SpecWorkspace.strategy`）
- tar 模式：backend 独占真理源；daemon 本地缓存；session 开始 pull（backend→daemon）/
  session end 整树 tar 回传（daemon→backend）
- scan + 全 spec 写盘链路（propose/plan/execute）统一覆盖
- 抽 daemon spec 同步为共享 `spec-sync.ts` utility（batch + interactive 共用）

## 不在范围内（显式清单）

- **N1**：不做 per-workspace / per-daemon transport 选择（全局单一；不能混部同机+异机
  daemon，已知约束 R-04）
- **N2**：不做每步增量回传（session complete 一次性回传）
- **N3**：不碰 `sillyspec init` 语义
- **N4**：不做切换 transport 的历史数据迁移（数据可清）
- **N5**：不引入 backend→daemon RPC 反向拉取通道

## 成功标准（可验证）

- **SC-1**：`SPEC_TRANSPORT` 未配置（默认 shared）时，现有同机部署行为完全不变（prompt
  宿主路径、bind mount、不回传）
- **SC-2**：`SPEC_TRANSPORT=tar` 时，scan 跑完后 spec 文档物理存在于 backend
  `/data/spec-workspaces/{ws}/.sillyspec/docs/`，ScanDocument 表有记录
- **SC-3**：tar 模式 daemon 本地保留 `~/.sillyhub/daemon/specs/{ws}` 缓存副本，agent 后续
  stage 可读
- **SC-4**：tar 模式回传失败不阻塞 scan 完成（warn + `sync_status=dirty`，可重试）
- **SC-5**：`test_context_builder` 过时断言（行 142/162）修正，按 transport 分支断言通过
