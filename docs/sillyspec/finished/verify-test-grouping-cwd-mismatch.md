# verify 实测模块分组 cwd 错配（daemon 文件进 frontend vitest 组）假红 + skipped 聚合档判定口径不一致

> 记录时间：2026-10-15 · 来源变更：2026-10-15-server-logs-panel（verify 实测门三轮实证）
> 状态：活跃坑（重跑赌正确分组绕过，待工具修复）

## 现象

verify `--done` 实测门（模块子集 runner）对同一代码面多次运行结果不稳定：

- **形态 A（假红）**：分组 `deps(auto-jsx):2/2`——第二个 jsx 组的 filter 全是 `sillyhub-daemon/tests/*.test.ts`（仓根相对路径），却在 `frontend/` 目录下跑 vitest → `No test files found, exiting with code 1` → 整组判 failed → verify 拦「CLI 实测测试失败」（run 20261015100145）。
- **形态 B（正确）**：分组拆开 `deps(auto-jsx:frontend)` + `deps(auto-jsx:sillyhub-daemon)` 各自 cwd 正确 → 3 组 passed（backend 360s + frontend 65s + daemon 22s 全绿）+ 2 组 skipped（auto-nontest-skip / auto-jsx-e2e-skip——选择器主动跳过非测试件与 e2e 件）→ 顶层 `status=skipped, exit_code=1`，reason 自述「已跑模块全绿」（run 20261015102358）。

形态 B 通过了 Step 3 收口（aggregateStatus 的 skipped 不硬拦，verify-postcheck.js 注释明说），但**代码/文档指纹一变即触发重测**，重测随机落 A/B——A 形态把变更卡死在 verify 门口。

## 根因

1. 分组器把 jsx 类测试文件按项目分桶时，daemon 文件偶发归入 frontend 桶（分组边界不稳定，同指纹多次运行不同结果——疑似排序/集合遍历顺序敏感）；
2. 分桶后 runner 用桶的 cwd（frontend）+ 仓根相对 filter 路径调用 vitest，路径口径错配直接 No test files found；
3. skipped 聚合档顶层 exit_code=1（有 skip 单元时聚合退出码非零），下游若按 exit_code 判 failed 则与 aggregateStatus 的 skipped 语义冲突（部分路径仍按 exit 判）。

## 影响

- 已跑模块全绿的变更在 verify 门口被随机假红卡死，且报错文案「CLI 实测测试失败」误导排查方向（实际无任何测试挂掉）；
- 每轮假红浪费一轮 7-8 分钟实测（backend 360s + frontend 65s）。

## 绕过

重跑 `verify --done` 直至落中形态 B（分组正确）；确认方式：tail 实测日志看分组名是否为 `deps(auto-jsx:frontend)` 与 `deps(auto-jsx:sillyhub-daemon)` 分立。

## 修复建议

1. 分桶以测试文件所属项目根（frontend/ sillyhub-daemon/）为分组键且确定性排序（消除随机性）；
2. runner 调用前校验 filter 路径前缀与 cwd 所属项目一致（错配即报分组错误而非跑出假红）；
3. 顶层聚合退出码：有 skipped 无 failed 时 exit 0（与 aggregateStatus 语义对齐），skip 信息走 reason 字段。

## 处置记录（2026-10-16）

**已修**（sillyspec `2026-10-15-jsx-batch-cmd-chunk` 批次连带，本日功能复验）：
jsx 批**逐文件按自身包根** `inferJsxRunner` 分组（frontend 与 sillyhub-daemon 分立
`deps(auto-jsx)` 各自 cd 前缀），全局推断（首文件）降级为无 hits 兜底——「daemon 文件
进 frontend vitest 组」的错配源消除。分组确定性：Map 插入序 = 文件排序序（无随机性），
坑内「同指纹多次运行不同结果」形态不再可达。建议③（skipped 聚合 exit 0）已在前序
TAP 摘要覆盖轮处理。归档。
