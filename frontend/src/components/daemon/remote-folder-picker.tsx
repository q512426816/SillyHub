"use client";

/**
 * RemoteFolderPicker · 远程目录浏览器（task-08 / FR-3 / D-003 / D-004）。
 *
 * 基于 daemon 的 list_roots + list_dir RPC，在 Web 端呈现类似 Windows 资源管理器的
 * 目录树，替换旧的系统原生弹窗（browse_folder，远程 daemon 时 Web 用户看不到弹窗）。
 *
 * 组件自治：调用方只需传入 runtimeId + 受控 open/onClose/onPick，树状态由组件内部自管。
 *
 * 交互（参考 prototype-remote-folder-picker.html）：
 *   - open→listRoots 初始化根节点（Win 盘符 / Unix `/`）。
 *   - antd Tree loadData 懒加载：展开节点调 listDir，只显示 type==="dir" 的子项。
 *   - 地址栏手输路径 + 「跳转」：跳转前探 listDir 校验，not_found/失败 → 红条提示 + 禁用确认。
 *   - 选中节点 → 更新 selectedPath + 地址栏；「选择此目录」→ onPick(path) + 关闭。
 *   - 错误降级：listRoots/listDir 抛错（离线/超时/无权限）→ 红条提示，不崩溃；地址栏仍可输入。
 *
 * 视觉（NFR-3）：antd Modal/Tree（业务组件）+ shadcn Input/Button（视觉组件），走项目 token。
 * 文案（NFR-4）：中文。
 *
 * 依据：design §7.3 + 原型 prototype-remote-folder-picker.html。
 */

import { useCallback, useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { Modal, Spin, Tree, type TreeProps } from "antd";
import type { DataNode } from "antd/es/tree";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { listDir, listRoots } from "@/lib/daemon";

export interface RemoteFolderPickerProps {
  /** daemon 运行时 ID（listRoots/listDir 的目标）。 */
  runtimeId: string;
  /** 受控：是否打开。 */
  open: boolean;
  /** 关闭回调（点取消 / 遮罩 / ESC）。 */
  onClose: () => void;
  /** 选中目录后回调，传入完整路径。 */
  onPick: (path: string) => void; // eslint-disable-line no-unused-vars -- props 回调签名形参
  /** Modal 标题，默认「选择目录」。 */
  title?: string;
  /** 确认按钮文案，默认「选择此目录」。 */
  confirmText?: string;
  /** 打开时定位的初始路径（调用方传当前输入框值，非空则打开时回填地址栏 + 探 listDir 校验选中）。 */
  initialPath?: string;
}

/** 递归更新树数据（antd Tree loadData 模式需要）。 */
function updateTreeData(
  list: DataNode[],
  key: React.Key,
  children: DataNode[],
): DataNode[] {
  return list.map((node) => {
    if (node.key === key) return { ...node, children };
    if (node.children) {
      return { ...node, children: updateTreeData(node.children, key, children) };
    }
    return node;
  });
}

/** 拼接路径：按 parent 的平台语义选分隔符（daemon 返回的路径含 OS 原生 sep）。
 * 根节点带尾 sep（`C:\` 或 `/`），子项 name 不含 sep；Unix 下 `\\` 是合法文件名字符非分隔符，故不能硬编码。 */
function joinPath(parent: string, name: string): string {
  const sep = parent.includes("\\") ? "\\" : "/";
  return parent.endsWith(sep) ? parent + name : parent + sep + name;
}

export function RemoteFolderPicker({
  runtimeId,
  open,
  onClose,
  onPick,
  title = "选择目录",
  confirmText = "选择此目录",
  initialPath,
}: RemoteFolderPickerProps) {
  const [treeData, setTreeData] = useState<DataNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [manualPath, setManualPath] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [jumping, setJumping] = useState<boolean>(false);

  /** 重置全部内部状态（关闭或切换 runtimeId 时调用）。 */
  const resetState = useCallback(() => {
    setTreeData([]);
    setSelectedPath("");
    setManualPath("");
    setError("");
    setLoading(false);
    setJumping(false);
  }, []);

  /** open 切 true → 用 listRoots 初始化根节点。 */
  useEffect(() => {
    if (!open) {
      // 关闭即重置（配合 destroyOnClose 防止脏状态残留）。
      resetState();
      return;
    }
    if (!runtimeId) return;

    let cancelled = false;
    setLoading(true);
    setError("");
    setTreeData([]);
    setSelectedPath("");
    setManualPath("");

    (async () => {
      try {
        const { roots } = await listRoots(runtimeId);
        if (cancelled) return;
        const nodes: DataNode[] = roots.map((r) => ({
          title: r,
          key: r,
          isLeaf: false,
          icon: <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />,
        }));
        setTreeData(nodes);
        const first = nodes.length > 0 && nodes[0] ? (nodes[0].key as string) : "";
        const initPath = initialPath?.trim() ?? "";
        if (initPath) {
          // 调用方传入初始路径（当前输入框值）→ 地址栏回填 + 探 listDir 校验选中该路径。
          setManualPath(initPath);
          try {
            await listDir(runtimeId, initPath);
            if (cancelled) return;
            setSelectedPath(initPath);
          } catch {
            // 初始路径不存在/不可达 → 降级默认首根，不阻断（用户可手改路径重跳转）。
            if (cancelled) return;
            setSelectedPath(first);
          }
        } else if (first) {
          // 无初始路径 → 默认选中第一个根，方便直接确认。
          setSelectedPath(first);
          setManualPath(first);
        }
      } catch (err) {
        if (cancelled) return;
        // D-004 错误降级：daemon 离线 / 超时 / 无权限 → 红条提示，不崩溃。
        setError(formatBrowseError(err, "无法读取目录根，守护进程可能离线或无权限。"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, runtimeId, resetState]);

  /** Tree loadData：展开节点时异步加载子目录（只取 type==="dir"）。 */
  const onLoadData: TreeProps["loadData"] = useCallback(
    async (node: { key: React.Key }) => {
      const path = node.key as string;
      try {
        const resp = await listDir(runtimeId, path);
        const children: DataNode[] = resp.entries
          .filter((e) => e.type === "dir")
          .map((e) => ({
            title: e.name,
            key: joinPath(path, e.name),
            isLeaf: false,
            icon: <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />,
          }));
        setTreeData((prev) => updateTreeData(prev, node.key, children));
      } catch (err) {
        // 单个节点加载失败 → 置空子节点 + 红条提示，不崩溃；区分「空目录」与「加载失败」。
        setTreeData((prev) => updateTreeData(prev, node.key, []));
        setError(formatBrowseError(err, "无法展开该目录。"));
      }
    },
    [runtimeId],
  );

  /** 选中树节点 → 同步 selectedPath + 地址栏。 */
  const onSelect: TreeProps["onSelect"] = useCallback((keys: React.Key[]) => {
    if (keys.length > 0) {
      const p = keys[0] as string;
      setSelectedPath(p);
      setManualPath(p);
      setError("");
    }
  }, []);

  /** 地址栏手输跳转：调 listDir 校验路径存在且为目录，失败则红条提示并禁用确认（D-003）。 */
  const onJump = useCallback(async () => {
    const p = manualPath.trim();
    if (!p) return;
    setJumping(true);
    setError("");
    try {
      // listDir 成功即代表路径存在且为目录（后端 404/not_found 会抛 ApiError）。
      await listDir(runtimeId, p);
      setSelectedPath(p);
    } catch (err) {
      setSelectedPath("");
      setError(formatBrowseError(err, "路径不存在或不是目录：" + p));
    } finally {
      setJumping(false);
    }
  }, [manualPath, runtimeId]);

  /** 确认 → 触发 onPick 并关闭。 */
  const onConfirm = useCallback(() => {
    if (!selectedPath) return;
    onPick(selectedPath);
    onClose();
  }, [selectedPath, onPick, onClose]);

  return (
    <Modal
      title={title}
      open={open}
      onOk={onConfirm}
      onCancel={onClose}
      okText={confirmText}
      cancelText="取消"
      okButtonProps={{ disabled: !selectedPath }}
      destroyOnClose
      width={560}
    >
      {/* 地址栏：手输路径 + 跳转（D-003） */}
      <div className="mb-2 flex items-center gap-2">
        <Input
          value={manualPath}
          onChange={(e) => setManualPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void onJump();
            }
          }}
          placeholder="输入路径直接跳转，如 D:/ 或 /home/whale"
          className="font-mono"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={onJump}
          disabled={jumping || !manualPath.trim()}
          className="h-7 shrink-0"
        >
          {jumping ? "校验中…" : "跳转"}
        </Button>
      </div>

      {/* 错误降级红条（D-004） */}
      {error ? (
        <div className="mb-2 rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {/* 目录树：加载中 / 空态 / 树 */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Spin size="small" />
        </div>
      ) : treeData.length === 0 ? (
        <div className="py-8 text-center text-xs text-muted-foreground">
          {error
            ? "无法加载目录树，可在上方手动输入路径后点「跳转」。"
            : "没有可枚举的根目录。"}
        </div>
      ) : (
        <div className="rounded border">
          <Tree
            treeData={treeData}
            loadData={onLoadData}
            onSelect={onSelect}
            selectedKeys={selectedPath ? [selectedPath] : []}
            showIcon
            blockNode
            height={300}
          />
        </div>
      )}

      {/* 已选路径回显 */}
      {selectedPath ? (
        <div className="mt-2 flex items-center gap-2 rounded bg-muted px-2 py-1 text-xs">
          <span className="shrink-0 text-muted-foreground">已选路径：</span>
          <code className="truncate font-mono">{selectedPath}</code>
        </div>
      ) : (
        <div className="mt-2 text-center text-xs text-muted-foreground">
          在目录树中选择一个文件夹，或在上方输入路径后点「跳转」
        </div>
      )}
    </Modal>
  );
}

/** 统一把 ApiError / 异常 转成用户可读的中文提示。 */
function formatBrowseError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    // 常见 code：not_found / forbidden / daemon_offline / timeout 等。
    if (err.code === "not_found") return "路径不存在或不是目录。";
    if (err.code === "forbidden" || err.status === 403) {
      return "该路径不在 daemon 允许访问的目录范围内。";
    }
    return err.message || fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export default RemoteFolderPicker;
