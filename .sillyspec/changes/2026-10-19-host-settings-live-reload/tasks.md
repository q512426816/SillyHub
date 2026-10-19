---
author: agent
created_at: 2026-10-19T01:38:39.773Z
---
# 任务注册表（Tasks）— 2026-10-19-host-settings-live-reload

- [x] task-01: daemon 新增宿主机 settings.json env 块变化监听（轮询+指纹+去抖确认，跨平台 Win/Linux/macOS）：确认变化后对本机默认会话自动重载引擎（空闲立即、运行中不打断当前轮、轮边界生效），重载走既有 _reloadSession 内核（失败回滚 R-01、per-session 串行化、/model 钉随旧进程消亡）（新增 src/interactive/host-settings-watcher.ts + SessionManager.reloadHostDefaultSessions + start/stop 接线）
- [x] task-02: 触发精度：仅 env 块变化触发（permissions/hooks 等非 env 字段变化、文件缺失、JSON 损坏均不触发不抛异常）；启动时建基线不触发；平台供应商会话与隔离目录会话零触碰；提供 SILLYHUB_HOST_SETTINGS_WATCH=0 关闭阀（watcher 单测 8 例 + HOST-2/3/6）
- [x] task-03: 守护测试：watcher（基线/触发/非 env 不触发/损坏容错/stop）+ 会话筛选矩阵（本机默认重载/平台供应商不重载/隔离目录不重载/运行中延迟到轮边界后重载）+ manager 集成（真实 start() 后改 tmp settings 文件触发重载、resume key 不变、无 prompt 喂入）——vitest run tests/interactive 78 文件 1234 例绿（+1 skipped）+ tsc 零错；真机验证随部署留痕
