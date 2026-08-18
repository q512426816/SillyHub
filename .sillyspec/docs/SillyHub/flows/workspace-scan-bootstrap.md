---
author: qinyi
created_at: 2026-06-24T01:47:08
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
---

# Workspace 扫描与引导流程

## 目标
从本地路径或 daemon 宿主目录探测 SillySpec 骨架并注册 workspace，解析模块/项目文档入库，经 daemon 执行 bootstrap AgentRun 完成首扫，或经 init 派发在成员机器上初始化一个 SillySpec 项目并写入本机配置。

## 参与模块
- workspace：scan 预览扫描 / scan-generate（daemon client RPC 源，`_guard_daemon_owned_by_user` 归属校验 + `_find_active_scan_run` 防并发）/ create（软删复活 + `_ensure_spec_workspace` 连带建 spec 空间）/ rescan / init 派发入口 / 组件目录从 projects/*.yaml 只读派生
- spec_workspace：bootstrap（mode: single / team / auto）、bundle 流式打包、import 从仓库导入（SSE + daemon RPC 打包容主 .sillyspec）、SpecPathResolver 双模式解析 spec 目录
- scan_docs：docs 树解析落库（ScanDocument 只读索引层，reparse 对账 + 软删）
- change：changes/ 解析入库（两阶段 reparse 的另一半）
- agent：start_scan_dispatch / start_init_dispatch、context_builder 拼装扫描 prompt、post_scan_validator 扫描后校验
- daemon：spec bundle pull / RPC 打包容主 .sillyspec（不受 30s 代理超时限制）、handleInitLease 编排（写 .sillyspec-platform.json + spawn sillyspec init + writeLocalYaml 写 .sillyspec/local.yaml）
- mcp_gateway：init claim 时 get_or_issue 签发 shmcp_（scope=dispatch）供 local.yaml mcp 派发段
- platform_sync：shpsync_ token 签发（进度回传通道）
- knowledge：知识条目解析
- frontend_app / frontend_lib：workspace 列表/扫描向导（lib/workspaces 的 scan/scanGenerate/rescan）

## 流程摘要

```text
=== 扫描与建区 ===
(前端)      输入 rootPath → POST /api/workspaces/scan
(backend)   WorkspaceScanner.scan：扁平根判定（projects/ 或 changes/ 任一存在
     │      即 SillySpec 工作区，D-005 platform-managed 无 .sillyspec 包裹）
     │      + 结构标志 + 计数 + parser 产出 parsed_workspaces/警告
     ▼
(前端)      scan-generate（daemon client 源）或 POST /workspaces 创建
(backend)   WorkspaceService.create：
     ├─ 同 root_path 软删行可复活（partial unique index WHERE deleted_at IS NULL）
     ├─ _ensure_creator_as_owner（RBAC 种子）
     └─ _ensure_spec_workspace 连带建 1:1 spec 空间（platform-managed 默认）
     ▼
(backend)   两阶段 reparse：scan_docs（docs 树→ScanDocument）
            + change（changes/→Change）入库对账；组件目录从 projects/*.yaml 只读派生
     ▼
=== bootstrap 首扫（可选）===
(前端)      POST /spec-bootstrap（mode: single / team / auto）
(backend)   SpecBootstrapService.bootstrap（audit spec_bootstrap.start）：
     ├─ single：建 AgentRun 交互执行（尊重 workspace default_agent，缺省回退 claude）
     ├─ team/auto：Coordinator 拆并行只读 Worker（arch/style/test/integration/risk）
     │    + Finalizer 合并 Artifacts
     └─ 异步后台跑，前端走 SSE/log 事件（_publish_log_event / _publish_done_event）
(daemon)    pullSpecBundle → agent 执行扫描 prompt → postSpecSync 回写产出 → reparse 入库
     ▼
=== init 派发（成员机器初始化）===
(前端)      POST /workspaces/{id}/init（workspace 成员权限）
(backend)   AgentService.start_init_dispatch → init lease（payload 含 platformConfig
            与 local_yaml：shpsync_/shmcp_ token 注入）
(daemon)    _runInitLease（不 spawn agent）：
     ├─ 写 .sillyspec-platform.json + .runtime/spec-version.json
     ├─ pull 文档（404 容错）
     ├─ spawn `sillyspec init --dir <root> --spec-dir <缓存根> --workspace-id <id>`（60s 超时）
     └─ writeLocalYaml 写 .sillyspec/local.yaml（platform 同步段 + mcp 派发段）
     ▼
=== 持续同步 ===
(daemon)    会话/spec-sync 增量推送（见 spec-incremental-sync 流程）
(backend)   apply_ops 落盘 → scoped/全量 reparse 对齐 DB
```

## 失败回滚

| 失败点 | 处理 |
|--------|------|
| 路径无 SillySpec 骨架 | scan 判非工作区；走 init 派发从零新建 |
| daemon 归属不符 | scan-generate 403（_guard_daemon_owned_by_user） |
| 并发重复扫描 | _find_active_scan_run 拦截 |
| bundle 拉取失败 | daemon 侧抛错（pull 404 容错，缓存目录后续由 sillyspec 自建），可重试 |
| bootstrap agent 失败 | `_write_run_log` 落盘日志排查；SSE done 事件带失败态 |
| sillyspec init 失败/超时 | ok:false + sillyspec_init_failed（stdout/stderr 截断收集），60s 超时杀树 |
| validator 校验失败 | 不阻断流程，记 SpecConflict + sync_status=dirty 待手动 resolve（resolve 后不自动重验） |
| daemon 本地缓存过旧推不出新 change | sync-manual 透传宿主 root_path 让 daemon 改打宿主 .sillyspec；或走「从仓库导入」RPC（SSE 不受 30s 代理超时限制） |
