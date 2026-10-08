---
author: flow-machine-draft
created_at: 2026-10-08T01:32:28.964Z
---
# 设计记录（Design Record）— 2026-10-08-backend-dockerfile-apt-mirror-sjtu

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

backend Dockerfile runtime 层的 apt 源 sed 从 tuna 换为上海交大源。故障事实（2026-10-08 上午实测）：tuna 对 `debian/dists/trixie/main/binary-amd64/Packages.xz`（9.6MB）持续 500/502/EOF（InRelease 等小文件正常），连续两次 `build-and-save.sh` 死于该层（各重试 3 次共 12 分钟）；本机到各国内源 http 形态普遍 ≈80KB/s，唯独 `https://mirror.sjtu.edu.cn` https 形态 8MB/5s 复测稳定（http 形态同样慢，故 sed 必须连协议一起换 https）。沿用 2026-07-13/2026-07-17 两次换源先例的最小改动模式：只改 sed 目标与注释，`apt-get install` 行逐字不动。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `backend/Dockerfile` runtime 3/17 的 RUN：sed 目标由 `deb.debian.org → mirrors.tuna.tsinghua.edu.cn（http）` 改为 `http(s)://deb.debian.org → https://mirror.sjtu.edu.cn`（两条 -e 分列覆盖 http/https 两种源形态）。
- 安装包集合（curl ca-certificates git libstdc++6）、安装参数、其余 16 层：零改动。
- 运行时行为/对外 API/部署物：无变化（仅 build 阶段取源路径不同）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   不适用——sed 在单次镜像构建内一次性改写静态配置文件，无事件序参与。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   不适用新增面——Dockerfile 是构建输入，并发构建各自读取同一内容（read-only），无共享可变状态。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全——改动只影响 build 阶段；已构建镜像、运行中容器、服务器部署面均不感知。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会——sed 的 find 限定在镜像内 /etc/apt（sources.list 与 *.sources 两种格式覆盖），不触宿主机与仓库其它文件。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：sjtu 源将来同样故障/限速（镜像站轮流抽风的先例：aliyun 2026-07-17、tuna 2026-10-08）——已在 Dockerfile 注释里留下完整的换源史与实测数据，下次故障按同模式 5 分钟内可再换。放弃的方案：① 原样重试（已试，两次死同层，tuna 服务端故障非瞬时抖动）；② 换 aliyun/ustc/huawei/http 官方源/deb.debian.org（实测同慢 ≈80KB/s，9.6MB 索引在 apt 超时内下不完）；③ 走本机 Clash 代理（7897 实测 2MB/33s 无改善）；④ 增大 apt 重试次数（传输中断形态重试无效，且要改同一行不如换源）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | backend/Dockerfile | runtime 层 apt 源 sed：tuna(http) → mirror.sjtu.edu.cn(https)，注释补 2026-10-08 换源记录与实测数据；install 行逐字不动 |
