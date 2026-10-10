---
author: flow-machine-draft
created_at: 2026-10-10T06:51:49.152Z
---
# 设计记录（Design Record）— 2026-10-10-repo-native-no-platform-markers

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

根因：repo-native 的「零投毒」依赖一条守卫链——sillyspec CLI 的 isSelfReferentialSpecRoot 用 realpath 穿透 junction 判回环，回环则拒写平台标记三件套；而 daemon `pullSpecBundle`（sillyhub-daemon/src/spec-sync.ts）的 repo-native 分支在**源项目无 .sillyspec** 时降级走 platform-managed pull（缓存成普通目录），以及 `ensureSpecJunction` 遇**缓存普通目录残留**时返回 false 降级——两种降级都让缓存不再是 junction，守卫链断裂，init 三写把 `.sillyspec-platform.json` / `.sillyspec-platform-managed` / `.sillyspec-platform-cleaned` 投毒进源项目根（deepseek-harness 项目实证：无 .sillyspec 但三件套齐全）。

修法（daemon 单侧，sillyspec CLI 零改动）：① repo-native 分支源项目无 .sillyspec 时不再降级——就地 mkdir 空目录后照常建 junction（「源项目即真理」语义下空真理源就地创建，用户创建工作区时的 ⚠ 写入警示已覆盖该授权）；② `ensureSpecJunction` 普通目录残留从「直接 return false 降级」改为「rename 到 `<wsId>.pre-junction-backup-<时间戳>` 备份后建 junction」，rename 失败才保守降级。两处都把 junction 成功率拉满，守卫链在全部 repo-native 路径闭合。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `pullSpecBundle`（sillyhub-daemon/src/spec-sync.ts）：签名无变化；行为变化 = strategy=repo-native 且源项目无 .sillyspec 时新增「mkdir 空目录 + junction」路径（原为降级 pull），新增日志 `repo_native_source_created`。
- `ensureSpecJunction`（同文件，模块私有）：签名无变化；行为变化 = 普通目录残留由「return false 降级」改为「rename 备份后建 junction」，新增日志 `junction_stale_dir_backed_up` / `junction_backup_rename_failed_fallback`。
- backend API / sillyspec CLI / 前端：**无变化**（守卫逻辑本就存在于 sillyspec CLI，本变更只保证其前置条件成立）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   不适用——pullSpecBundle 在 init lease 编排内单次同步执行，无乱序事件面；mkdir/junction 建立是幂等前置（ensureSpecJunction 对「已是 symlink 且目标一致」复用）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   同一 workspace 的 init lease 由 backend lease 机制单执行体持有；跨 workspace 各自操作独立 specDir。理论竞态：init 与心跳预取同时进 pullSpecBundle——既有行为已存在（junction 复用分支幂等），本变更未加宽竞态面：mkdir recursive 幂等、rename 竞态失败即走降级兜底分支。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   mkdir 后、junction 建立前中断 → 源项目留空 .sillyspec（合法状态，下次重试继续）；rename 备份后、junction 建立前中断 → 缓存路径短暂缺失，下次 pullSpecBundle 重走 ensureSpecJunction（specDir 不存在 → 直接建），备份目录数据不丢。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   specDir 按 wsId 隔离、备份目录带 wsId+时间戳前缀，无串台；mkdir 只触碰本 workspace rootPath 下的 .sillyspec，不涉其它项目。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：给用户源项目建空 `.sillyspec` 是对源项目的写操作——但 repo-native 语义即「扫描直接写源项目」，创建工作区时 ⚠ 警示已明示，属授权范围内最小写面（仅空目录）。次风险：备份目录在 specs/ 根堆积（每次策略切换最多一个），低频可接受，注释明示。
- 放弃的方案：① 改 sillyspec CLI 加 `--strategy` flag 显式跳过三写——跨仓接口变更，且自指守卫已存在，修前置条件即可闭合，不扩战线；② isSelfReferentialSpecRoot 在 cwd/.sillyspec 不存在时弱化判定（resolve 字符串比对）——junction 路径字符串本就不等，弱判定不可靠，治标不治本；③ 普通目录残留直接 rm 后建 junction——违背 R-01 防误删原则（残留可能含历史托管数据），rename 备份保数据。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | sillyhub-daemon/src/spec-sync.ts | repo-native 源缺失就地建空真理源；ensureSpecJunction 残留备份交换 |
| 修改 | sillyhub-daemon/tests/test_init_lease.test.ts | 新增两用例：源缺失不降级 / 残留备份交换 junction |
