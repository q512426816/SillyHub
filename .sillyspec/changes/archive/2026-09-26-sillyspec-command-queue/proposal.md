---
author: flow-machine-draft
created_at: 2026-09-26T13:50:07.072Z
---
# 提案书（Proposal）— 2026-09-26-sillyspec-command-queue

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:c27455fadf6b89d8f2e2c3bd9b6e88d5ff97e325bcd41c67e60b20df80087e38:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-sillyspec-command-queue 留痕重锚 -->
任务原话转写：动机：平台同步区冲突裁决与 npm 升级链并发时命令被「another sillyspec command is running」忙拒记 failed（生产实证 2026-09-25 sillyspec 工作区两条裁决双双被拒挂失败红字），用户需手动重试——单管理员低频假设不成立，改为排队串行执行。
成功标准：
- daemon 侧 sillyspec 平台命令（resolve/ghost_cleanup）不再忙拒：并发到达 FIFO 排队，前一条完成（含失败出口）后依序执行
- npm 升级链在跑时到达的命令同样排队等待升级结束后执行，不再记 failed busy
- 每条命令完成落槽后仍立即补发心跳（ql-20260911-024 回显提速语义不变）
- 忙拒固定文案 SILLYSPEC_COMMAND_BUSY_ERROR 与相关忙拒测试断言移除，新增排队执行/等待升级两类用例
- 仅跑 sillyhub-daemon 聚焦测试（sillyspec-platform-command 近邻）+ tsc 0，不跑全量
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:16761205dcd9b01425d494c8d618eaec443ecec56d42e35734168432b167c93a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-sillyspec-command-queue 留痕重锚 -->
按成功标准机械推导，共 7 条验收面：
1. daemon 侧 sillyspec 平台命令（resolve
2. ghost_cleanup）不再忙拒：并发到达 FIFO 排队，前一条完成（含失败出口）后依序执行
3. npm 升级链在跑时到达的命令同样排队等待升级结束后执行，不再记 failed busy
4. 每条命令完成落槽后仍立即补发心跳（ql-20260911-024 回显提速语义不变）
5. 忙拒固定文案 SILLYSPEC_COMMAND_BUSY_ERROR 与相关忙拒测试断言移除，新增排队执行
6. 等待升级两类用例
7. 仅跑 sillyhub-daemon 聚焦测试（sillyspec-platform-command 近邻）+ tsc 0，不跑全量
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:b3f360f37ca6d4ce47cd380c3f005da11d67f22360e63431158e01b9e3ca20c6:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-sillyspec-command-queue 留痕重锚 -->
1. daemon 侧 sillyspec 平台命令（resolve
2. ghost_cleanup）不再忙拒：并发到达 FIFO 排队，前一条完成（含失败出口）后依序执行
3. npm 升级链在跑时到达的命令同样排队等待升级结束后执行，不再记 failed busy
4. 每条命令完成落槽后仍立即补发心跳（ql-20260911-024 回显提速语义不变）
5. 忙拒固定文案 SILLYSPEC_COMMAND_BUSY_ERROR 与相关忙拒测试断言移除，新增排队执行
6. 等待升级两类用例
7. 仅跑 sillyhub-daemon 聚焦测试（sillyspec-platform-command 近邻）+ tsc 0，不跑全量
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
