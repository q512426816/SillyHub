---
id: task-10
title: 'sillyhub-daemon/README.md 新增「开机自启动」小节（三平台说明 + 命令 + 已知限制四条）'
title_zh: 'sillyhub-daemon/README.md 新增「开机自启动」小节（三平台说明 + 命令 + 已知限制四条）'
author: 'qinyi'
created_at: 2026-08-30 23:01:28
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-08]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/README.md
goal: >
  在 sillyhub-daemon/README.md 新增「开机自启动」小节：三平台机制与"开机（或登录）后自动
  启动"语义说明 + enable/disable/status 命令 + 已知限制四条，作为自启能力的正式文档面
  （design §4.3 / FR-08）。
implementation:
  - '插入位置：「其他子命令」（L75-81）与「配置文件路径」（L83）之间，新增二级标题「## 开机自启动」，与既有小节同层级、中文文案'
  - '语义说明段：三平台均为「开机（或登录）后自动启动」——Windows 计划任务 = 登录时、macOS LaunchAgent = 登录时加载、Linux systemd 用户服务 = 用户会话建立时（enable-linger 成功时接近不登录也开机启动）；统一不承诺纯开机语义（design 目标 1 精确化措辞，Grill C-03）'
  - '命令清单代码块：`sillyhub-daemon autostart enable --server <url> --api-key <key>`（注册，幂等可重复执行覆盖；建议用 API Key，登录 Token 会过期）、`sillyhub-daemon autostart status`（查看注册状态）、`sillyhub-daemon autostart disable --server <url>` / `--all`（取消自启，不停止运行中的 daemon；卸载 daemon 前先 disable）'
  - '三平台机制一行说明：Windows 计划任务（schtasks）/ macOS launchd（LaunchAgent）/ Linux systemd user service，全部用户级注册、免管理员/root'
  - '「已知限制」列表四条：① nvm/volta/asdf 型 node 升级换路径后自启任务会失效，重新执行 enable 覆盖即修复（R-01）；② WSL 默认无 systemd（PID1 非 systemd）不支持，需在 WSL 启用 systemd 或改用 Windows 侧安装（R-04）；③ VBScript 处于 Microsoft 弃用轨道，未来 Windows FOD 缺失导致 wscript 不可用时迁移到 conhost --headless / PowerShell -WindowStyle Hidden（R-10）；④ install.sh/ps1 尾部提示经 backend 镜像 /app/daemon-dist/ 下发，改安装脚本后需重建 backend 镜像才到达新装用户（R-11；autostart CLI 能力本身随 bundle 自更新分发，不受此限）'
acceptance:
  - 'README 含「开机自启动」小节，enable/disable/status 三命令齐全且参数正确'
  - '三平台说明使用「开机（或登录）后自动启动」措辞，未承诺纯开机启动'
  - '已知限制含四条：nvm 型 node 路径漂移、WSL 无 systemd、VBScript 弃用前瞻、改安装脚本需重建 backend 镜像'
  - 'README 其余既有小节（前置要求/安装/启动/其他子命令/配置文件路径/故障排查/开发）内容零改动'
verify:
  - grep -n "开机自启动" sillyhub-daemon/README.md
  - grep -n "autostart enable" sillyhub-daemon/README.md
  - grep -c "已知限制" sillyhub-daemon/README.md
constraints:
  - '只新增小节，不改动 README 既有小节内容与结构（纯追加）'
  - '限制条目与 design.md 风险登记 R-01/R-04/R-10/R-11 一致，不虚标能力（不写保活、不写纯开机承诺，D-002 语义）'
  - '文案中文（CLAUDE.md 规则 12），命令示例用 <url>/<key> 通用占位符，不含真实凭据'
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
