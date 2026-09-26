---
author: flow-machine-draft
created_at: 2026-09-25T23:44:30.315Z
---
# 设计记录（Design Record）— 2026-09-26-deploy-eng-hardening

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-deploy-eng-hardening 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
五件独立小修同批（互不依赖、同一「工程面加固」主题）：①compose 删两处运行时
COMMIT_SHA 空覆盖（镜像 ENV 得以存活——此前空串让 pydantic 视为 falsy 回退 git 探测，容器无
.git 恒 unknown）；②build-and-save.sh 尾部提示改双层活跃目录（与技能文档一致）+ 回显 COMMIT_SHA；
③load-and-up.sh 增 backup 保留策略（每镜像留最近 4 个 backup-*，旧 rmi——40G 盘每个 ≈908MB）；
④gen-api-types.mjs 前置守卫（openapi.json/api-types.ts 未提交改动时中止，--force 跳过）；
⑤新增 scripts/git-safe.sh（index.lock 竞态等待重试，默认 30s）。全部本地可验不部署。


## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-deploy-eng-hardening 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
改动：deploy/docker-compose.yml（删 2 处环境变量行）、deploy/scripts/build-and-save.sh（提示区）、
deploy/scripts/load-and-up.sh（步骤 3/5 重写 + 计数改 5 步）、frontend/scripts/gen-api-types.mjs
（assertNoDirtyGenerated 守卫）、scripts/git-safe.sh（NEW）。对外可见：/api/health commit_sha
在下次部署后回显真实构建提交；backup tag 自动只留 4 个；gen:types 在脏生成物上中止（--force 跳过）。


## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-deploy-eng-hardening 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序：守卫是快照式检查（生成前一刻），竞态窗口内对方新改动仍可能被卷——但 git diff 检查
+生成是秒级窗口，实际风险从「必然卷入」降到「极窄窗口」，可接受。2. 并发写：git-safe 只串行化
自己的重试；backup rmi 的 while read 管道逐 tag 执行，rmi 失败 || true 容错。3. 切换：脚本无
状态；load-and-up 中断在 rmi 前后均无半态（prune/rmi 幂等）。4. 作用域：gen 守卫只看本仓两个
生成物路径；git-safe 是通用 git 包装不涉跨仓。


## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-deploy-eng-hardening 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：compose 删 COMMIT_SHA 环境行后，若有人在服务器 shell export 空 COMMIT_SHA 再
up --build，构建 arg 会拿到空串回退 unknown——但 build-and-save.sh 已在 export 前用 git rev-parse
兜底（第 33 行 ${COMMIT_SHA:-$(git rev-parse --short HEAD)}），本地构建链路恒有值。次生：backup
保留窗 4 个是拍脑袋值——按「每天数次部署×一周回溯」够用，磁盘紧可再调。放弃方案：①镜像里塞
.git 目录供运行时探测——镜像膨胀且 build context 不含 .git；②gen 守卫用文件锁——并行会话
锁文件本身又会成为新的竞态面。

## 文件变更清单

- deploy/docker-compose.yml
- deploy/scripts/build-and-save.sh
- deploy/scripts/load-and-up.sh
- frontend/scripts/gen-api-types.mjs
- scripts/git-safe.sh
