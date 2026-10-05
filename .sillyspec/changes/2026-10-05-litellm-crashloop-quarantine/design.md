---
author: flow-machine-draft
created_at: 2026-10-05T00:15:58.561Z
---
# 设计记录（Design Record）— 2026-10-05-litellm-crashloop-quarantine

> 四节每节必答——答案直接写在问题下方；小改动可写「不适用：<理由>」；flow done 空节拒收。
> 需要列改动文件时在「接口契约」节加「文件变更清单」表（| 新增/修改 | 路径 | 说明 |）。

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

给 `litellm` 与 `litellm-db` 两服务各加一行 `profiles: ["litellm"]`：v1.95.x 两个镜像变体
均为 ghcr 坏构建、且 2026-10-05 本地矩阵证实无可 pin 的健康 tag（坑文档在案），而
`restart: always` + 部署 skill 标准收尾 `up -d` 的组合会让坏镜像在下次常规部署必然重新
进入无限重启。profiles 是 Compose 原生的「可选服务」机制，把两服务移出默认启用集合，
同时保留全部配置与卷。

选 profiles 而非其它方案的依据：注释掉整块服务——丢失配置可见性、恢复 diff 大；`restart: no`
——`up -d` 仍会拉起坏镜像跑一次崩溃（且 1.6G 机上白拉 200MB+ 坏镜像层），恢复时还易忘改回
always；纯注释提醒——已被证实无拦截力（本次修复的直接动因）。profiles 兼容坑文档既有恢复
命令 `up -d litellm litellm-db`（Compose 显式点名服务自动激活其 profile，v2 语义），零数据
丢失（卷定义不动，`up`/`stop` 均不回收卷）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

对外行为变化仅一处：默认（无 `--profile`）`docker compose up -d` 的启用服务集合减少
litellm、litellm-db 两项；`--profile litellm` 或显式点名两服务时行为与改动前完全一致。
无代码接口、端点、数据格式变化。

文件变更清单：

| 新增/修改 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | deploy/docker-compose.yml | litellm / litellm-db 各加 `profiles: ["litellm"]` + 临时隔离注释（注释与坑文档互指） |
| 修改 | docs/sillyspec/litellm-v1950-image-entrypoint-not-found.md | 新增 2026-10-05 处置段：隔离手段、恢复口径、专门变更移除条件 |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：不适用——静态声明性配置（YAML），无事件流与时序假设。
2. 并发写：不适用——单一 YAML 文件，git 文本冲突按常规处理；运行期无共享状态写入。
3. 切换/生命周期：服务器上已 `docker compose stop` 的 litellm 容器不受影响——profiles 只改
   `up` 的启用集合，不触碰已存在容器与卷；`up -d`（默认）不会 recreate/删除 profiled 服务，
   卷仅 `down -v` 才回收（本变更不涉及）。部署中途断电/中断：配置为声明式，重跑 `up -d`
   幂等收敛，无中间态。
4. 作用域：profile 名 `litellm` 仅在本 compose project 内生效；阿里云服务器与本机两套部署
   使用同一文件同一语义，无跨实例串台；backend 明确不 depends_on litellm（compose 注释
   NFR-03 故障域隔离），核心栈渲染不受影响。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险=恢复路径被遗忘：2026-10-05 本地矩阵已证伪「选新 tag」路线（无可 pin 的
「健康镜像 + gap-A」组合），分叉（①等上游修复版 / ②自研薄适配层退役 litellm）拍板后
的专门变更若漏处理两处 profiles 行——分叉①下 litellm 不随默认栈拉起，表象是 OpenAI 型
供应商经 litellm 的链路静默缺失（该链路当前尚未启用，短期无感，正因此更易被遗忘）。
缓解：compose 两处注释与坑文档 2026-10-05 隔离加固段三处互指「恢复/退役=专门变更处理
profiles 行」，且坑文档保持 docs/sillyspec/ 活跃区跟踪至分叉拍板与移除闭环。

试过但放弃的方案：① 注释掉整个服务块——配置失去可见性、恢复 diff 噪音大；② `restart: no`
——`up -d` 仍会拉起坏镜像执行一次 127 崩溃（低配机白拉镜像层），且违背 NFR-03 的 always
语义、恢复时易忘改回；③ 依赖「服务器已手动 stop + 注释提醒」——已被 2026-10-04 实践证伪：
stop 状态挡不住下一次 `up -d`（这正是本变更的动因）。
