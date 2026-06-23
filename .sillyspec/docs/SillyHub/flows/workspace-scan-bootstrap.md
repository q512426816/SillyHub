---
author: qinyi
created_at: 2026-06-24T01:47:08
source_commit: ba87eec
---

# Workspace 扫描与引导流程

## 目标
从本地路径或平台托管目录扫描 `.sillyspec` 骨架，注册 workspace，生成模块/项目文档，并通过 daemon 执行 bootstrap AgentRun 完成初始化扫描。

## 参与模块
- **backend/workspace**：扫描/创建/重扫/重解析/拓扑（`workspace.service` / `scanner` / `topology` / `relation_service`）
- **backend/spec_workspace**：spec bundle 同步、bootstrap（`SpecWorkspaceService` / `SpecBootstrapService`）
- **backend/scan_docs**：扫描文档解析（`ScanDocService` / `ParsedDoc`）
- **backend/agent.context_builder**：`build_scan_bundle` 拼装扫描指令 prompt
- **daemon**：spec bundle pull（session 开始）+ postSpecSync（session 结束）
- **frontend**：workspace 列表/扫描向导（`lib/workspaces.ts` 的 scan/scanGenerate/rescan/reparse）

## 流程摘要

```text
(frontend)  输入 rootPath → POST /api/workspaces/scan
     │
(backend)   Scanner.scan(root)：检测 .sillyspec 骨架 + 计数顶层条目
     │        └─ 浅扫：不深度解析，只判存在
     ▼
(frontend)  scanGenerate → POST /scan-generate  或  create → POST /workspaces
     │
(backend)   WorkspaceService.create：
     │        ├─ 写 platform 存储（platform-managed 时落 spec_root）
     │        ├─ _ensure_spec_workspace（建 SpecWorkspace 行）
     │        └─ 生成 _module-map.yaml → generate-projects（按 prefix 分组写 projects/*.yaml）
     ▼
(backend)   reparse：scan_docs/task/change/knowledge 各 parser 全量解析入库
     │
(backend)   SpecBootstrapService.bootstrap(workspace_id, user_id)：
     │        ├─ 建 bootstrap AgentRun + 写 spec_bootstrap.start 审计
     │        └─ _execute_bootstrap_agent_run：
     │             · build_scan_bundle → step_prompt
     │             · 派发到用户 daemon（daemon-only）
     │             · 无在线 daemon → spec_bootstrap_no_online_daemon 审计
     ▼
(daemon)    pullSpecBundle（session 开始）→ 执行 scan prompt
     │        → postSpecSync 回写扫描产出
     ▼
(backend)   bootstrap 完成后再 reparse，前端展示模块拓扑（topology）
```

## 失败回滚

| 失败点 | 处理 |
|--------|------|
| 路径无 .sillyspec | scan 返回 has_sillyspec=false，提示走 scan-generate |
| daemon 离线 | bootstrap 审计记 no_online_daemon，AgentRun 等待 |
| bundle 下载失败 | daemon pullSpecBundle 抛错，session failed |
| 模块映射缺失 | generate-projects 跳过，留空项目列表 |
| 旧路径残留 | scanner 兼容 legacy `changes/change/` 布局 + deprecation 警告 |

## 关键术语
- **Scanner**：浅扫 `.sillyspec` 骨架存在性的探测器
- **spec_root_map**：容器→宿主机路径映射（"from:to"，容忍 Windows 盘符）
- **platform-managed**：spec_root 由平台存储托管（vs 用户本地路径）
- **SpecBootstrapService**：建 bootstrap AgentRun 派发 daemon 完成首扫
