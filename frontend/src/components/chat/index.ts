/**
 * components/chat 桶导出（2026-09-09-sessions-visual-refresh task-04）。
 * 单聊（turn-timeline / turn-segment-views）与群聊（group-chat-panel）共用的
 * 聊天行构件族：消息头像 / 轮次分隔胶囊 / 头像 src 解析 hook。
 */
export {
  ChatMessageAvatar,
  type ChatMessageAvatarProps,
} from "./chat-message-avatar";
export {
  RoundDivider,
  type RoundDividerProps,
  type RoundDividerStatus,
} from "./round-divider";
export { avatarFileId, useAvatarSrc } from "./use-avatar-src";
