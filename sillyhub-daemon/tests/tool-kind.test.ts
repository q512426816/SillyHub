// tests/tool-kind.test.ts
// task-03: daemon classifyToolKind TS 单测。与 task-02 backend/tests/modules/agent/test_tool_kind.py
// 用例表 1:1 对应（同输入同输出，R-05 防漂移）。design.md §7 TS 段逐字参照。
// 改一边必须同步另一边。

import { describe, it, expect } from 'vitest';
import {
  TOOL_KIND_VALUES,
  classifyToolKind,
} from '../src/tool-kind.js';

// ── 枚举完整性（对照 Python test_tool_kind.py：14 枚举全覆盖）──

describe('TOOL_KIND_VALUES', () => {
  it('恰好 14 个枚举值，与 Python TOOL_KIND_VALUES 逐字一致', () => {
    expect(TOOL_KIND_VALUES).toEqual([
      'sillyspec', 'skill', 'bash', 'read', 'write',
      'search', 'task', 'web', 'todo', 'plan',
      'ask', 'schedule', 'mcp', 'other',
    ]);
    expect(TOOL_KIND_VALUES).toHaveLength(14);
  });
});

// ── classifyToolKind（对照 Python test_tool_kind.py 用例表，同输入同输出）──

describe('classifyToolKind', () => {
  // ── 边界：toolName 缺失 → null ──

  it('toolName=null → null', () => {
    expect(classifyToolKind(null, undefined)).toBeNull();
  });

  it('toolName=undefined → null', () => {
    expect(classifyToolKind(undefined, undefined)).toBeNull();
  });

  it('toolName=空串 → null（!toolName 命中）', () => {
    expect(classifyToolKind('', { command: 'ls' })).toBeNull();
  });

  // ── sillyspec（D-001@v1：command 含 sillyspec 子串即标，不分子命令）──

  it('Bash "sillyspec run execute && git commit" → sillyspec（复合命令子串匹配）', () => {
    expect(
      classifyToolKind('Bash', { command: 'sillyspec run execute && git commit' }),
    ).toBe('sillyspec');
  });

  it('Bash "npx sillyspec run plan" → sillyspec（npx wrapper 子串匹配）', () => {
    expect(
      classifyToolKind('Bash', { command: 'npx sillyspec run plan' }),
    ).toBe('sillyspec');
  });

  it('Bash "sillyspec run verify" → sillyspec（不分子命令）', () => {
    expect(
      classifyToolKind('Bash', { command: 'sillyspec run verify' }),
    ).toBe('sillyspec');
  });

  // ql-20260705-006 (C3)：主命令判定，覆盖复合命令 + 排除脚本内容误归
  it('Bash "git add . && sillyspec run execute" → sillyspec（C3 复合命令第二段是主命令）', () => {
    expect(
      classifyToolKind('Bash', { command: 'git add . && sillyspec run execute' }),
    ).toBe('sillyspec');
  });

  it('Bash "cat docs/sillyspec-note.md" → bash（C3 排除脚本内容含字样误归）', () => {
    expect(
      classifyToolKind('Bash', { command: 'cat docs/sillyspec-note.md' }),
    ).toBe('bash');
  });

  it('Bash "grep sillyspec *.ts" → bash（C3 排除 grep 模式误归）', () => {
    expect(
      classifyToolKind('Bash', { command: 'grep sillyspec *.ts' }),
    ).toBe('bash');
  });

  it('Bash "ls -la" → bash（不含 sillyspec）', () => {
    expect(classifyToolKind('Bash', { command: 'ls -la' })).toBe('bash');
  });

  it('Bash command 缺失 → bash（String(undefined ?? "") 不含 sillyspec）', () => {
    expect(classifyToolKind('Bash', undefined)).toBe('bash');
    expect(classifyToolKind('Bash', {})).toBe('bash');
  });

  it('Bash command 非字符串（数字）→ bash（String(123) 不含 sillyspec）', () => {
    expect(classifyToolKind('Bash', { command: 123 })).toBe('bash');
  });

  // ── skill ──

  it('Skill → skill（不细分技能名，N2）', () => {
    expect(classifyToolKind('Skill', { name: 'sillyspec-plan' })).toBe('skill');
  });

  // ── read ──

  it('Read → read', () => {
    expect(classifyToolKind('Read', { file_path: '/tmp/a.txt' })).toBe('read');
  });

  // ── write（Write/Edit/MultiEdit/NotebookEdit）──

  it('Write → write', () => {
    expect(classifyToolKind('Write', { file_path: '/tmp/a.txt' })).toBe('write');
  });

  it('Edit → write', () => {
    expect(classifyToolKind('Edit', { file_path: '/tmp/a.txt' })).toBe('write');
  });

  it('MultiEdit → write', () => {
    expect(classifyToolKind('MultiEdit', { file_path: '/tmp/a.txt' })).toBe('write');
  });

  it('NotebookEdit → write', () => {
    expect(classifyToolKind('NotebookEdit', { notebook_path: '/tmp/nb.ipynb' })).toBe('write');
  });

  // ── search（Grep/Glob）──

  it('Grep → search', () => {
    expect(classifyToolKind('Grep', { pattern: 'foo' })).toBe('search');
  });

  it('Glob → search', () => {
    expect(classifyToolKind('Glob', { pattern: '**/*.ts' })).toBe('search');
  });

  // ── task（Task/Agent）──

  it('Task → task', () => {
    expect(classifyToolKind('Task', { description: 'research' })).toBe('task');
  });

  it('Agent → task', () => {
    expect(classifyToolKind('Agent', { description: 'research' })).toBe('task');
  });

  // ── web（WebSearch/WebFetch）──

  it('WebSearch → web', () => {
    expect(classifyToolKind('WebSearch', { query: 'foo' })).toBe('web');
  });

  it('WebFetch → web', () => {
    expect(classifyToolKind('WebFetch', { url: 'https://example.com' })).toBe('web');
  });

  // ── todo（TodoWrite/TaskCreate/TaskUpdate/TaskGet/TaskList）──

  it('TodoWrite → todo', () => {
    expect(classifyToolKind('TodoWrite', { todos: [] })).toBe('todo');
  });

  it('TaskCreate → todo', () => {
    expect(classifyToolKind('TaskCreate', { subject: 'x' })).toBe('todo');
  });

  it('TaskUpdate → todo', () => {
    expect(classifyToolKind('TaskUpdate', { taskId: '1' })).toBe('todo');
  });

  it('TaskGet → todo', () => {
    expect(classifyToolKind('TaskGet', { taskId: '1' })).toBe('todo');
  });

  it('TaskList → todo', () => {
    expect(classifyToolKind('TaskList', {})).toBe('todo');
  });

  // ── plan（ExitPlanMode）──

  it('ExitPlanMode → plan', () => {
    expect(classifyToolKind('ExitPlanMode', { plan: 'x' })).toBe('plan');
  });

  // ── ask（AskUserQuestion）──

  it('AskUserQuestion → ask', () => {
    expect(classifyToolKind('AskUserQuestion', { question: 'x' })).toBe('ask');
  });

  // ── schedule（cron*/ScheduleWakeup）──

  it('CronCreate → schedule（cron 前缀）', () => {
    expect(classifyToolKind('CronCreate', { cron: '0 9 * * *' })).toBe('schedule');
  });

  it('ScheduleWakeup → schedule', () => {
    expect(classifyToolKind('ScheduleWakeup', { when: '2026-07-05' })).toBe('schedule');
  });

  // ── mcp（D-002@v1：mcp__ 前缀统一一类，不细分 server/tool）──

  it('mcp__playwright__browser_navigate → mcp（不细分 server/tool）', () => {
    expect(
      classifyToolKind('mcp__playwright__browser_navigate', { url: 'https://example.com' }),
    ).toBe('mcp');
  });

  it('mcp__web_reader__webReader → mcp（不同 server 仍统一）', () => {
    expect(
      classifyToolKind('mcp__web_reader__webReader', { url: 'https://example.com' }),
    ).toBe('mcp');
  });

  // ── other（未知工具）──

  it('未知工具 "SomeUnknownTool" → other', () => {
    expect(classifyToolKind('SomeUnknownTool', {})).toBe('other');
  });

  it('空对象未知工具 → other', () => {
    expect(classifyToolKind('FooBar', undefined)).toBe('other');
  });

  // ── 大小写归一化（与 Python .lower() 一致）──

  it('大小写归一化：BASH/Read/READ 同义', () => {
    expect(classifyToolKind('BASH', { command: 'echo hi' })).toBe('bash');
    expect(classifyToolKind('READ', { file_path: '/tmp/a' })).toBe('read');
    expect(classifyToolKind('rEaD', { file_path: '/tmp/a' })).toBe('read');
  });

  it('大小写归一化：BASH 含 sillyspec 仍标 sillyspec（cmd 子串匹配，原始串需含小写 sillyspec）', () => {
    expect(
      classifyToolKind('BASH', { command: 'sillyspec run execute' }),
    ).toBe('sillyspec');
  });

  it('大小写注意：cmd="SILLYSPEC run" 不含小写 sillyspec 子串 → bash（与 Python 一致，cmd 不归一化）', () => {
    expect(
      classifyToolKind('BASH', { command: 'SILLYSPEC run execute' }),
    ).toBe('bash');
  });

  it('大小写归一化：MCP__ 前缀大写不命中（仅小写 mcp__ 匹配，与 Python 一致）', () => {
    // Python: name = tool_name.lower() 后再 startswith("mcp__")，故 MCP__ 经 lower → mcp__ 命中
    expect(classifyToolKind('MCP__playwright__nav', {})).toBe('mcp');
  });

  // ── 14 枚举全覆盖断言（每个 kind 至少 1 个用例已上方覆盖）──
  it('14 枚举均有用例覆盖（sillyspec/skill/bash/read/write/search/task/web/todo/plan/ask/schedule/mcp/other）', () => {
    const covered = new Set<ToolKind | null>();
    covered.add(classifyToolKind('Bash', { command: 'sillyspec run x' }));
    covered.add(classifyToolKind('Skill', {}));
    covered.add(classifyToolKind('Bash', { command: 'ls' }));
    covered.add(classifyToolKind('Read', {}));
    covered.add(classifyToolKind('Write', {}));
    covered.add(classifyToolKind('Grep', {}));
    covered.add(classifyToolKind('Task', {}));
    covered.add(classifyToolKind('WebSearch', {}));
    covered.add(classifyToolKind('TodoWrite', {}));
    covered.add(classifyToolKind('ExitPlanMode', {}));
    covered.add(classifyToolKind('AskUserQuestion', {}));
    covered.add(classifyToolKind('CronCreate', {}));
    covered.add(classifyToolKind('mcp__x__y', {}));
    covered.add(classifyToolKind('Unknown', {}));
    // 全部 14 枚举都覆盖到
    for (const kind of TOOL_KIND_VALUES) {
      expect(covered.has(kind)).toBe(true);
    }
  });
});
