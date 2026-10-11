---
author: flow-machine-draft
created_at: 2026-10-11T11:50:19.471Z
---
# 决策记录（Decisions）— 2026-10-11-alembic-single-head-guard

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：部署者绕过 build-and-save.sh 手工 `docker build`（两闸全绕）——接受：技能文档固定走脚本，纯手工路径属明知故犯；CI 闸仍覆盖 PR 流。 已弃方案： ① 只加 CI 闸——直推 main/本地部署不经 PR 时拦不住（本变更正是本地打包部署场景翻的车），弃单闸改双闸。 ② 预检 shell out 跑 pytest 复用测试——部署机未必有 pytest 环境，且脚本内嵌 python -m alembic 依赖更轻，弃。 ③ 后端启动时（容器 entrypoint）容错多头——掩盖问题不如 fail-fast，且容器已 crash-loop 即等价红灯，无增益。 无声明边界以外的取舍。
