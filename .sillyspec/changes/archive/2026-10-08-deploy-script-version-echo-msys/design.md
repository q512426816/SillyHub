---
author: flow-machine-draft
created_at: 2026-10-08T03:29:51.019Z
---
# 设计记录（Design Record）— 2026-10-08-deploy-script-version-echo-msys

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

build-and-save.sh 的版本回显用 `docker run --entrypoint grep … /app/sillyspec-package.json` 直传路径参数，Git Bash/MSYS 把裸 /app/... 改写成 C:/Program Files/Git/app/... 导致查询失败。改为 `--entrypoint sh … -c '…'` 把路径包进引号字符串内（MSYS 只改写以 / 开头的参数本身），grep 模式放宽 `"version"[: ]*"` 兼容两种 JSON 排版。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无接口变化；仅打包脚本一行回显命令的传参形态（行为：Git Bash 下从「查询失败」变为正确输出版本号；Linux/macOS 不受影响）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立——脚本单线程顺序执行，回显是最后一步（失败已被 || 兜底不中断）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   共享仓并行会话存在，提交用显式 pathspec（仅 deploy/scripts/build-and-save.sh）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   回显失败有 || echo 兜底，不影响 tar 产物与退出码（已实证：上一次打包查询失败但 exit 0、tar 完好并成功部署）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   只改本地打包脚本一行，无跨仓影响。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

风险极低（一行 shell）；放弃方案：MSYS_NO_PATHCONV=1 前缀——放弃理由：需按平台条件设置，比 sh -c 包裹更绕且仅 Git Bash 语义。
