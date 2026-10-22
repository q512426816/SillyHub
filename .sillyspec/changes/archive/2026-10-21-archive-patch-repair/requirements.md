---
author: flow-machine-draft
created_at: 2026-10-21T04:01:29.175Z
---
# 需求规格（Requirements）— 2026-10-21-archive-patch-repair

## 功能需求

### FR-01: change.patch 内容等于 git diff c71b875a1..e88ffddb7 两源码文件

- 归档目录 `change.patch` 必须重写为 `git diff c71b875a1..e88ffddb7 -- frontend/src/components/change-file-tree.tsx frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx` 的原样输出（逐字节），不再含任何他侧文档 hunk。

#### 场景：主路径

- Given 归档目录内 change.patch 为错位内容（task-wakeup-restore 的两份 sillyhub-daemon 文档 hunk）
- When 以指定 git diff 命令输出重写该文件
- Then 文件内容与 git diff 输出逐字节一致，`diff --git` 块仅覆盖两源码文件

### FR-02: change-patch.json files/totals/scopeAudit.rows 与 git 实况一致，verdict 不确定处注记兜底

- `change-patch.json` 的 `files`/`totals`/`scopeAudit.totals`/`scopeAudit.rows` 必须修准为与重写后 patch 实况一致：files 恰为两源码路径、行数取 git numstat 实数、源码行 `verdict` 取 `planned`（后端权威三态 `planned/unplanned/untouched`，schema.py:745，经查证无需注记兜底枚举）；他侧两行 `.sillyspec/docs/` 条目必须从冻结面剔除，改记入 repair 注记字段。

#### 场景：主路径

- Given 修准后的 change-patch.json 与重写后的 change.patch
- When 逐项对账 JSON 数值面与 git numstat
- Then files/totals/rows 三处与 numstat 逐项一致，JSON 内不存在他侧 doc 路径

### FR-03: patchSha256 与新 patch 字节哈希一致且原错误锚值保留于 repair 注记字段

- `patchSha256` 必须等于重写后 `change.patch` 的文件字节 sha256；原错误锚值 `7f14be0a70284b77edabc2f06e671666c6043659093b185f93b330a274655395` 禁止从 JSON 消失——必须完整保留于新增 repair 注记字段（含修复时间、依据、方法、修复变更名），修复可追溯而非静默改写。

#### 场景：主路径

- Given 重写后的 change.patch 与更新后的 change-patch.json
- When 对 patch 文件字节重算 sha256 并检索 JSON
- Then 重算值与 `patchSha256` 逐字一致，且原错误锚值完整存在于 repair 注记字段

### FR-04: patch-file 切片实跑返回两源码文件 diff，平台投影重新同步

- 后端切片纯函数 `slice_patch_for_file`（backend/app/modules/change/assets.py:399）对修准后 patch 实跑：两源码路径必须命中且返回对应 diff 块，原错位两 doc 路径必须未命中（返回 None）；修复入库后必须重跑 `sillyspec platform sync --change 2026-10-21-files-refresh-spinner` 刷新平台镜像（平台侧 patch 元数据与正文均为请求时读盘，盘准即卡面准）。

#### 场景：主路径

- Given 修准后的归档件与成功执行的 platform sync
- When 以两源码路径与两 doc 路径分别调用切片函数
- Then 源码路径返回含对应 hunk 的 diff 块、doc 路径返回 None；sync 回执成功

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：纯归档工件修复（.sillyspec 面），CLI 收口实测对非 src/test 自动跳过；逐字节一致性由执行期 `git diff` 输出直写 + 重读比对实核，验收靠规范与人工
FR-02: 不适用：同上——数值面为一次性机械对账（numstat 对 JSON 三处逐项核），非可回归测试面；核验记录留在验证输出与提交消息
FR-03: 不适用：同上——sha256 一致性为一次性机械实核（python hashlib 重算比对），非可回归测试面
FR-04: 不适用：切片函数为既有 backend src（本变更零 src 改动），以临时脚本直调实跑验证（命中/未命中双路径断言），不新增仓内测试文件；平台投影经 platform sync 回执核验
