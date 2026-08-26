/**
 * 2026-08-26-workspace-mcp-edit task-10：validateWorkspaceMcpJson 纯函数单测。
 *
 * 依据 requirements FR-01/FR-02（D-002@v1 前端校验）：
 *   - JSON 语法 / 顶层 mcpServers / command 非空 / args 数组 / 仅 stdio / env 字典
 *   - 错误信息中文且定位 server 名
 */
import { describe, expect, it } from "vitest";

import { validateWorkspaceMcpJson } from "@/app/(dashboard)/workspaces/[id]/mcp/page";

describe("validateWorkspaceMcpJson（task-10 前端校验纯函数）", () => {
  it("空文本 → 配置不能为空", () => {
    expect(validateWorkspaceMcpJson("")).toEqual({ ok: false, error: "配置不能为空" });
    expect(validateWorkspaceMcpJson("   ")).toEqual({ ok: false, error: "配置不能为空" });
  });

  it("非法 JSON → JSON 语法错误（中文）", () => {
    const r = validateWorkspaceMcpJson("{ not json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^JSON 语法错误/);
  });

  it("顶层缺 mcpServers → 结构不合法", () => {
    const r = validateWorkspaceMcpJson('{"foo": 1}');
    expect(r.ok).toBe(false);
  });

  it("合法配置（type 缺省视为 stdio）→ ok 且数据归一", () => {
    const r = validateWorkspaceMcpJson(
      '{ "mcpServers": { "db": { "command": "postgres", "env": { "POOL": "5" } } } }',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.mcpServers.db?.command).toBe("postgres");
      expect(r.data.mcpServers.db?.args).toEqual([]); // zod default 归一
      expect(r.data.mcpServers.db?.env).toEqual({ POOL: "5" });
    }
  });

  it("type 非 stdio → 中文报错含 server 名", () => {
    const r = validateWorkspaceMcpJson(
      '{ "mcpServers": { "remote": { "type": "http", "command": "x" } } }',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('server "remote"：仅支持 stdio 类型（本地命令）的 MCP 服务器');
  });

  it("command 缺失 → 中文报错含 server 名", () => {
    const r = validateWorkspaceMcpJson('{ "mcpServers": { "r": { "args": [] } } }');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('server "r"：command 不能为空');
  });

  it("args 非数组 / env 非字符串字典 → 报错", () => {
    expect(validateWorkspaceMcpJson('{ "mcpServers": { "r": { "command": "x", "args": "not-array" } } }').ok).toBe(false);
    expect(validateWorkspaceMcpJson('{ "mcpServers": { "r": { "command": "x", "env": { K: 1 } } } }').ok).toBe(false);
  });

  it("<set> 占位符原样通过（保留语义由后端还原，D-003@v2）", () => {
    const r = validateWorkspaceMcpJson(
      '{ "mcpServers": { "db": { "command": "x", "env": { "PASSWORD": "<set>" } } } }',
    );
    expect(r.ok).toBe(true);
  });
});
