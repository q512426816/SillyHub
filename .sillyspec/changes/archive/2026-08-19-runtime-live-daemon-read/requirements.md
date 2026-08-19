---
schema_version: 1
doc_type: requirements
change_name: 2026-08-19-runtime-live-daemon-read
author: qinyi
created_at: 2026-08-19T06:25:00+00:00
---

# 需求清单

## 功能需求

- **FR-01**：运行时状态三类数据（流水线进度、用户输入记录、步骤产物）全部通过 workspace 当前用户绑定的 daemon 实时读取。
- **FR-02**：进度数据由 daemon 调用 sillyspec CLI 只读 JSON 命令获取，daemon 自身不直接解析 SQLite 格式。
- **FR-03**：复用现有 explorer 模块的绑定解析、WS RPC 转发、错误映射链路，保持鉴权与行为一致性。
- **FR-04**：单一数据源。daemon 离线/超时/读取失败时直接报错，不回退到平台快照。
- **FR-05**：前端页面文案从「本地运行态 / 不作为长期事实源」更新为「守护进程运行态 / 实时工作流状态」。

## 非功能需求

- **NFR-01**：RPC 默认超时 30s（与 explorer 文件读取一致），大产物可单独配置；超时返回 504。
- **NFR-02**：错误提示使用中文，并给出可操作引导（如「请启动守护进程」「请升级 daemon」）。
- **NFR-03**：backend 测试不再依赖本地文件系统写 `sillyspec.db` 快照，改为 mock daemon RPC，保证 CI 稳定。
- **NFR-04**：sillyspec CLI 新命令只读，不写 db，不改变任何状态。

## 约束

- **C-01**：不修改 `host_fs` 九方法契约（D-005@v1）。
- **C-02**：不新增浏览器到 daemon 直连通道（NG-01）。
- **C-03**：跨仓 sillyspec 改动需保持向后兼容：旧版 sillyspec 无 `progress dump` 命令时，daemon 应返回 `method_not_found` 并由 backend 映射为 422 版本过旧。

## 决策引用

- D-001@v1：daemon 离线/失败不回退平台快照。
- D-002@v1：进度经 sillyspec CLI 只读 JSON 命令读取。
- D-003@v1：三类数据全部实时读 daemon。
- D-004@v1：鉴权复用 `MemberBindingResolver` 用户门控绑定解析。
- D-005@v1：daemon 侧新增独立 `runtime.*` RPC 命名空间。

## 验收标准

- `GET /api/workspaces/{id}/runtime` 在有绑定 daemon 时返回实时进度；无绑定时 404。
- daemon 离线时返回 502 并带中文引导。
- 旧版 daemon 未注册 `runtime.*` 时返回 422「守护进程版本过旧」。
- 页面标题/副标题不再含「本地运行态 / 不作为长期事实源」。
- backend runtime 模块测试全部通过且不再写本地文件系统快照。
- sillyspec `progress dump --json` 输出符合 machine-interface envelope schema。
