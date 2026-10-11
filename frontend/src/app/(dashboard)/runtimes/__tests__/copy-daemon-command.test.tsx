/**
 * 2026-10-11-apikey-mcp-copy-delete：CopyDaemonCommand 复制命令内嵌真实密钥测试。
 *
 * 依据:
 *   - frontend/src/app/(dashboard)/runtimes/page.tsx（CopyDaemonCommand）
 *   - 变更 FR-01：复制命令内嵌最新活跃 key 明文；无活跃 key 自动创建永不过期
 *     key；非 admin 回退 access_token；渲染面保持打码
 *
 * 覆盖:
 *   1. admin + 活跃 key：点「复制命令」→ 剪贴板命令含 --api-key <完整明文>，
 *      渲染面只显示打码前缀（明文不进 DOM）
 *   2. admin + 无 key：显示自动创建提示；复制后回显已自动创建（含名称）
 *   3. 非 admin（list 403）：渲染 --token 回退形态 + 黄色警示；复制走 access_token
 *   4. resolveDaemonApiKey 返回 forbidden → 命令回退 --token
 *
 * session store 直接 useSession.setState（zustand 原生 API）；lib 层 vi.mock
 * 拦截动态 import；clipboard mock 对齐 install-daemon-os.test.tsx 惯例。
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CopyDaemonCommand } from "@/app/(dashboard)/runtimes/page";
import { useSession } from "@/stores/session";

const apiKeysLib = vi.hoisted(() => ({
  getLatestActiveApiKey: vi.fn(),
  resolveDaemonApiKey: vi.fn(),
}));

vi.mock("@/lib/api-keys", () => apiKeysLib);

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  apiKeysLib.getLatestActiveApiKey.mockReset();
  apiKeysLib.resolveDaemonApiKey.mockReset();
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  useSession.setState({ accessToken: "jwt-short-lived" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CopyDaemonCommand · admin 有活跃 key（FR-01 主路径）", () => {
  it("复制 → 剪贴板命令内嵌完整明文；渲染面保持打码", async () => {
    apiKeysLib.getLatestActiveApiKey.mockResolvedValueOnce({
      id: "k1",
      key_prefix: "shk_live_ab",
      plaintext_recoverable: true,
    });
    apiKeysLib.resolveDaemonApiKey.mockResolvedValueOnce({
      status: "ok",
      plaintext: "shk_live_full_secret_value",
      keyPrefix: "shk_live_ab",
    });

    render(<CopyDaemonCommand />);
    // 预取完成后渲染 --api-key 打码形态
    await waitFor(() => {
      expect(screen.getByText(/--api-key/)).toBeInTheDocument();
    });
    expect(screen.getByText(/shk_live_ab…/)).toBeInTheDocument();
    // 明文绝不进 DOM
    expect(document.body.textContent).not.toContain("shk_live_full_secret_value");

    fireEvent.click(screen.getByRole("button", { name: /复制命令/ }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    const cmd = writeText.mock.calls[0]?.[0] as string;
    expect(cmd).toContain("--api-key shk_live_full_secret_value");
    expect(cmd).toContain(window.location.origin);
    expect(apiKeysLib.resolveDaemonApiKey).toHaveBeenCalledTimes(1);
    // 成功回显
    await waitFor(() => {
      expect(screen.getByText("已复制")).toBeInTheDocument();
    });
  });
});

describe("CopyDaemonCommand · admin 无活跃 key（自动创建）", () => {
  it("渲染提示自动创建；复制后回显已自动创建 + 命令内嵌新密钥", async () => {
    apiKeysLib.getLatestActiveApiKey.mockResolvedValueOnce(null);
    apiKeysLib.resolveDaemonApiKey.mockResolvedValueOnce({
      status: "ok",
      plaintext: "shk_live_auto_created",
      keyPrefix: "shk_live_au",
      createdName: "守护进程启动命令自动签发 2026-10-11",
    });

    render(<CopyDaemonCommand />);
    await waitFor(() => {
      expect(screen.getByText(/复制时会自动创建一个永不过期的新密钥/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /复制命令/ }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect((writeText.mock.calls[0]?.[0] as string)).toContain(
      "--api-key shk_live_auto_created",
    );
    await waitFor(() => {
      expect(screen.getByText(/已自动创建 API 密钥「守护进程启动命令自动签发/)).toBeInTheDocument();
    });
  });
});

describe("CopyDaemonCommand · 非 admin 回退 access_token", () => {
  it("list 失败 → 渲染 --token 形态 + 黄色警示；复制命令用 access_token", async () => {
    apiKeysLib.getLatestActiveApiKey.mockRejectedValueOnce(new Error("403"));

    render(<CopyDaemonCommand />);
    await waitFor(() => {
      expect(screen.getAllByText(/--token/).length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByText(/access_token（15 分钟过期）/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /复制命令/ }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect((writeText.mock.calls[0]?.[0] as string)).toContain("--token jwt-short-lived");
    // 非 admin 不触发明文解析
    expect(apiKeysLib.resolveDaemonApiKey).not.toHaveBeenCalled();
  });

  it("复制时权限被收回（resolve 返回 forbidden）→ 命令回退 --token 不报错", async () => {
    apiKeysLib.getLatestActiveApiKey.mockResolvedValueOnce({
      id: "k1",
      key_prefix: "shk_live_ab",
      plaintext_recoverable: true,
    });
    apiKeysLib.resolveDaemonApiKey.mockResolvedValueOnce({ status: "forbidden" });

    render(<CopyDaemonCommand />);
    await waitFor(() => {
      expect(screen.getByText(/--api-key/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /复制命令/ }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect((writeText.mock.calls[0]?.[0] as string)).toContain("--token jwt-short-lived");
    expect(screen.getByText("已复制")).toBeInTheDocument();
  });
});
