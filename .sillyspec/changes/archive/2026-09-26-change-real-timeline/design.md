---
author: flow-machine-draft
created_at: 2026-09-26T07:51:57.085Z
---
# 设计记录（Design Record）— 2026-09-26-change-real-timeline

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-change-real-timeline 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
复刻 CLI `sillyspec watcher timeline` 的合成展示到平台，三件：①后端 change 模块 NEW timeline.py：ChangeTimelineQueryService 聚合三源——platform_change_events 表（platform_sync ORM，按 workspace_id+change_name=change_key 正序）、镜像 tasks.md（复用 ChangeAssetsQueryService._resolve_change_dir 先例解析在途/归档目录，正则 `- [x]/- [ ] task-NN:` 行）、requirements.md frontmatter created_at（诞生锚）；commit 事件短哈希经 GitLogService.list_commits（daemon RPC，limit 50）sha 前缀匹配标题，异常降级 title=None；统计纯计算。②GET /changes/{cid}/timeline 端点 + schema DTO（TimelineEvent/TimelineTask/TimelineStats/ChangeTimelineRead）。③前端 NEW change-timeline-card.tsx（观测事件卡同款范式：useQuery 自取数 30s 轮询失败静默）+ page.tsx 在 steps 为空时挂载（steps 有数据零改动）。kind→中文标签映射对齐 CLI 输出语义。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-change-real-timeline 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
新增 GET /workspaces/{ws}/changes/{cid}/timeline（鉴权 WORKSPACE_READ 对齐 assets 端点）→ ChangeTimelineRead{change_key, born_at, events: [{ts, kind, label, detail, rule, severity, provisional}], tasks: [{id, checked, desc, commit_sha, commit_title}], stats: {wall_clock_s, event_count, commit_count, checked, total}}。既有端点零变化；events 表只读（红线 D-004 延续：展示不消费）。gen:types 同步 openapi.json + api-types.ts。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-change-real-timeline 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：事件 ts 字符串 ISO 字典序=时间序（表注释 R-04 先例），正序查询天然稳定；watcher 重推经 dedup_key 幂等，聚合只读快照无时序假设；在途变更轮询拉新事件自然增长。
2. 并发写：三源全只读（events 表 SELECT、镜像文件读、git RPC 读）；tasks.md 在途时 agent 会改，聚合每次整读快照，读到半态按当次行解析（正则逐行、坏行跳过），下轮轮询自愈。
3. 切换/生命周期：git RPC 失败/超时降级 title=None 不阻塞聚合（best-effort，观测事件卡先例）；变更删除后 404；前端组件失败静默隐藏不阻断详情页。
4. 作用域：events 查询带 workspace_id + change_name 双键；change 归属校验（ChangeNotFound 跨工作区 404）在聚合前；git RPC 绑定同 workspace 的 daemon；无跨工作区串面。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-change-real-timeline 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：事件流覆盖不全（watcher 后拉起/单飞锁盲窗，CLI 脚注同款披露）——展示面注明「观测起点≠诞生时刻」，墙钟统计以首末事件为界，不冒充完整历史。次风险：tasks.md 机器稿行含长描述截断规则与未来格式漂移——正则宽容匹配（task-\d+ 后冒号任意文本），坏行跳过不炸。试过但放弃：①把 CLI 命令嵌 daemon RPC 直接取渲染文本——耦合 CLI 输出格式且失去结构化（前端无法做任务面表格），且 daemon 旧版无此命令会 502；②events 表加 timeline 专用投影列——违反红线 D-004（零业务加工），聚合现算即可（变更事件量级 <100/单变更）。commit 标题匹配用 9 字符短哈希前缀——碰撞概率在 limit 50 窗口内可忽略，命中多条取最新。
