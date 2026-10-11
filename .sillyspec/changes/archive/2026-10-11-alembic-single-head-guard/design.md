---
author: flow-machine-draft
created_at: 2026-10-11T11:38:24.239Z
---
# 设计记录（Design Record）— 2026-10-11-alembic-single-head-guard

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

双闸拦截 alembic 迁移多头形态（2026-10-11 生产实证：并行变更 `20261011020000`/`20261011160000` 同父分叉未合流即部署，backend `alembic upgrade head` 报 Multiple head revisions crash-loop，平台宕机约 2 分钟后回滚 + 手工 merge 修复）：

1. **CI 闸（PR 阶段）**：`backend/tests/test_migration_single_head.py` 用 alembic API（`ScriptDirectory.from_config(...).get_heads()`）断言 heads 恰一个——走 API 不 shell out，CI 与本地零环境差异；`.github/workflows/backend-ci.yml` 的 pytest 套件天然收录（testpaths 含 tests/），不新增 workflow。
2. **部署闸（打镜像阶段）**：`deploy/scripts/build-and-save.sh` 在 docker build 前新增 `[2.5/5]` 预检——`python -m alembic heads` 输出 `(head)` 行数 ≠1 即 exit 1（打印各 head + `alembic merge heads` 解法）；命令本身失败也 exit 1（提示 `uv sync`），fail-closed 不静默跳过——省掉「300M 镜像传上服务器才发现起不来」的往返。

选双闸而非单闸：CI 依赖 PR 流程存在（直推 main / 本地部署绕过 PR 时 CI 不拦截），部署脚本是打镜像的必经路径，两者互补。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新增测试文件一个（无生产代码改动、无 API/DTO 变化、无迁移内容变化——merge 迁移 c515ffd62859 属上一轮事故修复已独立提交）。
- `build-and-save.sh` 行为变化：单头时多一行「单头 OK」输出；多头/alembic 不可用时非零退出（此前会继续构建）。新增前置依赖：本地 backend Python 环境可跑 `python -m alembic`（部署者本就具备；缺失时明确报错而非静默）。
- 无数据库/契约/前端影响，`gen:types` 不涉及。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   答：n/a——守卫是纯读静态迁移图（文件系统快照），无事件/时序输入。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   答：并行变更同时新增迁移 → 迁移图多头 → 正是被拦截的形态：CI 闸在 PR 红灯、部署闸在打包 exit 1，解法统一为 merge heads（报错文案直接给命令）。两闸自身只读，无共享状态。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   答：安全——测试与脚本预检均无副作用（不触 DB、不写文件）；预检失败在任何阶段退出都不留半态。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   答：不会——两闸均锚定本仓 backend/alembic.ini 的迁移目录（ScriptDirectory 解析 script_location=migrations 相对 backend/），与运行数据库无关（单头性是图属性非库状态，离线判定）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：部署者绕过 build-and-save.sh 手工 `docker build`（两闸全绕）——接受：技能文档固定走脚本，纯手工路径属明知故犯；CI 闸仍覆盖 PR 流。

已弃方案：
① 只加 CI 闸——直推 main/本地部署不经 PR 时拦不住（本变更正是本地打包部署场景翻的车），弃单闸改双闸。
② 预检 shell out 跑 pytest 复用测试——部署机未必有 pytest 环境，且脚本内嵌 python -m alembic 依赖更轻，弃。
③ 后端启动时（容器 entrypoint）容错多头——掩盖问题不如 fail-fast，且容器已 crash-loop 即等价红灯，无增益。

无声明边界以外的取舍。
