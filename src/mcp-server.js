import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import {
  controlPlayback,
  getClientStatus,
  getListenTogetherCapabilities,
  getLyrics,
  getSongDetails,
  launchClient,
  nextTrackDirect,
  openClientArea,
  openEntity,
  openListenTogetherInvite,
  searchSongs,
} from './netease.js';
import {
  addSongsToPlaylist,
  createPlaylist,
  getAccountStatus,
  getCloudSongs,
  getDailyRecommendSongs,
  getLikedSongs,
  getPlaylistAuthStatus,
  getPlaylistTracks,
  getPlayRecord,
  getRecommendPlaylists,
  getSimilarSongs,
  listAccountPlaylists,
  removeSongsFromPlaylist,
  setPlaylistSubscribed,
  setSongLiked,
} from './playlist.js';

const numericId = z.string().regex(/^\d{1,20}$/);

function success(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function failure(error) {
  return {
    content: [
      {
        type: 'text',
        text: error instanceof Error ? error.message : String(error),
      },
    ],
    isError: true,
  };
}

async function handle(operation) {
  try {
    return success(await operation());
  } catch (error) {
    return failure(error);
  }
}

export function createNeteaseMcpServer({ authInfo, accountContext } = {}) {
  const accountOptions = accountContext
    ? {
        sessionProvider: accountContext.loadNeteaseSession,
        sessionConfigurationProvider: accountContext.getSessionConfiguration,
      }
    : {};
  const guarded = (scope, operation) =>
    handle(async () => {
      if (authInfo && !authInfo.scopes.includes(scope)) {
        throw new Error(`当前 Token 缺少 ${scope} 权限。`);
      }
      return operation();
    });
  const server = new McpServer(
    {
      name: 'netease-music-mcp',
      version: '0.7.0',
    },
    {
      instructions:
        '跨平台网易云音乐 MCP。搜索、详情、歌词和歌单账号能力可在桌面、服务器或移动 MCP 客户端使用；本地播放器控制取决于设备适配器。打开页面或控制播放前应获得用户明确意图。歌单写工具只能在用户明确确认本次修改后调用，并必须传 confirm=true。不得用于下载音频、绕过会员或版权限制。',
    },
  );

  server.registerTool(
    'netease_playlist_auth_status',
    {
      title: '网易云歌单账号能力状态',
      description: '只检查账号写入功能是否已启用、是否配置会话文件；不返回任何 Cookie 值。',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => guarded('playlist:read', () => getPlaylistAuthStatus(accountOptions)),
  );

  server.registerTool(
    'netease_account_status',
    {
      title: '网易云账号与会员状态',
      description: '用已保存的登录会话读取当前账号昵称和会员类型（vipType > 0 为会员），判断会话是否有效；不返回任何 Cookie 值。',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => guarded('playlist:read', () => getAccountStatus(accountOptions)),
  );

  server.registerTool(
    'netease_playlist_list',
    {
      title: '列出我的网易云歌单',
      description:
        '列出当前账号的歌单。include=created 只列自建（默认，含 specialType=5 的「我喜欢的音乐」），subscribed 只列收藏的别人的歌单，all 两者都列；owned=true 的歌单才能加歌或移除。',
      inputSchema: z.object({
        include: z.enum(['created', 'subscribed', 'all']).default('created'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ include }) =>
      guarded('playlist:read', () => listAccountPlaylists(include, accountOptions)),
  );

  server.registerTool(
    'netease_playlist_tracks',
    {
      title: '读取网易云歌单曲目',
      description: '按歌单 ID 分页读取曲目（自建、收藏或公开歌单均可），按歌单原顺序返回歌名、歌手、专辑、时长。',
      inputSchema: z.object({
        playlistId: numericId,
        limit: z.number().int().min(1).max(500).default(100),
        offset: z.number().int().min(0).default(0),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ playlistId, limit, offset }) =>
      guarded('playlist:read', () =>
        getPlaylistTracks(playlistId, { limit, offset }, accountOptions),
      ),
  );

  server.registerTool(
    'netease_liked_songs',
    {
      title: '读取「我喜欢的音乐」',
      description:
        '分页读取当前账号红心过的歌曲。idsOnly=true 时只返回全部歌曲 ID（不分页），适合推荐时去重。',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(500).default(100),
        offset: z.number().int().min(0).default(0),
        idsOnly: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ limit, offset, idsOnly }) =>
      guarded('playlist:read', () => getLikedSongs({ limit, offset, idsOnly }, accountOptions)),
  );

  server.registerTool(
    'netease_play_record',
    {
      title: '读取听歌排行',
      description: '读取当前账号的听歌排行。period=week 为最近一周，all 为所有时间；附带播放次数和相对得分。',
      inputSchema: z.object({
        period: z.enum(['week', 'all']).default('week'),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ period }) => guarded('playlist:read', () => getPlayRecord(period, accountOptions)),
  );

  server.registerTool(
    'netease_daily_recommend',
    {
      title: '读取每日推荐歌曲',
      description: '读取当前账号今天的每日推荐歌曲及网易云给出的推荐理由（如有）。',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => guarded('playlist:read', () => getDailyRecommendSongs(accountOptions)),
  );

  server.registerTool(
    'netease_similar_songs',
    {
      title: '查找相似歌曲',
      description: '给定一首歌曲 ID，返回网易云认为相似的歌曲，用作推荐候选。',
      inputSchema: z.object({
        songId: numericId,
        limit: z.number().int().min(1).max(50).default(20),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ songId, limit }) =>
      guarded('playlist:read', () => getSimilarSongs(songId, limit, accountOptions)),
  );

  server.registerTool(
    'netease_cloud_songs',
    {
      title: '读取我的网易云云盘',
      description:
        '分页列出当前账号云盘里自己上传的歌曲（含文件名、大小、上传时间）及云盘用量；返回的 id 可直接用于红心或加入自己的歌单。不支持上传。',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(500).default(100),
        offset: z.number().int().min(0).default(0),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ limit, offset }) =>
      guarded('playlist:read', () => getCloudSongs({ limit, offset }, accountOptions)),
  );

  server.registerTool(
    'netease_recommend_playlists',
    {
      title: '读取每日推荐歌单',
      description: '读取当前账号今天的推荐歌单列表；曲目可再用 netease_playlist_tracks 读取。',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => guarded('playlist:read', () => getRecommendPlaylists(accountOptions)),
  );

  server.registerTool(
    'netease_song_like',
    {
      title: '红心或取消红心歌曲',
      description: 'like=true 把歌曲加入「我喜欢的音乐」，false 取消红心。必须在用户明确确认后调用。',
      inputSchema: z.object({
        songId: numericId,
        like: z.boolean(),
        confirm: z.literal(true).describe('用户已明确确认这次红心变更'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ songId, like }) =>
      guarded('playlist:write', () => setSongLiked(songId, like, accountOptions)),
  );

  server.registerTool(
    'netease_playlist_subscribe',
    {
      title: '收藏或取消收藏歌单',
      description: 'subscribe=true 收藏别人的歌单，false 取消收藏；不能用于自己创建的歌单。必须在用户明确确认后调用。',
      inputSchema: z.object({
        playlistId: numericId,
        subscribe: z.boolean(),
        confirm: z.literal(true).describe('用户已明确确认这次收藏变更'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ playlistId, subscribe }) =>
      guarded('playlist:write', () =>
        setPlaylistSubscribed(playlistId, subscribe, accountOptions),
      ),
  );

  server.registerTool(
    'netease_playlist_create',
    {
      title: '创建网易云歌单',
      description: '在当前登录账号下创建公开或隐私歌单。必须在用户明确确认本次创建后调用。',
      inputSchema: z.object({
        name: z.string().min(1).max(40),
        isPrivate: z.boolean().default(false),
        confirm: z.literal(true).describe('用户已明确确认创建这个歌单'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ name, isPrivate }) =>
      guarded('playlist:write', () => createPlaylist(name, isPrivate, accountOptions)),
  );

  server.registerTool(
    'netease_playlist_add_songs',
    {
      title: '添加歌曲到网易云歌单',
      description: '将 1–100 首歌曲加入当前账号拥有的指定歌单；修改前会再次校验歌单归属。',
      inputSchema: z.object({
        playlistId: z.string().regex(/^\d{1,20}$/),
        songIds: z.array(z.string().regex(/^\d{1,20}$/)).min(1).max(100),
        confirm: z.literal(true).describe('用户已明确确认添加这些歌曲'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ playlistId, songIds }) =>
      guarded('playlist:write', () =>
        addSongsToPlaylist(playlistId, songIds, accountOptions),
      ),
  );

  server.registerTool(
    'netease_playlist_remove_songs',
    {
      title: '从网易云歌单移除歌曲',
      description: '从当前账号拥有的指定歌单移除 1–100 首歌曲；必须明确确认，且会校验歌单归属。',
      inputSchema: z.object({
        playlistId: z.string().regex(/^\d{1,20}$/),
        songIds: z.array(z.string().regex(/^\d{1,20}$/)).min(1).max(100),
        confirm: z.literal(true).describe('用户已明确确认移除这些歌曲'),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ playlistId, songIds }) =>
      guarded('playlist:write', () =>
        removeSongsFromPlaylist(playlistId, songIds, accountOptions),
      ),
  );

  server.registerTool(
    'netease_status',
    {
      title: '网易云客户端状态',
      description: '检查当前运行平台、远程能力和可用的本地播放器适配器；macOS 还会读取客户端状态。',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => guarded('music:read', getClientStatus),
  );

  server.registerTool(
    'netease_search',
    {
      title: '搜索网易云歌曲',
      description: '通过 music.163.com 的匿名只读接口搜索歌曲，不读取账号 Cookie。',
      inputSchema: z.object({
        query: z.string().min(1).max(100).describe('歌曲、歌手或关键词'),
        limit: z.number().int().min(1).max(20).default(10),
        offset: z.number().int().min(0).max(10_000).default(0),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, limit, offset }) =>
      guarded('music:read', () => searchSongs(query, limit, offset)),
  );

  server.registerTool(
    'netease_song_detail',
    {
      title: '读取网易云歌曲详情',
      description: '按网易云歌曲 ID 读取名称、歌手、专辑、时长和官方页面链接。',
      inputSchema: z.object({
        songIds: z.array(z.string().regex(/^\d{1,20}$/)).min(1).max(20),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ songIds }) => guarded('music:read', () => getSongDetails(songIds)),
  );

  server.registerTool(
    'netease_lyrics',
    {
      title: '读取网易云歌词',
      description: '按歌曲 ID 读取 LRC、翻译和罗马音歌词；不下载音频。',
      inputSchema: z.object({
        songId: z.string().regex(/^\d{1,20}$/),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ songId }) => guarded('music:read', () => getLyrics(songId)),
  );

  server.registerTool(
    'netease_launch',
    {
      title: '启动网易云音乐（macOS）',
      description: '通过 macOS 适配器启动已安装的官方网易云音乐客户端；其他平台会返回清晰的能力错误。',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async () => guarded('player:control', launchClient),
  );

  server.registerTool(
    'netease_open_entity',
    {
      title: '在网易云打开资源',
      description: '通过 macOS 适配器在官方客户端中打开歌曲、歌单、专辑或歌手页面。',
      inputSchema: z.object({
        type: z.enum(['song', 'playlist', 'album', 'artist']),
        id: z.string().regex(/^\d{1,20}$/),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ type, id }) =>
      guarded('player:control', () => openEntity(type, id)),
  );

  server.registerTool(
    'netease_open_area',
    {
      title: '打开网易云功能页',
      description: '打开私人 FM、下载管理或听歌识曲。只允许预设的 orpheus:// 路由。',
      inputSchema: z.object({
        area: z.enum(['private_fm', 'downloads', 'recognize']),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ area }) => guarded('player:control', () => openClientArea(area)),
  );

  server.registerTool(
    'netease_listen_together_capabilities',
    {
      title: '检查一起听能力',
      description:
        '检查当前设备的一起听能力。macOS 适配器可打开邀请；互动能力取决于网易云官方移动端。',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => guarded('player:control', getListenTogetherCapabilities),
  );

  server.registerTool(
    'netease_listen_together_invite',
    {
      title: '邀请好友一起听',
      description:
        '通过 macOS 适配器打开“一起听”邀请界面。调用前必须确认用户明确希望发起邀请；好友或分享方式由用户在客户端中选择。',
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async () => guarded('player:control', openListenTogetherInvite),
  );

  server.registerTool(
    'netease_next_track',
    {
      title: '普通播放下一首',
      description:
        '让 macOS 直接向当前网易云播放器发送下一首命令。仅用于普通播放，不操控屏幕，也不用于一起听房间。',
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async () => guarded('player:control', nextTrackDirect),
  );

  server.registerTool(
    'netease_control',
    {
      title: '控制网易云播放',
      description: '控制官方 Mac 客户端播放/暂停、上一首或下一首，需要 macOS 辅助功能权限。',
      inputSchema: z.object({
        action: z.enum(['play_pause', 'previous', 'next']),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ action }) => guarded('player:control', () => controlPlayback(action)),
  );

  return server;
}
