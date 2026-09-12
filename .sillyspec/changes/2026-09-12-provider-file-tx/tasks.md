---
author: qinyi
created_at: 2026-09-12 11:05:00
generated_by: sillyspec-brainstorm
---
# 任务清单（Tasks）— 2026-09-12-provider-file-tx

> brainstorm 级任务骨架（FR 粒度）；Wave 编排与依赖细化由 plan 阶段展开。

- [ ] task-01: atomic-write.ts（writeFileAtomic：tmp+fsync+rename+失败清理）+ 单测（顶替/失败保留旧全文/tmp 清理/win32 顶替锁定）【FR-03 / D-003@v1】
- [ ] task-02: codex-settings + pi-settings 六写盘点替换为 writeFileAtomic（产物逐字节等价）+ 既有套件回归【FR-03 / D-003@v1】
- [ ] task-03: provider-file-settings 落 `.sillyhub-managed` 标记（分支一后置 best-effort；分支四标记先行、失败跳过镜像）+ 单测【FR-04 / D-004@v2】
- [ ] task-04: session-manager reload 事务性——引擎门（provider 维度条件化）+ 守卫前移 + catch 回滚（ForReload 重跑 + 空返回删标记）+ config-switch 套件扩展【FR-01/FR-02/FR-05 / D-001@v1+D-002@v2+D-005@v2】
- [ ] task-05: persistence restore null+codex 探测三态化（标记/legacy/零动作）+ 单测【FR-04 / D-004@v2】
- [ ] task-06: 回归——provider-injection-smoke + daemon-provider-file-dispatch + 模块文档变更索引更新
