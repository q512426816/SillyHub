---
author: flow-machine-draft
created_at: 2026-10-16T03:35:02.975Z
---
# 需求规格（Requirements）— 2026-10-15-server-logs-dockerfile-fix

## 功能需求

### FR-01: Dockerfile 构建期预建 /data/logs 并 chown 给 app 用户（对齐 /data/spec-workspaces 既有惯例），容器启动后日志文件可正常创建写入

- 必须：backend/Dockerfile 构建期 mkdir 必须包含 /data/logs 且 chown 归 app 用户（对齐 /data/spec-workspaces 同一行惯例），使运行期 FileWriter 对默认日志路径的 mkdir/写入不再权限被拒。

#### 场景：主路径

Given 按 backend/Dockerfile 构建的镜像以 app 用户启动容器
When 后端 lifespan 执行 configure_logging 并产生首条日志
Then 默认日志路径（/data/logs/backend.log）的目录创建与文件写入必须成功，页面 GET /api/server-logs 返回非空 entries

### FR-02: configure_logging 建目录/挂 FileWriter 失败时向 stderr 输出一条警告（含失败原因），不再无声降级

- 必须：目录创建或 FileWriter 初始化抛 OSError 时，configure_logging 必须向 stderr 打印一条含「文件日志不可用」字样与异常原因的警告，随后仍以 stderr-only 语义继续运行（禁止抛出中断启动）。

#### 场景：主路径

Given 日志目录路径不可创建（如父路径为文件/权限被拒）
When configure_logging 执行
Then 必须不抛出，且 stderr 必须出现「文件日志不可用」与异常类型名的降级警告

### FR-03: 聚焦测试（test_server_log_filer.py）全绿且补降级警告断言用例

- 必须：backend/tests/test_server_log_filer.py 必须包含降级警告断言用例（断言 stderr 含「文件日志不可用」与异常信息），且 test_server_log_filer.py + test_server_logs_api.py + test_health.py 聚焦运行必须全绿。

#### 场景：主路径

Given 本修复提交的代码与测试
When 在 backend 目录聚焦运行三个测试文件
Then 必须全部通过且无回归

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：Dockerfile 构建层无 pytest 测试面——验证归部署冒烟（容器内 ls /data/logs + GET /api/server-logs 非空）
FR-02: backend/tests/test_server_log_filer.py「test_configure_degraded_prints_warning」
FR-03: backend/tests/test_server_log_filer.py 全文件（含新增用例）+ tests/test_server_logs_api.py + tests/test_health.py 聚焦运行 23 passed
