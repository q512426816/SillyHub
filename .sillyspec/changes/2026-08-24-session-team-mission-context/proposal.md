---
author: qinyi
created_at: 2026-08-24 17:05:00
---
# 提案书（Proposal）

## 动机

会话内派团队落地两天后生产实证暴露**主控盲区**（会话 122a9e86 / mission 0a095758）：预建 mission 后主控轮 prompt 是裸用户文本，主控不知道 scope 有哪些工作区、各工作区在哪台机器、在不在线——只能靠翻 daemon 沙箱里的遗留文件猜，scope 第二工作区从未被使用。同时用户直接反馈三个缺口：新会话派团队置灰不可用、worker 派发强制 git worktree（非 git 目录无法承接）、主 agent 无法选择 scope 内其它工作区承接。

## 关键问题

1. **主控零上下文**：session 预建模式跳过 `render_orchestrator_prompt`（orchestrator.py:278-283/:338-347），常驻 MCP 工具描述是静态的无法携带 mission 信息，且五个工具中没有 mission 状态查询——主控既没被告知也无从查询。
2. **新会话入口断裂**：预建 mission 需要会话 id，新会话首句才创建——预会话派团队按钮硬编码置灰（session-panel.tsx:1657-1669），用户无法开局即团队模式；主 agent 也恒等于会话默认机器/智能体。
3. **派发管线 git 中心**：per-worker worktree 是唯一模式（execution.py:250-330），非 git 目录工作区派发直接 `worktree_create_failed`；文档盘/资料目录类工作区被排除在团队派发之外。

## 变更范围

五层（详见 design §5）：
- **A 主控首轮任务简报**：预建 mission 后首个主控轮 prompt 前缀注入简报（mission_id/锚点/scope 清单含机器+在线+git 模式/工具用法/禁越权约束），展示层保持干净，一次性含失败重注。
- **B mission_status 常驻 MCP 工具**：主 agent 随时查 mission 概要/scope 机器状态/workers；无活跃 mission 优雅返回。
- **C 弹层工作区探测**：后端统一 `POST /workspaces/probe`（任一成员 binding 口径），弹层显示机器名+在线+git 模式。
- **D 非 git 直通**：派发前三态探测（非降级 RPC 通道 stat 绝对路径 `.git`）——git 照旧隔离、确证非 git 直通目录（worktree_branch=None 路径A 语义，finalizer 零改动）、未知维持现状。
- **E 新会话派团队+主 agent 选择器**：create 请求携带 team_mission（flush-only 同事务预建，首句即主控轮+简报）；主 agent 可选 scope 内工作区（钉机器+cwd+默认智能体，仅预会话场景）。

## 不在范围内（显式清单）

- C 层主体：会话↔工作区集合模型、弹层非项目维度自由多选工作区、per-daemon SPEC_TRANSPORT 混部、既有会话跨机器主控迁移（拆独立变更）
- 懒建路径 dispatch_worker 响应增强（靠 mission_status 工具）
- 直通模式并发序列化机制（治理门上限+prompt 提示兜底）
- Codex 引擎 MCP 工具注入（前序变更遗留）
- converge 语义/patrol 判定/派发路由/治理门规则的任何修改
- 历史 mission 数据迁移

## 成功标准（可验证）

- 无 mission 普通会话、既有会话派团队、懒建路径行为逐字节不变（回归测试全绿）
- 复现场景（会话 122a9e86 型）：预建两工作区 scope 后，主控首轮简报正确列出两个工作区+机器在线状态+git 模式；`帮我分析下这个项目是干什么的` 不再落 daemon 沙箱目录猜上下文
- 主控调用 mission_status 能随时拿到 scope 机器状态；无活跃 mission 返回 active=false 不报错
- 非 git 目录工作区派 worker 成功直通执行（worktree_branch=None，converge 跳过合并不报错）；git 工作区照旧 worktree 隔离
- 新会话（预会话）派团队可用：首句创建即预建 mission，首轮即主控轮+简报；主 agent 选 scope 内工作区时会话落该工作区机器/cwd/默认智能体，选离线或未绑机器工作区被明确拒绝
- agent 模块全量 pytest + daemon vitest + frontend vitest 全绿；tsc 0 错误；gen:types 同步
