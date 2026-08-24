// tests/mcp-server-file.test.ts
// task-05（2026-08-23-agent-file-upload-mcp）：sillyhub-file MCP 双模式与上传工具单测。
//
// 覆盖（卡 acceptance 全项）：
//   1. MCP_TOOLSET 双模式：缺省/显式 orchestration → 5 编排工具零回归；
//      file → 仅 upload_file/list_uploaded_files 2 工具
//   2. 路径逃逸（R-01）：MCP_ALLOWED_ROOT 缺失 fail-closed / 绝对路径 / .. 出根 /
//      根内不存在（file_not_found）全部 isError 结构化错误
//   3. upload_file 成功路径：mock hub-client 断言转发参数（filename/字节/mime/
//      description/runId）；输出含 task-03 契约字段（file_id 口径）
//   4. list_uploaded_files：会话/worker 上下文 query 选择 + 输出 files[] 字段映射
//   5. hub-client uploadFileArtifact/listFileArtifacts（fetch mock）：multipart
//      FormData 字段、不设手工 Content-Type、X-Session-Id 附带、id → file_id 映射
//   6. mcp-config buildFileMcpServerConfig：env 注入与 mergeMcpConfigs 白名单惯例
//
// 测试形态复用 tests/mcp-server.test.ts：InMemoryTransport 连接 MCP Client + server
// （不 spawn 子进程），mock HubClient spy 断言参数。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createMcpServer,
  readEnv,
  FILE_MCP_SERVER_NAME,
  DAEMON_MCP_SERVER_NAME,
  type CreateMcpServerOptions,
} from '../src/mcp-server.js';
import {
  buildFileMcpServerConfig,
  FILE_MCP_SERVER_NAME as FILE_MCP_SERVER_NAME_CFG,
  MCP_TOOLSET_ENV,
  MCP_RUN_ID_ENV,
  MCP_ALLOWED_ROOT_ENV,
  mergeMcpConfigs,
  type McpConfig,
} from '../src/mcp-config.js';
import { HubClient, HubHttpError, X_SESSION_ID_HEADER } from '../src/hub-client.js';

// ── 通用 fixture ─────────────────────────────────────────────────────────────

const ORCHESTRATION_TOOLS = [
  'dispatch_worker',
  'get_worker_result',
  'list_workers',
  'converge_mission',
  'report_progress',
  // task-11（2026-08-24-session-team-mission-context）：第 6 常驻工具
  'mission_status',
];

/** 每用例独立的临时 allowedRoot（真实文件系统，跨平台 mkdtemp）。 */
let root: string;

beforeEach(async () => {
  vi.restoreAllMocks();
  root = await mkdtemp(join(tmpdir(), 'mcp-file-root-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 连接 Client + server（内存 transport）。toolset 缺省 orchestration（零回归基准）。 */
async function connect(
  client: HubClient,
  opts: CreateMcpServerOptions = {},
): Promise<{
  mcpClient: Client;
  close: () => Promise<void>;
}> {
  const { server } = createMcpServer(client, opts);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client(
    { name: 'test-client', version: '0.0.1' },
    { capabilities: {} },
  );
  await Promise.all([
    mcpClient.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return {
    mcpClient,
    close: async () => {
      await mcpClient.close().catch(() => {});
      await server.close().catch(() => {});
    },
  };
}

/** 调 tool 后解析 content[0].text 的 JSON（工具回执载体）。 */
function parseReceipt(result: { content: { type: string; text: string }[] }): unknown {
  const block = result.content[0];
  if (!block) throw new Error('tool result has no content block');
  return JSON.parse(block.text);
}

// ── 1. MCP_TOOLSET 双模式 ─────────────────────────────────────────────────────

describe('mcp-server-file: MCP_TOOLSET 双模式', () => {
  it('缺省（不传 opts）→ 5 编排工具零回归，不含文件工具', async () => {
    const client = new HubClient('http://mock', 'mock-token');
    const { mcpClient, close } = await connect(client);
    try {
      const tools = await mcpClient.listTools();
      const names = tools.tools.map((t) => t.name).sort();
      expect(names).toEqual([...ORCHESTRATION_TOOLS].sort());
      expect(names).not.toContain('upload_file');
      expect(names).not.toContain('list_uploaded_files');
    } finally {
      await close();
    }
  });

  it('opts.toolset=orchestration 显式 → 同 5 工具（与缺省逐名一致）', async () => {
    const client = new HubClient('http://mock', 'mock-token');
    const { mcpClient, close } = await connect(client, { toolset: 'orchestration' });
    try {
      const tools = await mcpClient.listTools();
      expect(tools.tools.map((t) => t.name).sort()).toEqual([...ORCHESTRATION_TOOLS].sort());
    } finally {
      await close();
    }
  });

  it('opts.toolset=file → 仅注册 upload_file/list_uploaded_files（2 工具）', async () => {
    const client = new HubClient('http://mock', 'mock-token');
    const { mcpClient, close } = await connect(client, {
      toolset: 'file',
      allowedRoot: root,
    });
    try {
      const tools = await mcpClient.listTools();
      const names = tools.tools.map((t) => t.name).sort();
      expect(names).toEqual(['list_uploaded_files', 'upload_file']);
      expect(tools.tools).toHaveLength(2);
    } finally {
      await close();
    }
  });

  it('FILE_MCP_SERVER_NAME = sillyhub-file（mcp-server 与 mcp-config 单一取值）', () => {
    expect(FILE_MCP_SERVER_NAME).toBe('sillyhub-file');
    expect(FILE_MCP_SERVER_NAME_CFG).toBe(FILE_MCP_SERVER_NAME);
    expect(DAEMON_MCP_SERVER_NAME).toBe('sillyhub-daemon');
  });

  it('readEnv：MCP_TOOLSET/RUN_ID/ALLOWED_ROOT 读入；未设 → orchestration + 空串', () => {
    const prev = {
      MCP_TOOLSET: process.env.MCP_TOOLSET,
      MCP_RUN_ID: process.env.MCP_RUN_ID,
      MCP_ALLOWED_ROOT: process.env.MCP_ALLOWED_ROOT,
    };
    try {
      // 未设 → orchestration 缺省（容错，不 crash）
      delete process.env.MCP_TOOLSET;
      delete process.env.MCP_RUN_ID;
      delete process.env.MCP_ALLOWED_ROOT;
      const dft = readEnv();
      expect(dft.toolset).toBe('orchestration');
      expect(dft.runId).toBe('');
      expect(dft.allowedRoot).toBe('');

      // 拼写错误 → 回落 orchestration（fail-safe 到既有 5 工具）
      process.env.MCP_TOOLSET = 'files';
      expect(readEnv().toolset).toBe('orchestration');

      // 显式 file + 上下文
      process.env.MCP_TOOLSET = 'file';
      process.env.MCP_RUN_ID = 'run-env-1';
      process.env.MCP_ALLOWED_ROOT = 'C:\\some\\root';
      const fileEnv = readEnv();
      expect(fileEnv.toolset).toBe('file');
      expect(fileEnv.runId).toBe('run-env-1');
      expect(fileEnv.allowedRoot).toBe('C:\\some\\root');
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

// ── 2. upload_file 路径逃逸（R-01 fail-closed）────────────────────────────────

describe('mcp-server-file: upload_file 路径逃逸拒绝', () => {
  /** 逃逸用例断言：isError + error=path_out_of_root，且不触 hub-client 上传。 */
  async function expectOutOfRoot(
    opts: CreateMcpServerOptions,
    path: string,
  ): Promise<void> {
    const client = new HubClient('http://mock', 'mock-token');
    const upload = vi
      .spyOn(client, 'uploadFileArtifact')
      .mockResolvedValue({
        file_id: 'never',
        original_name: 'never',
        mime_type: '',
        size: 0,
        description: null,
      });
    const { mcpClient, close } = await connect(client, { toolset: 'file', ...opts });
    try {
      const result = await mcpClient.callTool({
        name: 'upload_file',
        arguments: { path },
      });
      expect(result.isError).toBe(true);
      const err = parseReceipt(result) as { error: string; tool: string };
      expect(err.error).toBe('path_out_of_root');
      expect(err.tool).toBe('upload_file');
      expect(upload).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  }

  it('MCP_ALLOWED_ROOT 缺失 → 拒绝一切上传（fail-closed，不降级放行）', async () => {
    await expectOutOfRoot({}, 'report.md');
  });

  it('allowedRoot 空串 → 同缺失处理（fail-closed）', async () => {
    await expectOutOfRoot({ allowedRoot: '' }, 'report.md');
  });

  it('绝对路径（根外真实文件）→ path_out_of_root', async () => {
    // 根外文件（tmpdir 兄弟目录，跨平台绝对路径）
    const outside = await mkdtemp(join(tmpdir(), 'mcp-file-outside-'));
    try {
      await writeFile(join(outside, 'secret.txt'), 'outside');
      await expectOutOfRoot(
        { allowedRoot: root },
        join(outside, 'secret.txt'),
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('含 .. 出根（../file）→ path_out_of_root', async () => {
    await expectOutOfRoot({ allowedRoot: root }, '../escape.txt');
  });

  it('子目录内 ../.. 变体出根 → path_out_of_root', async () => {
    await mkdir(join(root, 'sub'), { recursive: true });
    await expectOutOfRoot({ allowedRoot: root }, 'sub/../../escape.txt');
  });

  it('path="."（根自身，目录非文件）→ path_out_of_root', async () => {
    await expectOutOfRoot({ allowedRoot: root }, '.');
  });

  it('根内合法相对路径但文件不存在 → file_not_found（非 path 错误）', async () => {
    const client = new HubClient('http://mock', 'mock-token');
    const { mcpClient, close } = await connect(client, {
      toolset: 'file',
      allowedRoot: root,
    });
    try {
      const result = await mcpClient.callTool({
        name: 'upload_file',
        arguments: { path: 'not-exist.md' },
      });
      expect(result.isError).toBe(true);
      const err = parseReceipt(result) as { error: string };
      expect(err.error).toBe('file_not_found');
    } finally {
      await close();
    }
  });
});

// ── 3. upload_file 成功路径：转发参数 + 输出契约（mock hub-client）────────────

describe('mcp-server-file: upload_file 转发与输出', () => {
  it('worker 场景：根内文件 → uploadFileArtifact({filename,data,mimeType,description,runId})，输出含 file_id 五字段', async () => {
    await writeFile(join(root, 'report.md'), '# hello 中文内容');
    const client = new HubClient('http://mock', 'mock-token');
    const upload = vi.spyOn(client, 'uploadFileArtifact').mockResolvedValue({
      file_id: 'file-1',
      original_name: 'report.md',
      mime_type: 'text/markdown',
      size: 15,
      description: '实验报告',
    });
    const { mcpClient, close } = await connect(client, {
      toolset: 'file',
      allowedRoot: root,
      runId: 'run-1',
    });
    try {
      const result = await mcpClient.callTool({
        name: 'upload_file',
        arguments: { path: 'report.md', description: '实验报告' },
      });
      expect(result.isError).toBeFalsy();
      // 转发参数：原始名（basename）/ 文件字节 / 扩展名 mime / 描述 / run 上下文
      expect(upload).toHaveBeenCalledTimes(1);
      const arg = upload.mock.calls[0]?.[0];
      expect(arg?.filename).toBe('report.md');
      expect(arg?.mimeType).toBe('text/markdown');
      expect(arg?.description).toBe('实验报告');
      expect(arg?.runId).toBe('run-1');
      expect(Buffer.from(arg?.data ?? []).toString('utf-8')).toBe('# hello 中文内容');
      // 输出契约（design §7.1 / task-03）：file_id 口径 + 四元数据
      const receipt = parseReceipt(result) as Record<string, unknown>;
      expect(receipt).toEqual({
        file_id: 'file-1',
        original_name: 'report.md',
        mime_type: 'text/markdown',
        size: 15,
        description: '实验报告',
      });
    } finally {
      await close();
    }
  });

  it('会话场景：runId 缺省 → runId=undefined 透传（backend 走 X-Session-Id）', async () => {
    await writeFile(join(root, 'chart.png'), 'pngbytes');
    const client = new HubClient('http://mock', 'mock-token');
    const upload = vi.spyOn(client, 'uploadFileArtifact').mockResolvedValue({
      file_id: 'file-2',
      original_name: 'chart.png',
      mime_type: 'image/png',
      size: 8,
      description: null,
    });
    const { mcpClient, close } = await connect(client, {
      toolset: 'file',
      allowedRoot: root,
      sessionId: 'sess-1',
    });
    try {
      const result = await mcpClient.callTool({
        name: 'upload_file',
        arguments: { path: 'chart.png' },
      });
      expect(result.isError).toBeFalsy();
      const arg = upload.mock.calls[0]?.[0];
      expect(arg?.runId).toBeUndefined();
      // description 未传 → undefined（hub-client 不 append，backend 默认 ""）
      expect(arg?.description).toBeUndefined();
      // 图片扩展名 → image/png（前端缩略图卡片依赖）
      expect(arg?.mimeType).toBe('image/png');
    } finally {
      await close();
    }
  });

  it('子目录内文件 → 相对路径可用（path 校验只拒越界，不拒嵌套）', async () => {
    await mkdir(join(root, 'out'), { recursive: true });
    await writeFile(join(root, 'out', 'data.csv'), 'a,b\n1,2\n');
    const client = new HubClient('http://mock', 'mock-token');
    const upload = vi.spyOn(client, 'uploadFileArtifact').mockResolvedValue({
      file_id: 'file-3',
      original_name: 'data.csv',
      mime_type: 'text/csv',
      size: 8,
      description: null,
    });
    const { mcpClient, close } = await connect(client, {
      toolset: 'file',
      allowedRoot: root,
    });
    try {
      const result = await mcpClient.callTool({
        name: 'upload_file',
        arguments: { path: 'out/data.csv' },
      });
      expect(result.isError).toBeFalsy();
      expect(upload.mock.calls[0]?.[0]?.filename).toBe('data.csv');
    } finally {
      await close();
    }
  });

  it('backend 413（超文件上限）→ errorContent 归 http + status（不 crash）', async () => {
    await writeFile(join(root, 'big.bin'), 'x'.repeat(16));
    const client = new HubClient('http://mock', 'mock-token');
    vi.spyOn(client, 'uploadFileArtifact').mockImplementation(async () => {
      throw new HubHttpError(413, '{"detail":"file too large"}', 'http://x/api/agent/file-artifacts', 'POST');
    });
    const { mcpClient, close } = await connect(client, {
      toolset: 'file',
      allowedRoot: root,
    });
    try {
      const result = await mcpClient.callTool({
        name: 'upload_file',
        arguments: { path: 'big.bin' },
      });
      expect(result.isError).toBe(true);
      const err = parseReceipt(result) as { error: string; status: number };
      expect(err.error).toBe('http');
      expect(err.status).toBe(413);
    } finally {
      await close();
    }
  });
});

// ── 4. list_uploaded_files：上下文选择 + 输出字段映射 ──────────────────────────

describe('mcp-server-file: list_uploaded_files', () => {
  const listResult = {
    files: [
      {
        file_id: 'file-9',
        original_name: 'report.md',
        mime_type: 'text/markdown',
        size: 15,
        description: '实验报告',
        created_at: '2026-08-23T02:00:00Z',
      },
    ],
  };

  it('会话上下文 → listFileArtifacts({sessionId})，输出 files[] 含 task-03 契约字段', async () => {
    const client = new HubClient('http://mock', 'mock-token');
    const list = vi.spyOn(client, 'listFileArtifacts').mockResolvedValue(listResult);
    const { mcpClient, close } = await connect(client, {
      toolset: 'file',
      sessionId: 'sess-1',
    });
    try {
      const result = await mcpClient.callTool({
        name: 'list_uploaded_files',
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      expect(list).toHaveBeenCalledWith({ sessionId: 'sess-1' });
      const receipt = parseReceipt(result) as { files: Record<string, unknown>[] };
      expect(receipt.files).toHaveLength(1);
      expect(receipt.files[0]).toEqual({
        file_id: 'file-9',
        original_name: 'report.md',
        mime_type: 'text/markdown',
        size: 15,
        description: '实验报告',
        created_at: '2026-08-23T02:00:00Z',
      });
    } finally {
      await close();
    }
  });

  it('worker 上下文（runId）→ listFileArtifacts({runId})', async () => {
    const client = new HubClient('http://mock', 'mock-token');
    const list = vi.spyOn(client, 'listFileArtifacts').mockResolvedValue({ files: [] });
    const { mcpClient, close } = await connect(client, {
      toolset: 'file',
      runId: 'run-1',
    });
    try {
      const result = await mcpClient.callTool({
        name: 'list_uploaded_files',
        arguments: {},
      });
      expect(result.isError).toBeFalsy();
      expect(list).toHaveBeenCalledWith({ runId: 'run-1' });
      expect(parseReceipt(result)).toEqual({ files: [] });
    } finally {
      await close();
    }
  });

  it('sessionId/runId 均缺 → missing_context 结构化错误（不发请求）', async () => {
    const client = new HubClient('http://mock', 'mock-token');
    const list = vi.spyOn(client, 'listFileArtifacts').mockResolvedValue({ files: [] });
    const { mcpClient, close } = await connect(client, { toolset: 'file' });
    try {
      const result = await mcpClient.callTool({
        name: 'list_uploaded_files',
        arguments: {},
      });
      expect(result.isError).toBe(true);
      const err = parseReceipt(result) as { error: string; tool: string };
      expect(err.error).toBe('missing_context');
      expect(err.tool).toBe('list_uploaded_files');
      expect(list).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});

// ── 5. hub-client uploadFileArtifact：multipart 直传（fetch mock）──────────────

describe('hub-client: uploadFileArtifact multipart 直传', () => {
  it('FormData 字段（file/description/run_id）+ 鉴权/会话头，无手工 Content-Type；id → file_id 映射', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'uuid-1',
          original_name: 'report.md',
          mime_type: 'text/markdown',
          size: 5,
          description: 'd1',
        }),
        { status: 201 },
      ),
    );
    const client = new HubClient('http://hub:8000', {
      apiKey: 'key-1',
      sessionId: 'sess-1',
    });
    const result = await client.uploadFileArtifact({
      filename: 'report.md',
      data: new TextEncoder().encode('hello'),
      mimeType: 'text/markdown',
      description: 'd1',
      runId: 'run-1',
    });
    // 端点 + 方法
    const call = spy.mock.calls[0];
    expect(String(call?.[0])).toBe('http://hub:8000/api/agent/file-artifacts');
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    // 头：鉴权（apiKey 优先）+ 会话上下文；**不设手工 Content-Type**（boundary
    // 由 fetch 生成，手工 application/json 会破坏 multipart）
    const headers = init.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('key-1');
    expect(headers[X_SESSION_ID_HEADER]).toBe('sess-1');
    expect(headers['Content-Type']).toBeUndefined();
    // FormData 字段：file part（filename/mime/字节）+ description + run_id
    const form = init.body as FormData;
    const file = form.get('file') as File;
    expect(file).not.toBeNull();
    expect(file.name).toBe('report.md');
    expect(file.type).toBe('text/markdown');
    expect(await file.text()).toBe('hello');
    expect(form.get('description')).toBe('d1');
    expect(form.get('run_id')).toBe('run-1');
    // 响应映射：backend id → agent 口径 file_id
    expect(result).toEqual({
      file_id: 'uuid-1',
      original_name: 'report.md',
      mime_type: 'text/markdown',
      size: 5,
      description: 'd1',
    });
  });

  it('token 回落（无 apiKey）→ Authorization Bearer；description/runId 缺省不 append', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'uuid-2',
          original_name: 'a.png',
          mime_type: 'image/png',
          size: 2,
          description: null,
        }),
        { status: 201 },
      ),
    );
    const client = new HubClient('http://hub:8000', { token: 'jwt-1' });
    const result = await client.uploadFileArtifact({
      filename: 'a.png',
      data: new Uint8Array([1, 2]),
      mimeType: 'image/png',
    });
    const init = spy.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer jwt-1');
    expect(headers['X-API-Key']).toBeUndefined();
    expect(headers[X_SESSION_ID_HEADER]).toBeUndefined();
    const form = init.body as FormData;
    expect(form.get('description')).toBeNull();
    expect(form.get('run_id')).toBeNull();
    expect(result.description).toBeNull();
    expect(result.file_id).toBe('uuid-2');
  });

  it('非 2xx → HubHttpError（status/bodyText 透传）', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"detail":"too large"}', { status: 413 }),
    );
    const client = new HubClient('http://hub:8000', { apiKey: 'key-1' });
    await expect(
      client.uploadFileArtifact({
        filename: 'big.bin',
        data: new Uint8Array([0]),
      }),
    ).rejects.toMatchObject({
      name: 'HubHttpError',
      status: 413,
      bodyText: '{"detail":"too large"}',
    });
  });
});

describe('hub-client: listFileArtifacts query 与映射', () => {
  it('sessionId → GET ?session_id=...；files[].id → file_id（含 created_at）', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          files: [
            {
              id: 'uuid-a',
              original_name: 'r.md',
              mime_type: 'text/markdown',
              size: 3,
              description: null,
              created_at: '2026-08-23T01:00:00Z',
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const client = new HubClient('http://hub:8000', { apiKey: 'key-1' });
    const result = await client.listFileArtifacts({ sessionId: 'sess-9' });
    const call = spy.mock.calls[0];
    expect(String(call?.[0])).toBe(
      'http://hub:8000/api/agent/file-artifacts?session_id=sess-9',
    );
    expect((call?.[1] as RequestInit).method).toBe('GET');
    expect(result.files[0]).toEqual({
      file_id: 'uuid-a',
      original_name: 'r.md',
      mime_type: 'text/markdown',
      size: 3,
      description: null,
      created_at: '2026-08-23T01:00:00Z',
    });
  });

  it('runId → GET ?run_id=...（worker 场景）', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ files: [] }), { status: 200 }),
    );
    const client = new HubClient('http://hub:8000', { token: 'jwt-1' });
    const result = await client.listFileArtifacts({ runId: 'run-9' });
    expect(String(spy.mock.calls[0]?.[0])).toBe(
      'http://hub:8000/api/agent/file-artifacts?run_id=run-9',
    );
    expect(result).toEqual({ files: [] });
  });
});

// ── 6. mcp-config buildFileMcpServerConfig ────────────────────────────────────

describe('mcp-config: buildFileMcpServerConfig', () => {
  it('env 含 MCP_TOOLSET=file + 鉴权 + 上下文三键（allowedRoot resolve 绝对路径）', () => {
    const cfg = buildFileMcpServerConfig(
      'http://hub:8000/',
      { apiKey: 'key-1', token: 'jwt-1' },
      { sessionId: 'sess-1', runId: 'run-1', allowedRoot: join(root, 'worktree') },
      '/dist-test/mcp-server.js',
    );
    expect(cfg.command).toBe('node');
    expect(cfg.args).toEqual(['/dist-test/mcp-server.js']);
    expect(cfg.env).toEqual({
      MCP_SERVER_BACKEND_URL: 'http://hub:8000',
      [MCP_TOOLSET_ENV]: 'file',
      MCP_SERVER_DAEMON_TOKEN: 'jwt-1',
      MCP_SERVER_DAEMON_API_KEY: 'key-1',
      MCP_SESSION_ID: 'sess-1',
      [MCP_RUN_ID_ENV]: 'run-1',
      // resolve 归一：join 出的绝对路径原样（同进程 cwd 下无变化），分隔符平台化
      [MCP_ALLOWED_ROOT_ENV]: join(root, 'worktree'),
    });
  });

  it('空上下文/空凭证 → 守卫不写键（仅 BACKEND_URL + TOOLSET 两个必有键）', () => {
    const cfg = buildFileMcpServerConfig('http://hub:8000', {}, {}, '/x/mcp-server.js');
    expect(cfg.env).toEqual({
      MCP_SERVER_BACKEND_URL: 'http://hub:8000',
      [MCP_TOOLSET_ENV]: 'file',
    });
  });

  it('相对 allowedRoot → resolve 成绝对路径（跨平台）', () => {
    const cfg = buildFileMcpServerConfig(
      'http://hub:8000',
      { token: 't' },
      { allowedRoot: 'relative/dir' },
      '/x/mcp-server.js',
    );
    // resolve(相对路径) = process.cwd() 拼接（跨平台分隔符由 node:path 处理）
    expect(cfg.env?.[MCP_ALLOWED_ROOT_ENV]).toBe(
      join(process.cwd(), 'relative', 'dir'),
    );
  });

  it('sillyhub-file 并入 platform_default（首个配置）→ mergeMcpConfigs 自动入白名单（同 sillyhub-daemon 惯例）', () => {
    const platform: McpConfig = {
      mcpServers: {
        [FILE_MCP_SERVER_NAME]: buildFileMcpServerConfig(
          'http://hub:8000',
          { token: 't' },
          { sessionId: 's' },
          '/x/mcp-server.js',
        ),
      },
    };
    const result = mergeMcpConfigs([], platform);
    expect(result.config.mcpServers[FILE_MCP_SERVER_NAME]).toBeDefined();
    expect(result.rejected).toHaveLength(0);
  });
});
