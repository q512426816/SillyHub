---
plan_level: full
---

# 实现计划（Plan）— 2026-09-12-provider-file-tx

## Spike 前置验证
无需 Spike——`fs.rename` 顶替已存在目标在 Windows 的 MoveFileEx(REPLACE_EXISTING) 语义以单测锁定（task-01）；ForReload 兜底矩阵行为已被 2026-09-11-session-provider-switch-codex-pi 的测试套件锚定，本变更只增副作用不改分支。

## Wave 1（原子写基座，零行为变化）
- task-01

## Wave 2（依赖 W1；两 task 文件集不相交可并行）
- task-02
- task-03

## Wave 3（依赖 W2——标记接口与原子写就位；两 task 文件集不相交可并行）
- task-04
- task-05

## Wave 4（依赖 W1-W3 全链路产物）
- task-06

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | atomic-write.ts——writeFileAtomic（tmp+fsync+rename+失败清 tmp）+ 单测（顶替/失败保留旧全文/tmp 清理/win32 顶替锁定） | W1 | P0 | — | FR-03, D-003@v1 | 纯新增，产物逐字节等价旧写入 |
| task-02 | 六写盘点替换——codex-settings 两处 + mirror 拷贝 + pi-settings 三处换 writeFileAtomic；codex-settings/pi-settings 既有套件回归 | W2 | P0 | task-01 | FR-03, D-003@v1 | 产物内容零变化，测试锁定等价 |
| task-03 | 生效标记——provider-file-settings 落 .sillyhub-managed（分支一后置 best-effort；分支四标记先行、失败跳过镜像返回 prior）+ MANAGED_MARKER_FILENAME 导出 + provider-file-settings-reload 套件扩展（标记先行序/后置序/门槛缺不落标记） | W2 | P0 | task-01 | FR-04 前半, D-004@v2 | rollout 拷贝不纳入（design 划界） |
| task-04 | reload 事务性——引擎门（provider 维度条件化）+ 守卫前移 + catch 回滚（ForReload 重跑 + 空返回删标记）+ config-switch 套件扩展（守卫/回滚/cursor 拒绝/claude 配置切换不连坐） | W3 | P0 | task-01, task-03 | FR-01, FR-02, FR-05, D-001@v1+D-002@v2+D-005@v2 | 回滚用局部布尔标记「已越过写盘点」 |
| task-05 | restore 探测三态化——persistence null+codex 标记/legacy(auth|config)/零动作 + session-recovery 套件扩展（RESTORE-4 语义更新 + 标记在 managed/空目录零动作两新态） | W3 | P0 | task-03 | FR-04 后半, D-004@v2 | restore 镜像路径同标记先行序；迁移钩子目录恒落第三态断言 |
| task-06 | 回归收口——provider-injection-smoke + daemon-provider-file-dispatch + pi/codex-settings 全套件 + daemon typecheck + 模块文档变更索引（sillyhub-daemon.md + codex-settings.md/pi-settings.md 模块卡） | W4 | P0 | task-01~05 | 全 FR | 不跑全量（规则 0）；risk_level=integration-critical 的真实集成证据归 verify 阶段 |

## 关键路径
task-01 → task-03 → task-04 → task-06（主链）；task-02 / task-05 并行支线汇入 task-06。

## 全局验收标准
1. 新增/修改相关 daemon 测试全绿（atomic-write / codex-settings / pi-settings / provider-file-dispatch / session-manager-config-switch / session-store-persistence / provider-injection-smoke）；不跑全量（CLAUDE.md 规则 0）
2. daemon `pnpm typecheck` 全绿
3. 产物等价锁定：task-02 后 codex/pi 写盘产物与替换前逐字节一致（既有 golden 断言不改预期全绿）
4. FR 验收断言齐：守卫前移零写入 / 回滚后目录回旧形态 / 原子失败保旧全文 / 探测三态 / cursor provider 切换拒绝且配置切换不连坐
5. claude 引擎零漂移：既有 claude reload/restore 相关测试不改预期全绿
6. 集成敏感（design 判级 integration-critical）：verify 阶段补真实集成证据（真启动 daemon 的 reload/restore 冒烟或等价实机锚定）

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| FR-01 | task-04 | config-switch 套件：缺 key reload 在写盘前抛 + 目录零写入断言 |
| FR-02 | task-04 | catch 回滚重写断言（mock ForReload 二次调用参数=旧形态）+ 空返回删标记 |
| FR-03 | task-01, task-02 | atomic-write 单测 + 既有 golden 回归 |
| FR-04 | task-03, task-05 | 标记先行序单测 + 探测三态单测 |
| FR-05 | task-04 | cursor provider 切换 throw + 配置切换不受门断言 |
| D-001@v1/D-002@v2/D-003@v1/D-004@v2/D-005@v2 | task-01~05 | 决策覆盖矩阵见 requirements.md |
