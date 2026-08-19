---
author: qinyi
created_at: 2026-08-19 09:40:00
scale: large
---

# 提案：跨工作区团队执行 + 项目维度会话

## 问题

平台团队模式（AgentMission）钉死单个 workspace：`workspace_id NOT NULL`、5 个 MCP 接口 URL 即 `/workspaces/{id}/missions/...`、worker worktree 与 converge merge 落单 ws root、dispatch 只查该 ws 的 member binding。

真实场景做不到：同一 PPM 项目的不同工作区挂在不同机器的 daemon 上（前端 ws 绑机器 A、后端 ws 绑机器 B），项目经理要在项目维度发起一次会话，agent 团队按任务性质把工作派到对应工作区/机器。

## 方案

方案 A（anchor + scope JSON 最小改造）：

1. `AgentMission` 语义扩展：`workspace_id` 收窄为 anchor（主工作区，列不动仍 NOT NULL，D-009）；新增 `project_id`（FK PPM 项目）+ `scope_workspace_ids`（JSON 快照，创建时冻结）。
2. worker 派发加 `target_workspace_id`：worktree/provider/placement 全按目标 ws 路由；代表 binding（owner 优先→任意在线）解决发起人在目标 ws 无绑定的问题（D-001@v2，仅 worker target≠anchor 场景，主 agent 维持现状 borrow，D-004@v2）。
3. converge 按工作区分组 merge + cleanup（D-003、D-011），`HostFsDelegate` 按 ws→daemon 路由 RPC 的既有机制零改动。
4. 项目维度新入口 `POST/GET /projects/{pid}/missions`（scope 圈选治理=PPM 项目经理，D-008）。
5. 双 MCP 通道（链路A mcp_tools + 链路B mcp_gateway）同款对齐（D-010）；鉴权锚=anchor（D-006，token 项目化被否决后的服务端 scope 校验闭合）。

## 预期收益

- 项目经理在项目维度发起一次团队会话，前端任务自动可派 A 机、后端任务派 B 机。
- 工作区代表 binding 让派发不再要求发起人是所有工作区成员（团队协作解锁）。
- 存量单 ws mission 全链路零回归。

## 成本与风险

17+ 文件（backend 13 / daemon 2 / frontend 5），单 migration。主要风险：代表 binding 的授权语义（scope 圈选即授权，R-01）、越界派发（服务端硬校验，R-02）、anchor 级联删除边界（R-05）。详见 design §9。

## 不在范围内（Non-Goals）

- 不新建 ProjectSession / 项目任务组实体。
- 不做跨仓库统一 PR / 跨仓 diff。
- 不改 PPM 侧 schema / 端点（ppm_project_workspace 只读消费）。
- 不做 scope per-workspace 元数据（YAGNI）。
- 不改 shmcp_ token 绑定模型。
- 不做运行中动态增删 scope（快照冻结）。
- 不动 borrow（借用）语义。
