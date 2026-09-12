---
author: qinyi
created_at: 2026-09-12 11:05:00
generated_by: sillyspec-plan
---
# 任务清单（Tasks）— 2026-09-12-provider-file-tx

- [ ] task-01: atomic-write.ts——writeFileAtomic（tmp+fsync+rename+失败清 tmp）+ 单测（顶替/失败保留旧全文/tmp 清理/win32 顶替锁定） (depends_on: —)
- [ ] task-02: 六写盘点替换为 writeFileAtomic（codex-settings 两处+mirror 拷贝+pi-settings 三处）+ 既有套件回归 (depends_on: task-01)
- [ ] task-03: provider-file-settings 落 .sillyhub-managed 生效标记（分支一后置 best-effort / 分支四标记先行失败跳过镜像）+ provider-file-settings-reload 套件扩展 (depends_on: task-01)
- [ ] task-04: session-manager reload 事务性——引擎门（provider 维度）+ 守卫前移 + catch 文件层回滚（ForReload 重跑+空返回删标记）+ config-switch 套件扩展 (depends_on: task-01, task-03)
- [ ] task-05: persistence restore null+codex 探测三态化（标记/legacy/零动作，镜像路径同标记先行）+ session-recovery 套件扩展 (depends_on: task-03)
- [ ] task-06: 回归收口——smoke/dispatch/两 settings 套件 + daemon typecheck + 模块文档变更索引 (depends_on: task-01, task-02, task-03, task-04, task-05)
