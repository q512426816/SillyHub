---
author: flow-machine-draft
created_at: 2026-10-10T07:09:28.192Z
---
# 决策记录（Decisions）— 2026-10-10-repo-native-no-platform-markers

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：- 最大风险：给用户源项目建空 `.sillyspec` 是对源项目的写操作——但 repo-native 语义即「扫描直接写源项目」，创建工作区时 ⚠ 警示已明示，属授权范围内最小写面（仅空目录）。次风险：备份目录在 specs/ 根堆积（每次策略切换最多一个），低频可接受，注释明示。 - 放弃的方案：① 改 sillyspec CLI 加 `--strategy` flag 显式跳过三写——跨仓接口变更，且自指守卫已存在，修前置条件即可闭合，不扩战线；② isSelfReferentialSpecRoot 在 cwd/.sillyspec 不存在时弱化判定（resolve 字符串比对）——junction 路径字符串本就不等，弱判定不可靠，治标不治本；③ 普通目录残留直接 rm 后建 junction——违背 R-01 防误删原则（残留可能含历史托管数据），rename 备份保数据。
