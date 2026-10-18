# 归档半态保底缺口——location（文件树通道）与 status（DB 通道）可长期不一致，重试链挂在"下一条命令"这个可能永不到来的事件上

> 记录时间：2026-10-17 · 来源变更：2026-10-17-zcode-provider-config-shape（flow done 归档后实证）
> 状态：活跃坑（手动 `sillyspec platform sync --change <名>` 可解，保底缺口待工具修复）

## 现象

flow done 收口 + 归档提交完成后，平台变更中心「进行中」列表仍挂着该变更。平台 DB 记录呈
半态：`status=archived / current_stage=archived`（DB 通道已收敛）但 `location=active`
（文件树通道未收敛）——"进行中"列表按 location 过滤，于是已归档变更持续显示进行中。

spec-sync-bg.log 关键时序（04:49–04:50Z）：

```
04:49 第 N 轮：sync 变更行成功 → [spec-sync] 同步异常（文件树本次未同步…平台响应慢，本轮同步被总预算熔断让路）
04:50 下一轮：变更已归档（目录在 archive/），继续从 DB 推送最终状态 → DB 墓碑成功
            → [spec-sync] 同步异常（文件树本次未同步…单请求超时）
04:50:52 后台同步完成（锁释放）——此后 ~54 分钟无任何重试，直到手动 platform sync
```

## 根因（三层）

1. **双通道可半成功**：triggerSync 的 DB 状态推送与 specSpecTree 文件树推送是独立请求
   序列；平台 `location` 字段来自文件树扫描定位，`status` 来自 DB 推送。慢平台窗口内
   两通道一成一败 → 半态在结构上必然可出现（本轮实证：预算 AbortError + 单请求
   TimeoutError 连续两轮击中文件树通道）。
2. **重试是事件驱动、非时间驱动**：「best-effort，下一条命令自动重试」的"下一条命令"
   是唯一重试源。归档是变更生命周期**最后一个动作**——之后大概率没有下一条 sillyspec
   写命令（本例 agent 收尾走人后 54 分钟无人触发）。只读命令（progress show 等）不触发
   同步，也不计入。
3. **既有保底挂在同一死事件源上**：collectTerminalSyncPending（bg-sync.js 终态补推，
   注释自认「此后再无命令碰该变更即永久滞后」）只在 bg 子进程被 spawn 时运行——而
   spawn 本身也要等下一条命令。保底与主链共享同一个消失的事件源；fail-streak ≥3 的
   🚨 升级也只写 spec-sync-bg.log（本例 streak=2 未到阈值，且日志文件默认无人读）。

## 影响

- 已归档变更在平台「进行中」列表幽灵滞留（本例 54 分钟，无人再碰则无限期）；
- 用户感知为"平台状态错乱/归档没生效"，实际本地早已完成——信任损耗；
- 反向危害面（理论上）：半态窗口内用户按"进行中"列表对该变更做平台侧操作（重开/审批），
  操作对象与本地真相不符。

## 修复方向建议（待工具侧拍板）

- **近改（最小面）**：`status∈(archived,deleted)` 但 `location=active` 的半态在
  progress show / 变更命令头红标提示「归档未完全同步，跑 sillyspec platform sync
  --change <名> 收敛」——先让用户可见、可自救；
- **中改**：归档收尾（archive 子步）对文件树推送做**同步强校验**（终态动作允许阻塞数秒
  换一致性；文件树失败则显式告警 + 退出码提示，不留静默半态）；
- **远改**：引入时间驱动兜底——bg 子进程退出前若文件树通道仍有未收敛 dirty 面，留一个
  延迟自唤醒（Windows 计划任务 / 独立 watchdog 进程），或 daemon 侧 sillyspec watcher
  对 `.sillyspec/changes` 目录 rename 事件做补偿轮。

## 绕过（已验证有效）

```
sillyspec platform sync --change <已归档变更名>
```

文件树通道整树重推（本轮 24 文件变更上行成功），平台 location 随即翻转为 archive。

## 处置记录（2026-10-18 定时收口：核心缺口已修，关闭归档）

- **「中改」方向已落地**（sillyspec 仓 2026-10-17-archive-terminal-sync-strict，5147c63f）：
  新增 `triggerSyncTerminalStrict`（src/run/shared.js:1067）——终态判定驱动（DB status
  ∈ archived/deleted 才强校验，非终态原样委托既有 best-effort triggerSync 零行为变化）、
  内联有界（绕过后台化直跑，预算 ≥45s，结果当场可判）、失败显性化（syncSpecTree
  `treeOk!==true` 判未收敛 → 🚨 告警 + 自救命令 `sillyspec platform sync --change <名>`
  + exit 1，对齐 _submitApproval「终态网络失败必须可见」先例）。接线三终态点：
  flow done（src/run/complete.js:834 completion 面 + src/flow.js:2535）与
  change-delete（src/change-delete.js:163）。归档/删除终态动作从此「要么收敛、要么响亮失败」，
  重试不再挂「下一条命令」死事件源。
- **后续缺陷修复 + 实战验证**（2026-10-17-strict-sync-signal-shape，560af6a2）：raceWithAbort
  默认路径 signal 形状套娃致树通道恒假败——上一变更归档 dogfood 当场被强校验 🚨 抓获，
  按自救命令收敛半态，安全网本身工作正常得到生产实证。
- **测试证据**：test/terminal-sync-strict.test.mjs 本轮复跑 10/10 绿（终态判定/内联有界/
  失败显性化/quick 委托/未连接跳过/冲突不重复告警等面全覆盖）。
- **遗留项（不影响关闭）**：①修复上线前产生的存量半态仍需一次手动 `platform sync
  --change <名>`（「近改」的 progress show 红标未单独实现——新半态已被终态强校验在
  源头拦截，存量面一次性手工收敛即可，再遇可补）；②「远改」时间驱动 watchdog 未做——
  终态内联阻塞校验后新静默半态不再产生，watchdog 降级为可选增强。
- 处置结论：坑核心（静默半态 + 重试挂在可能永不到来的事件源）已在源头解决，本文件移入 finished/。
