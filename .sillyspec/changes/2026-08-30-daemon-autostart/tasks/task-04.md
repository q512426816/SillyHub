---
id: task-04
title: 'Linux 策略 src/autostart/linux.ts——service 文件生成（WantedBy=default.target 无 Restart）+ systemctl --user daemon-reload/enable/disable --now + loginctl enable-linger best-effort + PID1 非 systemd 明确报错'
title_zh: 'Linux 策略 src/autostart/linux.ts——service 文件生成（WantedBy=default.target 无 Restart）+ systemctl --user daemon-reload/enable/disable --now + loginctl enable-linger best-effort + PID1 非 systemd 明确报错'
author: 'qinyi'
created_at: 2026-08-30 23:01:28
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/autostart/linux.ts
expects_from:
  task-01:
    - contract: autostart 平台策略接口
      needs: [register, unregister, query, buildStartCommand, taskNameFor]
    - contract: autostart 类型定义
      needs: [AutostartRecord]
provides:
  - contract: Linux autostart 策略
    fields: [register, unregister, query]
goal: >
  实现 Linux 平台自启策略 src/autostart/linux.ts——生成 systemd user service 并经
  systemctl --user 注册/注销/查询（sillyhub-daemon-<hash8>.service），配 loginctl
  enable-linger best-effort 与 PID1 非 systemd 检测（R-04），使 Linux 用户一条命令完成
  登录（linger 成功时接近不登录开机）自启注册（FR-03；design §2 Linux 列；无 Restart
  保活 D-002）。
implementation:
  - 填充 task-01 留下的 src/autostart/linux.ts stub——ESM import（带 .js 扩展名）平台策略接口 register/unregister/query、AutostartRecord 类型与命令模板函数（node=process.execPath，script=path.resolve(process.argv[1])）
  - register 前置检测（R-04）——读 /proc/1/comm（不可读时回退 ps -p 1 -o comm=）判断 PID1 是否 systemd；非 systemd（WSL 默认/容器）返回明确错误（说明不支持原因 + 替代建议——WSL 启用 systemd 或改 Windows 侧安装），不执行任何写文件/注册命令（CLI 层 exit 1，不静默失败）
  - register 步骤 1（service 生成）——写 ~/.config/systemd/user/sillyhub-daemon-<hash8>.service（hash8=serverHash(serverUrl)，来自 sillyhub-daemon/src/config.ts），INI 内容——Service 段 ExecStart=命令模板（<node绝对路径> <脚本绝对路径> start --server <serverUrl>，路径含空格时按 INI 引号规则处理）；Install 段 WantedBy=default.target（用户会话建立时触发）；不写 Restart 键（默认 no，D-002 无保活）
  - register 步骤 2（systemctl 注册，幂等）——依次执行 systemctl --user daemon-reload 与 systemctl --user enable sillyhub-daemon-<hash8>.service（重复 enable 覆盖不报错，R-07）
  - register 收尾（linger best-effort）——执行 loginctl enable-linger（当前用户）；失败仅输出 warn（降级为登录后自启），不影响注册成功返回（exit 0 语义）
  - unregister——执行 systemctl --user disable --now sillyhub-daemon-<hash8>.service，删除 service 文件，再执行 systemctl --user daemon-reload
  - query——执行 systemctl --user is-enabled sillyhub-daemon-<hash8>.service——enabled=registered、not-found 或 disabled=missing、命令执行失败=unknown（供 index.ts status 对账）
acceptance:
  - service 文件内容含 ExecStart 命令模板（node/脚本绝对路径 + start --server <serverUrl>）与 WantedBy=default.target，且全文不含 Restart 键
  - PID1 非 systemd 时返回含替代建议（WSL 启用 systemd 或改 Windows 侧安装）的明确错误，且未执行任何写文件/注册命令
  - loginctl enable-linger 失败时注册仍返回成功（仅 warn，不影响 exit 0）
  - 重复 register 幂等（daemon-reload + enable 覆盖）；unregister 后 service 文件已删且 daemon-reload 已再次执行；query 三态映射正确
verify:
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - ESM import 一律带 .js 扩展名（如 from './index.js'）
  - 不引入任何 npm 依赖，仅用 node:child_process/node:fs/node:path/node:os 内置模块
  - linux.ts 只承载 linux 侧逻辑，不在非 Linux 平台执行任何系统命令（平台分派由 index.ts 按 process.platform 完成）
  - 本地记录 autostart-<hash8>.json 的读写归 index.ts（task-01），本卡只产系统注册产物（service 文件 + systemd user 注册）
  - service 产物断言（无 Restart）与 PID1 检测/linger 降级错误路径断言归 task-06 tests/autostart.test.ts，本卡不写测试文件
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
