# CLAUDE.md


本项目使用 SillySpec，文档驱动开发，合理使用 sillyspec 相关 skills。

## 硬性规则

1. 禁止跳过下面的规则和流程
2. 禁止无文档改代码，禁止先写代码再补文档
3. 新功能 / 大改动走完整流程(调用sillyspec相关技能)：`sillyspec run brainstorm` → plan → execute → verify
4. 小修复 / 小调整(调用sillyspec相关技能)：`sillyspec run quick`
5. 修改代码前，说明依据的文档路径
6. 实现完成后，对照文档验收，还要看看是否涉及已存在的测试用例（TDD）
7. 测试用例非逻辑调整的情况下不允许直接修改让测试通过 
8. 本项目未正式上线，不需要考虑版本迭代兼容问题，数据可以清空 
9. 禁止回复 你说得对 类似的话语，阿谀奉承！ 
10. 代码提交如果被hook拦截了禁止跳过，需要解决问题再提交！ 
11. UI和文档尽量使用中文展示，除了特殊的专业术语等 
12. 代码实现要考虑 windows 和 macos 两个操作系统 
13. 执行过程中如果发现 sillySpec 工具的缺陷或者可改进项可直接记录到项目根目录 \docs\sillyspec/ 目录下
14. 前端样式风格统一参考 \.sillyspec\changes\archive\2026-06-21-2026-06-21-frontend-style-system\prototype-frontend-style-system.html 和 \.sillyspec\changes\archive\2026-06-21-2026-06-21-frontend-style-system\design.md

## 执行顺序

文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收 → 更新文档 
