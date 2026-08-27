# quick --req 以 / 开头的文案被 Git Bash 路径转换污染 QUICKLOG 标题

- 日期：2026-08-27
- 变更：quick-cb5b006c（ql-20260827-005-a660）
- 状态：活跃（工具未修，传参侧规避有效）

## 现象

`--req "/sessions 页整页滚动条修复（门户容器高度与 TopBar 不符）"` 落盘后
QUICKLOG 标题与「需求：」行变成：

```
E:/Software/Git/sessions 页整页滚动条修复（门户容器高度与 TopBar 不符）
```

## 根因

Git Bash（MSYS2）对以 `/` 开头的命令行参数做 POSIX→Windows 路径自动转换：
`/sessions` 被展开为 `<Git 安装目录>/sessions`（本机 `E:/Software/Git/sessions`），
sillyspec CLI 收到的已是污染串。CLI 侧无感知、无校验，直接写进 QUICKLOG
标题（也是平台「快速修复」列表的展示标题）。

## 影响

- QUICKLOG 条目标题 / 需求行被污染，语义错乱（`E:/Software/Git/sessions 页…`）；
- 该标题会推送到平台列表，污染展示；
- 任何以 `/xxx` 开头的 `--req` / `--output` 文案都会触发（页面路由类反馈是高频场景，
  本次正是用户报 `/sessions` 页面问题）。

## 规避（文件侧 + 传参侧）

- 传参侧（根治）：以 `/` 开头的文案前加 `MSYS_NO_PATHCONV=1` 环境变量，或不带
  前导 `/`（写 `sessions 页…` / 「/sessions」加引号内前缀字等方式均无效——MSYS
  只看参数是否以 `/` 开头，引号不救）；
- 文件侧（事后）：`--done` 后核对标题，手动 sed 修正（本次已修）。

## 建议工具侧修复

`--done` 落盘前对 req/output 做一次可疑路径嗅探（如 `^[A-Za-z]:/.*` 且含中文/
空格紧随其后），或文档明确 Windows Git Bash 下需 `MSYS_NO_PATHCONV=1`。
