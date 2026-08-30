---
author: qinyi
created_at: 2026-08-30 23:30:00
change: 2026-08-30-daemon-autostart
---

# 符号影响面报告（Symbol Impact）— daemon 开机自启动（autostart）

结论总览：本变更为**新增模块 + 追加式接线**，不改任何既有函数签名/接口/DTO/导出，无签名级变更波及调用点。

| task | 签名级变更 | 说明 |
|---|---|---|
| task-01 | 无签名级变更 | 新建 src/autostart/ 四文件（index 顶层 API + 三平台 stub），全部为新导出，无既有符号触碰 |
| task-02 | 无签名级变更 | 新建 windows.ts，填充 task-01 预留 stub（同文件内实现替换，不改 stub 对外签名） |
| task-03 | 无签名级变更 | 新建 macos.ts，同上 |
| task-04 | 无签名级变更 | 新建 linux.ts，同上 |
| task-05 | 无签名级变更（cli.ts 追加式扩展） | cli.ts 仅新增 autostart 嵌套子命令组（program.command 链式追加），startAction/stopAction 等既有函数零改动；createProgram 导出签名不变 |
| task-06 | 无签名级变更 | 新建 tests/autostart.test.ts 纯新增 |
| task-07 | 无签名级变更 | tests/cli.test.ts 追加 describe 块，既有断言零修改 |
| task-08 | 无签名级变更 | page.tsx 追加 AutostartDaemonBlock 新组件 + 渲染插入，InstallDaemonBlock/CopyDaemonCommand 等既有导出零改动 |
| task-09 | 无签名级变更 | install.sh/ps1 尾部 echo/Write-Host 追加，DG-04 注释更新，无函数/参数改动 |
| task-10 | 无签名级变更 | README 纯文档追加 |
| task-11 | 无签名级变更 | .sillyspec/docs 四文档更新（新增模块卡 + 表述修正），无代码符号 |
