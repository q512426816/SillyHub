---
author: flow-machine-draft
created_at: 2026-10-08T02:54:25.629Z
---
# 决策记录（Decisions）— 2026-10-08-backend-skills-follow-cli

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：sillyspec 未来版本改包内目录布局（`.claude/skills` 移位）→ COPY 构建期失败（fail-closed 可见，非运行期暗病）；其次 npm latest 引入破坏性变更直进生产（无 pin 缓冲）——缓解：build-and-save.sh 回显版本留痕、backup tag + .env pin 双回滚口，且 sillyspec 是用户自研工具、发布节奏自控。放弃方案：①保留仓库快照源 + 定期 init 刷新——放弃理由：自动化仍靠人记着做，正是本次要消灭的错位根源；②容器启动时 runtime npm install 拉最新——放弃理由：启动时延+网络依赖+镜像内容不确定（同 tag 不同行为），破坏回滚语义；③CI 定时重建——放弃理由：当前无 CI 部署链，超出本变更面。
