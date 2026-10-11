---
author: flow-machine-draft
created_at: 2026-10-11T04:56:47.680Z
---
# 决策记录（Decisions）— 2026-10-11-linked-repos-path-guard

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：形态校验挡不住「合法形态的恶意绝对路径」——但那正是功能本体（用户登记自己机器上的任意路径），真正的边界在 backend 归属校验与 sillyspec CLI 自身的写入范围，本变更是把「垃圾/相对形态导致的 cwd 漂移与未定义行为」关掉（纵深防御第二道），不冒充完整授权模型。声明边界：`..` 段在 rel_path 合法（兄弟仓约定）、在 abs_path 不受限。 放弃的方案：① 裸 `path.isAbsolute`——平台相关，ubuntu-latest CI 上 `C:/` fixture 全线假红；② rel_path 禁 `..` 段——打翻既有 `../platform-specs` 兄弟仓约定（fixture 实证），把合法流判成非法；③ daemon 侧维护「已登记路径白名单」——daemon 无 backend 登记面视图，引入状态同步问题且与 RPC 请求-响应模型相悖。
