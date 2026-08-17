---
author: qinyi
created_at: 2026-08-17 08:52:32
---

# 需求文档（Requirements）— CLI 直跑 spec 文件增量同步

## 功能需求

**FR-01 清单接口**
平台应提供接口，让 CLI 获取服务器 `spec_root` 的权威文件清单（每文件含 sha256 hash、version、exists）。

**FR-02 CLI 增量 diff**
CLI 应能 walk 本地 `.sillyspec/` 树，计算每个文件 sha256，与服务器清单对比，生成 add/update/delete/rename 四类操作。

**FR-03 无差异短路**
若本地与服务器清单完全一致，CLI 不应发送同步请求。

**FR-04 增量推送**
CLI 应将差异操作通过 `POST /api/changes/spec-sync` 推送到平台；平台只落盘差异文件。

**FR-05 乐观锁冲突**
当服务器文件 version 已变时，平台应返回 conflict 与当前 server_versions，不静默覆盖。

**FR-06 冲突不阻塞**
CLI 遇到 conflict 时应提示用户，但不得阻塞进度同步或四件套文档同步主流程。

**FR-07 鉴权兼容**
新增端点应复用 `shpsync_` workspace 同步 token，与现有 `sync()` 使用同一份 `local.yaml` 配置。

**FR-08 老后端兼容**
当后端无新端点时，CLI 应静默跳过，不影响既有同步流程。

**FR-09 rename 识别**
文件仅改名、内容未变时，CLI 应生成 rename 操作，不重传内容。

**FR-10 排除非 spec 目录**
CLI walk 时应排除 `.runtime/`、`runtime/`、`worktrees/`、`projects/`，与 daemon 上传链路对齐。

## 非功能需求

**NFR-01 性能**
普通变更树（≤1000 文件）的本地 walk+hash 应在 1 秒内完成。

**NFR-02 可观测性**
冲突/失败应通过 console.warn/debugLog 输出可读信息。

**NFR-03 幂等**
同一操作重复执行应幂等（后端 apply_ops 已保证）。

**NFR-04 平台兼容**
代码路径兼容 Windows / Linux / macOS。
