/**
 * task-12：lib/api/llm-providers 单测。
 *
 * 覆盖：
 *   1. 五个 API 方法签名（method + path）与后端 router 一一对应。
 *   2. formToCreate：表单值 → POST body 映射（角色映射嵌套 / extra_env 键值对）。
 *   3. formToUpdate：api_key 留空 → **不出现在 PATCH body**（铁律）；有值则携带。
 *   4. cleanRoleMappings：丢弃空行、one_m 仅随 model 携带。
 *   5. cleanExtraEnv：丢弃空键、保留空值。
 *
 * fetch harness 仿 lib/workspaces.test.ts（apiFetch 内部走 fetch）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanExtraEnv,
  cleanRoleMappings,
  createProvider,
  deleteProvider,
  formToCreate,
  formToUpdate,
  listProviders,
  setDefaultProvider,
  unsetDefaultProvider,
  updateProvider,
  type LlmProviderFormValues,
} from "@/lib/api/llm-providers";

// ── fetch harness ────────────────────────────────────────────────────────

function mockFetch(resp: { status: number; body: unknown }) {
  const fetchMock = vi.fn();
  const bodyStr = JSON.stringify(resp.body);
  let lastUrl = "";
  let lastInit: RequestInit | undefined;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    lastUrl = url;
    lastInit = init;
    const headers = new Headers({ "content-type": "application/json" });
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      statusText: resp.status === 200 ? "OK" : "Error",
      headers,
      text: async () => bodyStr,
      json: async () => resp.body,
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    lastUrl: () => lastUrl,
    lastMethod: (): string | undefined => lastInit?.method,
    lastBody: (): Record<string, unknown> | null => {
      if (!lastInit?.body) return null;
      try {
        return JSON.parse(lastInit.body as string) as Record<string, unknown>;
      } catch {
        return null;
      }
    },
  };
}

const READ = {
  id: "p-1",
  user_id: "u-1",
  name: "Kimi 中转",
  agent_kind: "claude",
  base_url: "https://api.moonshot.cn/anthropic",
  model: null,
  notes: null,
  website_url: null,
  auth_field: "ANTHROPIC_AUTH_TOKEN",
  model_role_mappings: null,
  default_fallback_model: "kimi-k2",
  extra_env: null,
  is_default: false,
  api_key_masked: "sk-1...abcd",
  created_at: "2026-07-25T10:00:00Z",
  updated_at: "2026-07-25T10:00:00Z",
};

const FORM_VALUES: LlmProviderFormValues = {
  name: "Kimi 中转",
  agent_kind: "claude",
  base_url: "https://api.moonshot.cn/anthropic",
  api_key: "sk-secret-1234",
  auth_field: "ANTHROPIC_AUTH_TOKEN",
  notes: "公司专用",
  website_url: "https://moonshot.cn",
  model_role_mappings: {
    sonnet: { display: "Kimi K2", model: "kimi-k2", one_m: false },
    opus: { display: "", model: "deepseek-v4-pro", one_m: true },
    fable: { display: "", model: "", one_m: false }, // 空行，应被清洗丢弃
    haiku: { display: "", model: "kimi-k2", one_m: false },
  },
  default_fallback_model: "kimi-k2",
  extra_env: {
    API_TIMEOUT_MS: "3000000",
    "": "should-drop", // 空键丢弃
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  },
  is_default: true,
};

describe("llm-providers API — method + path", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listProviders → GET /api/llm-providers，返回 items 数组", async () => {
    const h = mockFetch({ status: 200, body: { items: [READ], total: 1 } });
    const items = await listProviders();
    // GET 请求 apiFetch 不显式设 method（fetch 默认 GET → init.method undefined）
    expect(h.lastMethod() ?? "GET").toBe("GET");
    expect(h.lastUrl()).toContain("/api/llm-providers");
    expect(h.lastUrl()).not.toContain("/api/llm-providers/");
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe("p-1");
  });

  it("createProvider → POST /api/llm-providers + body", async () => {
    const h = mockFetch({ status: 201, body: READ });
    await createProvider({
      name: "Kimi 中转",
      agent_kind: "claude",
      auth_field: "ANTHROPIC_AUTH_TOKEN",
      is_default: true,
    });
    expect(h.lastMethod()).toBe("POST");
    expect(h.lastUrl()).toContain("/api/llm-providers");
    expect(h.lastUrl()).not.toContain("/set-default");
    const body = h.lastBody();
    expect(body).not.toBeNull();
    expect(body!.name).toBe("Kimi 中转");
  });

  it("updateProvider → PATCH /api/llm-providers/{id} + body", async () => {
    const h = mockFetch({ status: 200, body: READ });
    await updateProvider("p-1", { name: "renamed" });
    expect(h.lastMethod()).toBe("PATCH");
    expect(h.lastUrl()).toContain("/api/llm-providers/p-1");
    const body = h.lastBody();
    expect(body!.name).toBe("renamed");
  });

  it("deleteProvider → DELETE /api/llm-providers/{id}", async () => {
    const h = mockFetch({ status: 204, body: null });
    await deleteProvider("p-1");
    expect(h.lastMethod()).toBe("DELETE");
    expect(h.lastUrl()).toContain("/api/llm-providers/p-1");
  });

  it("setDefaultProvider → POST /api/llm-providers/{id}/set-default（无 body）返回 SetDefaultResult", async () => {
    // task-09：返回体由 LlmProviderRead 改为 SetDefaultResult（switched/affected_sessions/error）
    const h = mockFetch({
      status: 200,
      body: { switched: true, affected_sessions: 2, error: null },
    });
    const result = await setDefaultProvider("p-1");
    expect(h.lastMethod()).toBe("POST");
    expect(h.lastUrl()).toContain("/api/llm-providers/p-1/set-default");
    expect(h.lastBody()).toBeNull();
    expect(result.switched).toBe(true);
    expect(result.affected_sessions).toBe(2);
    expect(result.error).toBeNull();
  });

  it("unsetDefaultProvider → POST /api/llm-providers/{id}/unset-default（无 body）返回 SetDefaultResult", async () => {
    const h = mockFetch({
      status: 200,
      body: { switched: true, affected_sessions: 0, error: null },
    });
    const result = await unsetDefaultProvider("p-1");
    expect(h.lastMethod()).toBe("POST");
    expect(h.lastUrl()).toContain("/api/llm-providers/p-1/unset-default");
    expect(h.lastBody()).toBeNull();
    expect(result.switched).toBe(true);
    expect(result.affected_sessions).toBe(0);
    expect(result.error).toBeNull();
  });

  it("id 含特殊字符走 encodeURIComponent（不破坏路径）", async () => {
    const h = mockFetch({ status: 204, body: null });
    await deleteProvider("p 1/2");
    expect(h.lastUrl()).toContain("/api/llm-providers/p%201%2F2");
  });
});

describe("formToCreate — 表单值 → POST body 映射", () => {
  it("角色映射嵌套结构保留（清洗空行）、extra_env 键值对、api_key 透传", () => {
    const body = formToCreate(FORM_VALUES);
    expect(body.name).toBe("Kimi 中转");
    expect(body.agent_kind).toBe("claude");
    expect(body.api_key).toBe("sk-secret-1234");
    expect(body.auth_field).toBe("ANTHROPIC_AUTH_TOKEN");
    expect(body.default_fallback_model).toBe("kimi-k2");
    expect(body.is_default).toBe(true);

    // 角色映射：fable 空行被丢弃，sonnet/opus/haiku 保留
    const m = body.model_role_mappings;
    expect(m).not.toBeNull();
    expect(Object.keys(m!).sort()).toEqual(["haiku", "opus", "sonnet"]);
    expect(m!.sonnet).toEqual({ display: "Kimi K2", model: "kimi-k2", one_m: false });
    // opus 有 model 且 one_m=true → one_m 随 model 携带
    expect(m!.opus).toEqual({ model: "deepseek-v4-pro", one_m: true });
    expect(m!.haiku).toEqual({ model: "kimi-k2", one_m: false });

    // extra_env：空键丢弃，其余保留
    expect(body.extra_env).toEqual({
      API_TIMEOUT_MS: "3000000",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    });
  });

  it("全部高级项为空时 model_role_mappings/extra_env 落 null", () => {
    const body = formToCreate({
      ...FORM_VALUES,
      model_role_mappings: {
        sonnet: { display: "", model: "", one_m: false },
        opus: { display: "", model: "", one_m: false },
        fable: { display: "", model: "", one_m: false },
        haiku: { display: "", model: "", one_m: false },
      },
      extra_env: {},
      default_fallback_model: "",
      api_key: "sk-x",
    });
    expect(body.model_role_mappings).toBeNull();
    expect(body.extra_env).toBeNull();
    expect(body.default_fallback_model).toBeNull();
    expect(body.api_key).toBe("sk-x");
  });
});

describe("formToUpdate — api_key 留空不出现在 PATCH body（铁律）", () => {
  it("api_key 留空（空串）→ body 不含 api_key 键", () => {
    const body = formToUpdate({ ...FORM_VALUES, api_key: "" });
    expect(body).not.toHaveProperty("api_key");
    // 其余字段仍正常透传
    expect(body.name).toBe("Kimi 中转");
    expect(body.auth_field).toBe("ANTHROPIC_AUTH_TOKEN");
    expect(body.is_default).toBe(true);
  });

  it("api_key 全空白 → 同样不含 api_key 键", () => {
    const body = formToUpdate({ ...FORM_VALUES, api_key: "   " });
    expect(body).not.toHaveProperty("api_key");
  });

  it("api_key 有值 → 携带到 body（用于轮换密钥）", () => {
    const body = formToUpdate({ ...FORM_VALUES, api_key: "sk-new-4567" });
    expect(body.api_key).toBe("sk-new-4567");
  });

  it("角色映射与 extra_env 同样走清洗", () => {
    const body = formToUpdate(FORM_VALUES);
    expect(body.model_role_mappings).not.toBeNull();
    expect(body.model_role_mappings!.opus).toEqual({
      model: "deepseek-v4-pro",
      one_m: true,
    });
    expect(body.extra_env).toEqual({
      API_TIMEOUT_MS: "3000000",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    });
  });
});

describe("cleanRoleMappings — 边界", () => {
  it("null/undefined → null", () => {
    expect(cleanRoleMappings(null)).toBeNull();
    expect(cleanRoleMappings(undefined)).toBeNull();
  });

  it("仅 display 无 model → 保留 display，不带 one_m", () => {
    const out = cleanRoleMappings({
      sonnet: { display: "展示名", model: "", one_m: true },
    });
    expect(out).toEqual({ sonnet: { display: "展示名" } });
  });

  it("one_m 仅在 model 有值时携带", () => {
    const out = cleanRoleMappings({
      opus: { model: "opus-4", one_m: true },
      haiku: { display: "", model: "", one_m: true }, // 无 model → 整行丢弃
    });
    expect(out).toEqual({ opus: { model: "opus-4", one_m: true } });
  });
});

describe("cleanExtraEnv — 边界", () => {
  it("null/undefined → null", () => {
    expect(cleanExtraEnv(null)).toBeNull();
    expect(cleanExtraEnv(undefined)).toBeNull();
  });

  it("空键丢弃、值保留（含空值）", () => {
    const out = cleanExtraEnv({
      KEY_EMPTY_VAL: "",
      "": "dropped",
      A: "1",
    });
    expect(out).toEqual({ KEY_EMPTY_VAL: "", A: "1" });
  });

  it("键前后空白被 trim", () => {
    const out = cleanExtraEnv({ "  SPACED  ": "v" });
    expect(out).toEqual({ SPACED: "v" });
  });
});
