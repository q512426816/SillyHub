---
author: qinyi
created_at: 2026-08-18 11:50:40
---
# 任务清单（Tasks）— 工作区文件浏览器（只读）

（骨架，plan 阶段展开为 Wave/Task 明细）

- [ ] task-01: daemon file-rpc 新增 explorerListDir/explorerReadFile/explorerSearch（realpath+allowed_roots 双校验、10MB 截断、encoding 参数、噪声排除）
- [ ] task-02: daemon.ts 注册 explorer_* 三 handler + daemon 侧测试
- [ ] task-03: backend explorer 模块 schema/service（绑定解析复用 MemberBindingResolver + 跨平台 containment 预检 + 错误映射）
- [ ] task-04: backend explorer router 四端点 + main 挂载 + backend 测试
- [ ] task-05: pnpm gen:types 同步 openapi.json + api-types.ts
- [ ] task-06: frontend explorer 页面 + 文件树懒加载 + 搜索（祖先链展开直达）
- [ ] task-07: frontend 文件预览组件（高亮/MD/图片/下载）+ 三降级态 + workspace-tabs 标签
- [ ] task-08: frontend 测试 + 新依赖 react-syntax-highlighter 引入
- [ ] task-09: 真实仓库实测（搜索耗时、10MB download 全链路）+ 文档同步
