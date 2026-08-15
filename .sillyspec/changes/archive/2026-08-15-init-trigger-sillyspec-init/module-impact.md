---
author: qinyi
created_at: 2026-08-15T16:06:52
change: 2026-08-15-init-trigger-sillyspec-init
stage: plan
status: draft
---

# 模块影响分析（Module Impact）— init lease 触发 sillyspec init

## 影响摘要

本变更横跨三仓：sillyspec CLI 仓（init 命令 flags）、主仓 sillyhub-daemon（init lease 编排）、主仓 backend spec_workspace（增量同步冲突豁免）。对外契约（lease metadata / claim payload / API schema）零变更；行为面变化集中在 daemon init lease 内部编排与 backend apply_ops 冲突语义收紧（同内容 no-op）。

## 按模块

### sillyhub-daemon / spec-sync（主影响）——已核实与 git diff 一致
- `handleInitLease` 编排 5→6 步（pull 后插 runSillyspecInit 硬失败 abort；spec-sync.ts）
- 新增 `runSillyspecInit`（版本门控 MIN_SILLYSPEC_VERSION_FOR_INIT=3.26.8 + spawn shell:true + 60s 超时杀树 + spawnFn 依赖注入）
- `HandleInitLeaseParams` 增可选 `tools`/`spawnFn`
- `UPLOAD_EXCLUDE_TOP_BASE` 共享常量（含 projects）统一 computeIncrementalOps/buildFullManifest/packSpecDir 三处排除 + isUploadExcludedPath 缓存残留防护
- 测试：run-sillyspec-init.test.ts（新）、test_init_lease.test.ts（改写+四组新用例）、spec-sync-incremental.test.ts/spec-sync.test.ts（排除用例）
- 风险闭环：全局 spawn mock 击穿已适配（spawnFn 注入 + child_process mock 按命令分流）

### sillyhub-daemon / task-runner + cli
- `TaskRunner` 构造增可选 `detectedAgents`（cli.ts:769 创建点注入）
- `_runInitLease` 透传 tools（缺省 undefined → 兜底 claude）
- 风险：构造签名变化向后兼容（可选参），既有测试位置参数构造不受影响（已核）

### backend / spec_workspace——已核实与 git diff 一致
- `apply_ops` 冲突分支加同 hash 豁免（service.py:1111-1113，D-008@v2：op.hash==row.content_hash → no-op 不 conflict，new_versions 回服务器版本）
- 语义收紧：原必 conflict 的同内容 add 变 no-op；旧 daemon 不传 hash 行为不变；FileOp schema 零变更
- 测试：test_apply_ops_same_hash_noop.py（新，4 用例含 mtime 不动断言）
- 涉及模块文档：`.sillyspec/docs/SillyHub/modules/spec_workspace.md`（apply_ops 语义段 archive 步同步）

### sillyspec CLI 仓（跨仓 repo:sillyspec）
- `src/index.js` init 参数解析 + `src/init.js` doInstall（--no-skills / --tool 多值 / 平台模式跳过项目内清理）
- 发版顺序约束：CLI 先发，daemon MIN 版本门控兜底（D-009）

### 不受影响模块
- frontend（初始化 UI/轮询零改动）
- backend daemon/lease 模块（metadata 契约零变更）
- skill-manager（--no-skills 后无渠道重叠）
- gate verify 白名单（不放开通用命令执行）

## 测试影响
- daemon：test_init_lease.test.ts 改写（mock 注入点）；spec-sync-incremental.test.ts 补排除用例；新增 run-sillyspec-init.test.ts
- backend：新增 test_apply_ops_same_hash_noop.py；既有 conflict 用例不传 hash 不触发豁免（已核不破）
- CLI 仓：三个新测试文件
- local.yaml modules：sillyhub-daemon / spec_workspace 子模块测试命令已存在（无需新增）
