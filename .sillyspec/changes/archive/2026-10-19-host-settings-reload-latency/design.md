---
author: agent
created_at: 2026-10-19T02:34:00.000Z
---
# 设计记录（Design Record）— 2026-10-19-host-settings-reload-latency

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

单点参数收窄 + 一行文档修正：`host-settings-watcher.ts` 的默认轮询节拍由 3000ms 改为
1000ms，并把该默认值升为**单一源导出常量** `HOST_SETTINGS_POLL_INTERVAL_MS`（供守护测试
断言，避免魔数漂移）；两拍一致去抖、env 块指纹、容错语义**逐字不变**——延迟收益全部来自
节拍收窄（去抖窗口 6s→2s，端到端 4-6s→2-4s）。`pollIntervalMs` 注入覆盖口径不变（测试仍
用 15ms）。另将 deploy 技能文档里 `curl -fsSI /daemon/latest/sillyhub-daemon.js`（实测
HEAD 405，端点仅允许 GET）改为 GET 口径 `-o /dev/null -w '%{http_code} %{content_type}'`，
与端点真实行为一致。

不选「去抖降为单拍」：半写/原子替换容忍是上一变更的显式取舍，单拍会把瞬时态当变化触发
批量重载——语义回退，否决。不选「fs.watch 事件式」：同上一变更死路 2（Windows 替换写掉
watch），否决理由不变。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

daemon 内部，**无对外契约变化**（无 HTTP/WS 契约、无 DB 字段、无前端类型 → 不需要
`pnpm gen:types`）。新增导出：`HOST_SETTINGS_POLL_INTERVAL_MS = 1000`（host-settings-watcher.ts，
默认节拍单一源）；`startHostSettingsWatcher` 的 `pollIntervalMs` 可选参数签名不变。行为变化仅
一条：缺省轮询 3 秒 → 1 秒。文档：`.zcode/skills/sillyhub-docker-deploy/SKILL.md` 验证命令
HEAD → GET（对齐端点实际：`GET /daemon/latest/sillyhub-daemon.js` 200，HEAD 405）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. **乱序/迟到到达**：节拍变化不触碰去抖状态机（基线/候选/两拍确认逻辑逐字不动），乱序
   假设照旧成立。
2. **并发写**：读文件仍为只读轮询；1s 节拍下半写窗口更短（更难被采到），容错分支
   （解析失败跳过）不变。
3. **切换/生命周期**：重载动作链路零改动（仍走 markPendingConfigSwitch）；唯一变化是触发
   更快——运行中会话依旧挂轮边界不打断。watcher start/stop 生命周期不变。
4. **作用域**：仍是「只读宿主 settings.json + 本机默认 + 宿主目录 transcript 会话」，
   筛选逻辑零改动；跨机器/工作区零串台。节拍常量仅 daemon 进程内使用。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- **最大风险**：空转读文件频率 ×3（每秒读 2-6KB + JSON 解析）。量级可忽略（单核微秒级），
  定时器仍 unref；接受。
- **风险 2**：重载风暴更密（用户连续快速换档时，每 2 秒可触发一波）。上一变更已论证
  per-session 串行 + 覆盖写幂等承载得住；去抖两拍本身就是节流。
- **死路（放弃）**：去抖单拍化（见做法概述）；fs.watch（同上变更死路 2）。
- **遗留**：UI 可感知提示（切换时平台界面出 notice）需 daemon→backend→frontend 三端契约
  （新端点 + SSE 帧 + 类型再生成），本变更明确不做，留待单独立项。
