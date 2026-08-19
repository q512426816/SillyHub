---
schema_version: 1
doc_type: proposal
change_name: 2026-08-19-runtime-live-daemon-read
author: qinyi
created_at: 2026-08-19T06:25:00+00:00
---

# 提案：运行时状态页面实时化改造

## 要解决什么问题

`/workspaces/[id]/runtime`（运行时状态）页面当前读取的是平台容器内 `spec_ws.spec_root` 下由 spec-sync 推送的快照数据。由于增量同步排除 `.runtime/` 目录，页面展示的进度、用户输入、步骤产物往往与守护进程（daemon）实际执行状态严重脱节，导致用户无法准确判断工作流运行情况。

## 建议怎么做

把运行时状态页的数据源从「平台侧同步快照」切换为「当前 workspace 当前用户绑定的 daemon 实时数据」：

1. 后端 `runtime` 模块新增 `RuntimeLiveService`，通过 `MemberBindingResolver` 解析用户绑定，`ws_hub.send_rpc` 向 daemon 发起 `runtime.*` RPC。
2. daemon 侧新增 `runtime-handler.ts`，处理四类读取请求：进度（调用 sillyspec CLI 只读 JSON 命令）、用户输入、产物列表、单个产物内容。
3. 跨仓 `sillyspec` CLI 新增 `sillyspec progress dump --spec-dir <path> --json` 只读命令，输出 machine-interface envelope。
4. 前端调整页面标题、副标题、错误提示文案，明确数据来自守护进程实时读取。

## 不在范围内

- 不新增浏览器到 daemon 的直连通道。
- 不把运行时数据写回 `platform_sync` 进度同步层。
- 不改造 `sillyspec.db` 存储格式。
- 不修改 workspace 成员绑定模型。

## 预期收益

- 运行时状态页与 daemon 实际执行状态一致，消除「平台显示旧阶段、本地实际已推进」的误导。
- 统一使用 explorer 已验证的 daemon RPC 链路，降低架构碎片化。
- 为后续「平台管理文件增量同步」等需求奠定实时读取 daemon 数据的基础范式。

## 主要风险

- 跨仓 sillyspec 命令发版协调：旧版 sillyspec 不支持 `progress dump` 时，daemon 需给出明确版本过旧引导。
- daemon 离线时页面不可用（已明确不回退快照）。

## 参考决策

- D-001@v1：daemon 离线/失败不回退平台快照。
- D-002@v1：进度经 sillyspec CLI 只读 JSON 命令读取。
- D-003@v1：三类数据全部实时读 daemon。
- D-004@v1：鉴权复用 `MemberBindingResolver` 用户门控绑定解析。
- D-005@v1：daemon 侧新增独立 `runtime.*` RPC 命名空间。
