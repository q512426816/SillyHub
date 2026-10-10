---
author: qinyi
created_at: 2026-10-10 17:09:03
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）— 2026-10-10-workspec-maintenance

## 动机

平台缺少 sillyspec workspec（跨仓关联信息）的维护能力：工作区是严格单仓模型
（`workspace.root_path` 唯一约束），「独立 spec 规范仓 ↔ 代码仓」「后端仓 ↔ 前端仓」这类
跨仓关联既不能在平台上配置，也不会落到 sillyspec 工具真正消费的位置（`projects/*.yaml`
子项目登记与 `local.yaml` 的 `repos:` 注册表）。用户定调：不落盘工具消费点、不涉及
sillyspec 工具能力的配置没有意义；工具现有命令能力已足够支撑落盘（D-008）。

## 关键问题

- **配置无入口**：仓间关联（spec 仓、兄弟仓）在平台 UI/DB 层完全空白，每台机器各自手改
  local.yaml / projects yaml，无共享登记、无成员多机适配。
- **工具落盘无链路**：`sillyspec workspace add`（写 projects/<name>.yaml）与
  `sillyspec local register-repo`（写 local.yaml repos:）只能人工在每台机器上跑；
  平台派发的会话、跨仓对账感知不到平台上应该维护的关联关系。
- **成员异构无建模**：同一关联仓在不同成员电脑上位置不同，单一字段无法适配；
  平台已有成员级绑定先例（WorkspaceMemberRuntime）但未覆盖关联仓。

## 变更范围

- backend：新增 `workspace_linked_repos`（共享登记：名称/仓库地址/描述/约定相对路径）与
  `workspace_linked_repo_paths`（成员级本机路径）两表 + CRUD/成员路径 API + 同步触发与
  落盘结果回报端点 + WS RPC 编排。
- sillyhub-daemon：新增 linked-repos-sync 例程——在成员机器上 spawn
  `sillyspec workspace add` 与 `sillyspec local register-repo` 双落盘（cwd=成员本机工作区根），
  能力探测降级，逐层结果 REST 回报。
- frontend：工作区详情新增「关联仓」卡片（管理员维护共享信息、成员维护我的本地路径、
  落盘状态列、立即同步），`pnpm gen:types` 同步类型。
- 测试：backend（CRUD/权限/越权/级联/回报）+ daemon（命令拼装/幂等/降级/失败归一）+
  frontend（卡片渲染/交互）。

## 不在范围内（显式清单）
- 不做：agent 会话上下文注入（AGENTS.md / 前导渲染）——v2 候选（D-002@v2）。
- 不做：仓库侧落盘产物的反向对账/纠偏视图（v2 候选）。
- 不做：变更级跨仓影响标记、scope-audit 主动化、多仓变更/文档聚合（v2 候选）。
- 不做：sillyspec 工具本身的任何改动（零工具侧变更）。
- 不做：关联仓 clone/预取/健康巡检。
- 不做：关联类型枚举（D-006 用户否决）。

## 成功标准（可验证）
- 管理员在工作区详情登记一个关联仓（名称/地址/描述/相对路径）后，成员配置自己的本地
  路径并点「立即同步」：daemon 机器的工作区根出现 `.sillyspec/projects/<name>.yaml`
  （字段：name/path=约定相对路径/status，+repo 当登记了仓库地址时），且该成员 `local.yaml`
  的 `repos:` 段含 `<name>: <成员本机绝对路径>`——两条命令的产物均由 sillyspec CLI 写出（非平台拼 yaml）。
- 卡片状态列逐仓×逐层显示 ok/skipped/failed 与原因；工具版本不足显示「需升级」而非报错；
  成员未配路径时 repos: 层 skipped 且 projects 层可独立成功。
- 未配置关联仓的工作区行为与现状逐字节一致（空态卡片，daemon 零调用）。
- 老 daemon/老工具混布不劣化：RPC unknown method → 状态「daemon 需升级」，CRUD 不受影响。
- 删除关联仓后，成员路径行与状态随之级联清理，再次同步不会复活已删条目。
