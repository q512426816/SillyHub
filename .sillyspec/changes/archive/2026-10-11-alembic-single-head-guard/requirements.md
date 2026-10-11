---
author: flow-machine-draft
created_at: 2026-10-11T11:38:24.239Z
---
# 需求规格（Requirements）— 2026-10-11-alembic-single-head-guard

## 功能需求

### FR-01: backend 新增迁移单头断言测试（alembic heads 输出恰一行，多头即 fail），随测试套件进 CI

- 必须：`backend/tests/test_migration_single_head.py` 用 alembic API（ScriptDirectory.get_heads，不 shell out）断言迁移图 heads 恰一个；多头时断言失败且报错信息包含 `alembic merge heads` 解法提示与生产实证出处。

#### 场景：主路径（当前单头通过）

Given 迁移图单头（当前 c515ffd62859）
When 运行该测试
Then 通过。

#### 场景：多头红灯（2026-10-11 事故形态复现）

Given 并行变更各自新增迁移形成两 head（同日实证 20261011020000/20261011160000 形态）
When CI 运行该测试
Then fail，报错含 merge heads 解法提示——PR 阶段拦截，不再等部署宕机才发现。

### FR-02: deploy/scripts/build-and-save.sh 打镜像前预检 alembic 单头，多头直接非零退出并提示 merge heads 解法

- 必须：脚本在 docker build 前执行 `python -m alembic heads` 预检——多头（(head) 行数 ≠1）立即 exit 1 并打印各 head 与 merge 解法；alembic 命令本身失败也 exit 1 并提示修本地环境。
- 禁止：预检失败后继续打镜像（省 300M 镜像上传后服务器起不来的往返）。

#### 场景：主路径（单头放行）

Given 迁移图单头
When 运行 build-and-save.sh
Then 预检打印「单头 OK: <revision>」并继续构建。

#### 场景：多头拦截

Given 迁移图两 head
When 运行 build-and-save.sh
Then 打印两 head 清单与 merge 提示后 exit 1，不进入 docker build。

#### 场景：本地环境缺失

Given backend Python 环境缺 alembic（命令报错）
When 运行 build-and-save.sh
Then exit 1 并提示 `uv sync` 修复，不静默跳过预检。

### FR-03: 改动相关测试全绿（全量留给 CI）

- 必须：新测试文件单独运行通过；build-and-save.sh 通过 bash -n 语法检查且 LF 行尾（.gitattributes 强制）；守卫 grep 计数逻辑经多头/单头样例模拟验证。仅跑改动相关，全量留给 CI。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/tests/test_migration_single_head.py「test_alembic_single_head」
FR-02: deploy/scripts/build-and-save.sh「[2.5/5] alembic 迁移单头预检」——bash -n 语法过 + grep 计数模拟（两 head 样例计数 2、单头样例计数 1、当前仓库实跑 heads-count=1）+ LF 校验 0
FR-03: FR-01/FR-02 绑定行合计——pytest 1 passed，bash 语法与模拟全过
