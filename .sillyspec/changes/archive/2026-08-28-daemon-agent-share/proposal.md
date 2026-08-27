---
author: qinyi
created_at: 2026-08-28 00:38:14
---

# 提案书（Proposal）

## 动机

平台存在两类断链体验：① 工作区业务人员借用共享守护进程的机制虽已存在
（2026-07-25 daemon 借用），但只覆盖 agent-run 自动选址回退——守护进程页面对
非 owner 完全看不到共享来的 daemon，显式选定 daemon 开会话的路径 owner-only
直接 404，「看到 → 点会话 → 用起来」链路断裂；② 新用户/无 daemon 用户无法
体验平台会话能力，页面注入的悬浮小助手只能答静态页面说明书，无法基于真实
平台源码回答具体功能问题。

本提案用**一张统一授权表 `daemon_runtime_grants`**（用户实选方案 B，D-006）
同时承载两种共享：工作区成员共享守护进程（补齐可见性 + 会话钉定）与平台
管理员共享智能体（全体用户可用 + 只读锚定源码工作区）。

## 关键问题

1. **共享不可见**：`GET /daemon/machines` 等列表端点非 platform admin 固定
   `user_id==actor`（`daemon/runtime/service.py`），业务人员在守护进程页面
   看不到工作区同事共享的 daemon。
2. **会话钉定 owner-only**：`POST /api/daemon/sessions` 显式传 `runtime_id`
   时 `session/service.py:932-937` 校验 `_rt.user_id != user_id` 直接 404——
   共享授权对交互式会话不生效，借用机制只救了自动选址路径。
3. **体验门槛**：无自有 daemon 的用户（新用户/业务人员/纯管理人员）无法开箱
   使用会话；小助手回答平台功能问题缺乏真实源码依据，答得笼统。

## 变更范围

- 新表 `daemon_runtime_grants`（workspace/platform 两类授权 + 存量 shared 迁移）。
- 会话钉定校验、页面可见性、借用回退三处统一切 grants 查询。
- 平台共享智能体管理 API（platform admin）+ 公共 active 端点 + 会话服务端
  强制只读/钉定/cwd 锚定。
- 前端：守护进程页面「共享给我的」区块 + 平台共享智能体管理卡 + 悬浮助手
  共享标识与「平台共享」徽标（用户显式选择共享机器/智能体，D-004@v2）。

## 不在范围内（Non-Goals）

- 不做按个人/按团队的共享（`grantee_type` 预留 `user` 枚举位不实现）。
- 不改 sillyhub-daemon 子项目代码（read_only 白名单/沙箱 marker 链路已实证支持）。
- 不做共享配额/限流/用量统计报表。
- 不做 `WorkspaceMemberRuntime.shared` 列的物理删除。
- 不做共享 daemon 离线告警/自动切换。

## 成功标准（可验证）

- 未共享/未配置共享智能体时，全部现有行为不变（owner 会话、agent-run 借用、
  修改类端点、前端页面渲染）。
- lender 打开共享开关后：同工作区持 `daemon:borrow` 权限的成员在守护进程页面
  「共享给我的」区块看到该机器，可点「会话」创建钉定会话（写借用审计），
  且看不到任何修改类操作入口；后端修改类端点对其仍 403/404。
- 平台管理员创建共享智能体（含共享输出目录 writable_dir）后：任意用户（含
  无 daemon 用户）在会话选择器显式选择共享机器/智能体发起会话，服务端强制
  钉定管理员 runtime + cwd=源码工作区；读源码不受限，写操作被 daemon 沙箱
  限制在 writable_dir 内（可产出文档/原型图，writable_dir 外写被拒绝）。
- 存量 `shared=true` binding 迁移后 agent-run 自动借用行为与迁移前等价
  （借用测试全量通过）。
