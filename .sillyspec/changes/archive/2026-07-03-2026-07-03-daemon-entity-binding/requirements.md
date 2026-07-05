---
author: qinyi
created_at: 2026-07-03 11:14:39
change: 2026-07-03-daemon-entity-binding
stage: brainstorm
---

# Requirements — 守护进程实体化绑定

## 功能需求

| ID | 需求 | 决策 |
|---|---|---|
| FR-01 | daemon 本地持久 uuid 上报作 `daemon_instances.id` 主键；config 按 server_url 隔离文件（per-server per-machine 唯一） | D-001 |
| FR-02 | `daemon_runtimes` 加 `daemon_instance_id` FK（CASCADE），移除 os/arch/allowed_roots/capabilities（提升到 daemon 实体） | D-002 |
| FR-03 | `daemon_task_leases.runtime_id` 与 `daemon_change_writes.runtime_id` FK 保留不动（记录哪个 provider 跑） | D-003 |
| FR-04 | `workspace_member_runtimes` 加 `daemon_id` FK→daemon_instances（RESTRICT，nullable）；PUT /my-binding 写 daemon_id | D-004 |
| FR-05 | dispatch 按 `workspace.default_agent` 在该 daemon 在线 runtimes 里找 provider 匹配；支持 agent 发起时单次 provider 覆盖 | D-005 |
| FR-06 | daemon 注册 / WS Hub / 心跳改 per-daemon（一 daemon 一条 WS，握手带 daemon_local_id） | D-006 |
| FR-07 | WS breaking：daemon 与 backend 同步升级；数据倾向重置，提供 cleanup 脚本 | D-007 |
| FR-08 | default_agent 与 daemon 已启用 provider 不匹配时报错提示，不自动 fallback | D-008 |
| FR-09 | 前端 switcher 选 daemon（显示 hostname + 启用 provider 徽标）；default_agent 独立选择器 | design §7 |
| FR-10 | scan/init lease 与 agent run 共享 MemberBindingResolver，改 resolver 后自动覆盖 | design §6 (X-002) |

## 非功能需求

| ID | 需求 |
|---|---|
| NFR-01 | 兼容 Windows / Linux / macOS（config 路径用 os.homedir，路径分隔符跨平台） |
| NFR-02 | backend 测试：daemon/runtime/workspace/agent placement 模块 + 新增 daemon_instance 注册/心跳/WS 握手用例 |
| NFR-03 | daemon 测试：config 按 server_url 隔离 + per-server daemon_local_id + 单 WS 用例 |
| NFR-04 | frontend 测试：switcher 选 daemon + default_agent 独立选择器用例 |
| NFR-05 | 部署文档标注「daemon 与 backend 同步升级」+ 回退路径 |

## 非目标（YAGNI）

- 不改 agent-detector 探测逻辑（仍扫 PATH）。
- 不引入「一成员绑多 daemon」。
- 不改 lease / change_write 的 runtime_id 引用。
- 不新增 daemon 端 provider 启停 UI。
- 不做 runtime_id→daemon_id 历史数据迁移脚本（重置）。
