---
id: task-05
title: 'CLI autostart 子命令组 src/cli.ts——嵌套子命令 enable/disable/status 接线 + enable 凭据管线（loadConfigFn 合并 + 无条件 saveConfigFn + token↔api_key 互斥互清 + 凭据缺失 exit 1 + --token 过期警告 + nvm/volta/asdf 路径警告）'
title_zh: 'CLI autostart 子命令组 src/cli.ts——嵌套子命令 enable/disable/status 接线 + enable 凭据管线（loadConfigFn 合并 + 无条件 saveConfigFn + token↔api_key 互斥互清 + 凭据缺失 exit 1 + --token 过期警告 + nvm/volta/asdf 路径警告）'
author: 'qinyi'
created_at: 2026-08-30 23:01:28
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-001@v1, D-004@v1]
expects_from:
  task-01:
    - contract: autostart 顶层 API
      needs: [enableAutostart, disableAutostart, autostartStatus]
provides:
  - contract: cli.ts autostart 子命令组行为
    fields: [enable 分派与退出码, 凭据缺失 exit 1 不注册, --token 警告文案, disable 分派, status 恒 0]
allowed_paths:
  - sillyhub-daemon/src/cli.ts
goal: >
  在 src/cli.ts 新增 autostart 嵌套子命令组（enable/disable/status），把 task-01 顶层 API
  接到 CLI 用户面；enable 凭据管线与 startAction 逐字对齐（无条件落盘先于凭据校验），
  让用户一条命令完成开机（或登录）自启的注册/注销/查询（design §3，D-001@v1/D-004@v1）。
implementation:
  - commander 嵌套子命令组（现有 5 命令为平级单层，autostart 为首个嵌套组，commander 原生支持）：program.command('autostart') 下挂 enable/disable/status 三个子命令；action 沿用「返回退出码，非 0 才 process.exit」模式，回调收参数对象（与 startAction 同形，便于测试直调）
  - enable 选项 --server <url> / --api-key <key> / --token <t>；token 与 api-key 同时给 → stderr + return 1（先于 config 加载，对齐 startAction step 0 互斥校验）；不带 --server 时用 DEFAULT_CONFIG.server_url 兜底后传入（Grill C-19）
  - enable 凭据管线与 startAction L520-545 对齐：loadConfigFn(serverUrl) 合并 CLI 覆盖（token↔api_key 互斥互清）→ **无条件 saveConfigFn(config, config.server_url) 落盘**（落盘先于凭据校验）→ 之后才调 enableAutostart
  - 凭据缺失判定：合并后 config 与命令行均无 token/api_key → stderr 打印错误 + 提示（先带凭据成功启动一次，或本命令直接追加 --api-key）并 return 1，不注册任何任务（enableAutostart 不被调用，不留半残注册）
  - --token 警告（R-12/Grill C-20）：凭据来源是 --token（短时效 JWT）时输出琥珀警告「登录 Token 会过期，开机后大概率无法连接，建议改用 --api-key」；另 process.execPath 位于 .nvm//volta//asdf/ 版本化目录时输出路径漂移警告（R-01：node 升级换路径后自启任务会失效，届时重新执行本命令即可）
  - enable 成功（ok:true）打印任务标识、启动命令、日志位置、「立即启动可执行 sillyhub-daemon start --server <url>」提示；失败（ok:false）→ stderr 输出 error+hint + return 1
  - disable：按 --server <url> 或 --all 调 disableAutostart；仅一个注册时可省 --server 直接注销，多个注册且未指定时列出记录供用户选择后重试；只注销注册（系统任务/VBS/本地记录）不杀运行中进程，输出提示停进程仍用 stop；成功打印 removed 清单
  - status：调 autostartStatus() 输出 server / 任务标识 / 系统注册状态（registered/missing/unknown）表格；无本地记录时提示未注册；恒 return 0（查询路径不报错退出）
acceptance:
  - createProgram() 命令树含 autostart 组及 enable/disable/status 三子命令，enable 暴露 --server/--api-key/--token 选项；现有 start/stop/status/logs/clean 五命令零改动
  - enable 凭据齐备路径：saveConfigFn 在 enableAutostart 之前被无条件调用（与 startAction 落盘语义一致）；凭据缺失路径 return 1 且 enableAutostart 未被调用
  - --token 路径输出「登录 Token 会过期」警告文案；--api-key 路径不出现该警告
  - disable 单注册可省 --server 注销、多注册列出选择、--all 全清，输出含停进程仍用 stop 的提示
  - status 输出 registered/missing/unknown 三态表格，无记录时提示未注册且退出码恒 0
verify:
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 不改现有 5 个平级命令（start/stop/status/logs/clean）的选项与行为（plan 全局验收 5：cli.test.ts 既有断言零适配通过）
  - 打印文案中文（仓库 UI/文档中文约定，CLAUDE.md 规则 12）；错误统一走现有 stderr + 退出码模式
  - 本卡不写/不改测试（cli.test.ts 断言归 task-07）；不动 src/autostart/ 目录（归 task-01~04）；零新增 npm 依赖
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
