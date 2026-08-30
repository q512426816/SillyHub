---
id: task-09
title: 'install.sh（L487-493 下一步块）/install.ps1（L350-357 + DG-04 注释更新）尾部追加自启命令提示'
title_zh: 'install.sh（L487-493 下一步块）/install.ps1（L350-357 + DG-04 注释更新）尾部追加自启命令提示'
author: 'qinyi'
created_at: 2026-08-30 23:01:28
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-08]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/scripts/install.sh
  - sillyhub-daemon/scripts/install.ps1
goal: >
  在 install.sh / install.ps1 安装完成后的"下一步"提示块尾部各追加一行自启命令提示
  （--server 用脚本实参变量展开），并更新 install.ps1 的 DG-04 注释为"自启由 CLI autostart
  子命令提供，安装器不做注册"（design §4.2 / FR-08 / D-001@v1：安装器仅提示不注册）。
implementation:
  - 'install.sh：在 main() 的"下一步"echo 块（L487-493，`ok "安装完成！"` 至最后一行 `echo ""` 区段内）追加一行提示，--server 用脚本已推导的 $SERVER_URL 实参变量（L89-94 演绎产物），形如：`echo "  开机自启（可选）: sillyhub-daemon autostart enable --server $SERVER_URL --api-key <你的 API Key>"`（对齐 L490 既有「下一步:」行的文案风格）'
  - 'install.sh 严禁改动 L463-475 maybe_start 自动启动区与其它安装逻辑（Grill C-17 锚点），本次仅追加提示行'
  - 'install.ps1：在 Main 的提示块（L348-354 Write-Host 区，"Installation complete!" 之后）同位置追加一行，server 实参用 `$($script:SERVER_URL)`（L339 同源），形如：`Write-Host "  Autostart (optional): sillyhub-daemon autostart enable --server $($script:SERVER_URL) --api-key <your API key>"`（与该块英文提示风格一致）'
  - 'install.ps1：更新 L356-357 DG-04 注释为「自启由 CLI autostart 子命令提供，安装器不做注册」（保留 no auto start 语义并指向新 CLI 能力）；install.sh 若有同类注释一并同步'
  - '两脚本参数解析 / 下载 / PATH / config 保存 / verify 逻辑零改动，不新增任何脚本参数'
acceptance:
  - 'install.sh L487-493 下一步块含一行 `sillyhub-daemon autostart enable`，且 `--server` 后跟 $SERVER_URL 变量（运行时展开为实际地址，非硬编码）'
  - 'install.ps1 Main 尾部提示块含同语义一行（--server 为 $($script:SERVER_URL)）'
  - 'install.ps1 DG-04 注释为「自启由 CLI autostart 子命令提供，安装器不做注册」，旧表述无残留'
  - '两脚本除新增提示行与注释更新外零 diff（maybe_start 与既有流程不动）；install.sh 通过 bash -n 语法检查'
verify:
  - cd sillyhub-daemon && bash -n scripts/install.sh
  - grep -n "autostart enable" sillyhub-daemon/scripts/install.sh sillyhub-daemon/scripts/install.ps1
  - grep -n -A2 "DG-04" sillyhub-daemon/scripts/install.ps1
constraints:
  - '勿动 install.sh L463-475 maybe_start 自动启动区（只改 L487-493 下一步提示块；maybe_start 仍保持在提示块之后调用不变）'
  - '安装器不做任何自启注册动作（D-001@v1：CLI 子命令形态，脚本仅打印提示文案）'
  - '提示命令的 --server 必须用脚本实参变量（$SERVER_URL / $($script:SERVER_URL)），禁止硬编码地址或 <占位符>'
  - '不新增脚本参数、不改变退出码与既有输出行语义；两脚本改动均为纯追加/注释替换'
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
