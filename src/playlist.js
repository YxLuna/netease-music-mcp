import { createCipheriv, createHash, randomBytes } from 'node:crypto';

import { mapSong } from './netease.js';
import { getSessionConfiguration, loadNeteaseSession } from './session.js';

const API_ORIGIN = 'https://music.163.com';
const EAPI_KEY = Buffer.from('e82ckenh8dichen8', 'utf8');
const EAPI_DELIMITER = '-36cd479b6b5-';
const DEVICE_ID = `netease-mcp-${randomBytes(16).toString('hex')}`;
const USER_AGENT =
  'Mozilla/5.0 AppleWebKit/537.36 Chrome/136 Safari/537.36';

function assertNumericId(id, label = '资源 ID') {
  const value = String(id ?? '').trim();
  if (!/^\d{1,20}$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${label} 必须是 JavaScript 安全整数范围内的 1–20 位数字。`);
  }
  return value;
}

function normalizeSongIds(songIds) {
  if (!Array.isArray(songIds) || songIds.length < 1 || songIds.length > 100) {
    throw new Error('songIds 必须包含 1–100 个歌曲 ID。');
  }
  return [...new Set(songIds.map((id) => assertNumericId(id, '歌曲 ID')))];
}

function normalizePlaylistName(name) {
  const value = String(name ?? '').trim();
  if (!value || value.length > 40 || /[\r\n]/.test(value)) {
    throw new Error('歌单名称必须是 1–40 个字符且不能换行。');
  }
  return value;
}

export function encryptEapi(apiPath, payload) {
  const text = JSON.stringify(payload);
  const digest = createHash('md5')
    .update(`nobody${apiPath}use${text}md5forencrypt`)
    .digest('hex');
  const message = `${apiPath}${EAPI_DELIMITER}${text}${EAPI_DELIMITER}${digest}`;
  const cipher = createCipheriv('aes-128-ecb', EAPI_KEY, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(message, 'utf8'), cipher.final()])
    .toString('hex')
    .toUpperCase();
}

function buildEapiPayload(params, session) {
  return {
    ...params,
    csrf_token: session.csrfToken,
    header: JSON.stringify({
      os: 'osx',
      appver: '3.1.9',
      deviceId: DEVICE_ID,
      requestId: `${Date.now()}_0`,
      osver: 'macOS',
    }),
  };
}

async function requestEapi(
  apiPath,
  params,
  { fetchImpl = fetch, sessionProvider = loadNeteaseSession } = {},
) {
  const session = await sessionProvider();
  const payload = buildEapiPayload(params, session);
  const eapiPath = apiPath.replace(/^\/api\//, '/eapi/');
  const response = await fetchImpl(new URL(eapiPath, API_ORIGIN), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: session.cookieHeader,
      Referer: `${API_ORIGIN}/`,
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({ params: encryptEapi(apiPath, payload) }).toString(),
    redirect: 'error',
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) throw new Error(`网易云账号接口返回 HTTP ${response.status}`);
  const result = await response.json();
  if (Number(result?.code) !== 200) {
    if (Number(result?.code) === 301) throw new Error('网易云登录会话已失效，请重新导入。');
    if (Number(result?.code) === 502) throw new Error('歌单中已存在该歌曲，网易云拒绝重复添加。');
    throw new Error(`网易云账号操作失败（code ${result?.code ?? 'unknown'}）：${result?.message ?? result?.msg ?? '未知错误'}`);
  }
  return result;
}

function mapPlaylist(playlist, accountId) {
  return {
    id: String(playlist?.id ?? ''),
    name: playlist?.name ?? '',
    trackCount: Number(playlist?.trackCount ?? 0),
    privacy: Number(playlist?.privacy ?? 0),
    specialType: Number(playlist?.specialType ?? 0),
    owned: String(playlist?.userId ?? '') === String(accountId),
    subscribed: Boolean(playlist?.subscribed),
    creator: playlist?.creator?.nickname ?? null,
    pageUrl: playlist?.id ? `${API_ORIGIN}/#/playlist?id=${playlist.id}` : null,
  };
}

const MAX_PAGE_SIZE = 500;
const SONG_DETAIL_BATCH = 500;

function normalizePage(limit = 100, offset = 0) {
  const size = Number(limit);
  const start = Number(offset);
  if (!Number.isInteger(size) || size < 1 || size > MAX_PAGE_SIZE) {
    throw new Error(`limit 必须是 1–${MAX_PAGE_SIZE} 的整数。`);
  }
  if (!Number.isInteger(start) || start < 0) {
    throw new Error('offset 必须是非负整数。');
  }
  return { limit: size, offset: start };
}

// 账号会话下的批量歌曲详情，按 trackIds 原顺序返回；网易云单次最多接受约 1000 个 ID。
async function getSongsByIds(songIds, options = {}) {
  const songs = [];
  for (let index = 0; index < songIds.length; index += SONG_DETAIL_BATCH) {
    const batch = songIds.slice(index, index + SONG_DETAIL_BATCH);
    const result = await requestEapi('/api/v3/song/detail', {
      c: JSON.stringify(batch.map((id) => ({ id: Number(id) }))),
    }, options);
    const byId = new Map(
      (Array.isArray(result?.songs) ? result.songs : []).map((song) => [String(song?.id), song]),
    );
    for (const id of batch) {
      const song = byId.get(String(id));
      if (song) songs.push(mapSong(song));
    }
  }
  return songs;
}

async function pageSongIds(allIds, page, options) {
  const ids = allIds.slice(page.offset, page.offset + page.limit);
  return {
    total: allIds.length,
    offset: page.offset,
    limit: page.limit,
    hasMore: page.offset + ids.length < allIds.length,
    songs: await getSongsByIds(ids, options),
  };
}

export async function getPlaylistAuthStatus({
  sessionConfigurationProvider = getSessionConfiguration,
} = {}) {
  return sessionConfigurationProvider();
}

export async function getAuthenticatedAccount(options = {}) {
  const result = await requestEapi('/api/w/nuser/account/get', {}, options);
  const userId = result?.profile?.userId ?? result?.account?.id;
  if (!userId) throw new Error('无法从网易云会话读取当前账号 ID。');
  const vipType = Number(result?.account?.vipType ?? 0) || 0;
  return {
    userId: String(userId),
    nickname: result?.profile?.nickname ?? '',
    vipType,
    isVip: vipType > 0,
  };
}

// 会员识别：vipType > 0 即会员（常见 11 = 黑胶 VIP）。会话失效时 requestEapi 会报 301。
export async function getAccountStatus(options = {}) {
  const account = await getAuthenticatedAccount(options);
  return {
    loggedIn: true,
    nickname: account.nickname,
    vipType: account.vipType,
    isVip: account.isVip,
  };
}

const PLAYLIST_FILTERS = Object.freeze({
  created: (playlist) => playlist.owned,
  subscribed: (playlist) => !playlist.owned,
  all: () => true,
});

// /api/user/playlist 同时返回自建和收藏的歌单；「我喜欢的音乐」是自建歌单里 specialType = 5 的那一个。
export async function listAccountPlaylists(include = 'created', options = {}) {
  const filter = PLAYLIST_FILTERS[include];
  if (!filter) throw new Error('include 只能是 created、subscribed 或 all。');
  const account = await getAuthenticatedAccount(options);
  const result = await requestEapi('/api/user/playlist', {
    uid: account.userId,
    limit: 1000,
    offset: 0,
    includeVideo: true,
  }, options);
  const playlists = Array.isArray(result?.playlist) ? result.playlist : [];
  return {
    account,
    playlists: playlists.map((playlist) => mapPlaylist(playlist, account.userId)).filter(filter),
  };
}

export async function listOwnPlaylists(options = {}) {
  return listAccountPlaylists('created', options);
}

export async function getPlaylistTracks(playlistId, { limit, offset } = {}, options = {}) {
  const normalizedId = assertNumericId(playlistId, '歌单 ID');
  const page = normalizePage(limit, offset);
  const result = await requestEapi('/api/v6/playlist/detail', {
    id: normalizedId,
    n: 100000,
    s: 0,
  }, options);
  const playlist = result?.playlist;
  if (!playlist) throw new Error('网易云没有返回该歌单，可能不存在或无权查看。');
  const trackIds = (Array.isArray(playlist.trackIds) ? playlist.trackIds : [])
    .map((item) => String(item?.id ?? ''))
    .filter(Boolean);
  return {
    playlist: {
      id: String(playlist.id ?? normalizedId),
      name: playlist.name ?? '',
      trackCount: Number(playlist.trackCount ?? trackIds.length),
      creator: playlist.creator?.nickname ?? null,
    },
    ...(await pageSongIds(trackIds, page, options)),
  };
}

export async function getLikedSongs({ limit, offset, idsOnly = false } = {}, options = {}) {
  const account = await getAuthenticatedAccount(options);
  const result = await requestEapi('/api/song/like/get', { uid: account.userId }, options);
  const ids = (Array.isArray(result?.ids) ? result.ids : []).map(String);
  if (idsOnly) return { total: ids.length, songIds: ids };
  return pageSongIds(ids, normalizePage(limit, offset), options);
}

const PLAY_RECORD_TYPES = Object.freeze({ week: 1, all: 0 });

export async function getPlayRecord(period = 'week', options = {}) {
  const type = PLAY_RECORD_TYPES[period];
  if (type === undefined) throw new Error('period 只能是 week 或 all。');
  const account = await getAuthenticatedAccount(options);
  const result = await requestEapi('/api/v1/play/record', { uid: account.userId, type }, options);
  const records = (period === 'week' ? result?.weekData : result?.allData) ?? [];
  return {
    period,
    songs: records.map((record) => ({
      ...mapSong(record?.song),
      playCount: Number(record?.playCount ?? 0),
      score: Number(record?.score ?? 0),
    })),
  };
}

export async function getDailyRecommendSongs(options = {}) {
  const result = await requestEapi('/api/v3/discovery/recommend/songs', {}, options);
  const reasons = new Map(
    (result?.data?.recommendReasons ?? []).map((item) => [String(item?.songId), item?.reason]),
  );
  const songs = Array.isArray(result?.data?.dailySongs) ? result.data.dailySongs : [];
  return {
    songs: songs.map((song) => ({
      ...mapSong(song),
      reason: reasons.get(String(song?.id)) ?? song?.reason ?? null,
    })),
  };
}

export async function getSimilarSongs(songId, limit = 20, options = {}) {
  const normalizedId = assertNumericId(songId, '歌曲 ID');
  const size = Number(limit);
  if (!Number.isInteger(size) || size < 1 || size > 50) throw new Error('limit 必须是 1–50 的整数。');
  const result = await requestEapi('/api/v1/discovery/simiSong', {
    songid: normalizedId,
    limit: size,
    offset: 0,
  }, options);
  return {
    seedSongId: normalizedId,
    songs: (Array.isArray(result?.songs) ? result.songs : []).map(mapSong),
  };
}

// 云盘歌曲有自己的歌曲 ID，可直接用于红心、加歌单；上传仍由用户在官方客户端完成。
export async function getCloudSongs({ limit, offset } = {}, options = {}) {
  const page = normalizePage(limit, offset);
  const result = await requestEapi('/api/v1/cloud/get', page, options);
  const items = Array.isArray(result?.data) ? result.data : [];
  const total = Number(result?.count ?? items.length);
  return {
    total,
    offset: page.offset,
    limit: page.limit,
    hasMore: page.offset + items.length < total,
    usedBytes: Number(result?.size ?? 0),
    maxBytes: Number(result?.maxSize ?? 0),
    songs: items.map((item) => ({
      id: String(item?.songId ?? item?.simpleSong?.id ?? ''),
      name: item?.songName ?? item?.simpleSong?.name ?? '',
      artists: item?.artist ? [item.artist] : (item?.simpleSong?.ar ?? []).map((a) => a?.name).filter(Boolean),
      album: item?.album ?? item?.simpleSong?.al?.name ?? '',
      fileName: item?.fileName ?? null,
      sizeBytes: Number(item?.fileSize ?? 0),
      uploadedAt: item?.addTime ? new Date(Number(item.addTime)).toISOString() : null,
    })),
  };
}

export async function getRecommendPlaylists(options = {}) {
  const result = await requestEapi('/api/v1/discovery/recommend/resource', {}, options);
  const playlists = Array.isArray(result?.recommend) ? result.recommend : [];
  return {
    playlists: playlists.map((playlist) => ({
      id: String(playlist?.id ?? ''),
      name: playlist?.name ?? '',
      reason: playlist?.copywriter ?? null,
      trackCount: Number(playlist?.trackCount ?? 0),
      playCount: Number(playlist?.playcount ?? 0),
      creator: playlist?.creator?.nickname ?? null,
      pageUrl: playlist?.id ? `${API_ORIGIN}/#/playlist?id=${playlist.id}` : null,
    })),
  };
}

async function assertOwnedPlaylist(playlistId, options = {}) {
  const normalizedId = assertNumericId(playlistId, '歌单 ID');
  const result = await listOwnPlaylists(options);
  const playlist = result.playlists.find((item) => item.id === normalizedId);
  if (!playlist) throw new Error('目标歌单不属于当前登录账号，已拒绝修改。');
  return playlist;
}

export async function createPlaylist(name, isPrivate = false, options = {}) {
  const normalizedName = normalizePlaylistName(name);
  const account = await getAuthenticatedAccount(options);
  const result = await requestEapi('/api/playlist/create', {
    uid: account.userId,
    name: normalizedName,
    privacy: isPrivate ? 10 : 0,
  }, options);
  const playlistId = result?.id ?? result?.playlist?.id;
  if (!playlistId) throw new Error('网易云返回创建成功，但缺少歌单 ID。');
  return {
    created: true,
    playlist: mapPlaylist(
      { ...result.playlist, id: playlistId, name: normalizedName, userId: account.userId },
      account.userId,
    ),
  };
}

async function manipulatePlaylistTracks(playlistId, songIds, operation, options = {}) {
  const playlist = await assertOwnedPlaylist(playlistId, options);
  const normalizedSongIds = normalizeSongIds(songIds);
  await requestEapi('/api/v1/playlist/manipulate/tracks', {
    pid: playlist.id,
    op: operation,
    trackIds: JSON.stringify(normalizedSongIds),
  }, options);
  return {
    updated: true,
    operation: operation === 'add' ? 'add' : 'remove',
    playlist,
    songIds: normalizedSongIds,
  };
}

export async function addSongsToPlaylist(playlistId, songIds, options = {}) {
  return manipulatePlaylistTracks(playlistId, songIds, 'add', options);
}

export async function removeSongsFromPlaylist(playlistId, songIds, options = {}) {
  return manipulatePlaylistTracks(playlistId, songIds, 'del', options);
}

// /api/radio/like 实测会被风控拦截（code -460），改为直接增删「我喜欢的音乐」歌单，效果与红心一致。
export async function setSongLiked(songId, like, options = {}) {
  const normalizedId = assertNumericId(songId, '歌曲 ID');
  if (typeof like !== 'boolean') throw new Error('like 必须是 true 或 false。');
  const own = await listOwnPlaylists(options);
  const likedPlaylist = own.playlists.find((playlist) => playlist.specialType === 5);
  if (!likedPlaylist) throw new Error('没有找到「我喜欢的音乐」歌单。');
  await requestEapi('/api/v1/playlist/manipulate/tracks', {
    pid: likedPlaylist.id,
    op: like ? 'add' : 'del',
    trackIds: JSON.stringify([normalizedId]),
  }, options);
  return { updated: true, songId: normalizedId, liked: like };
}

export async function setPlaylistSubscribed(playlistId, subscribe, options = {}) {
  const normalizedId = assertNumericId(playlistId, '歌单 ID');
  if (typeof subscribe !== 'boolean') throw new Error('subscribe 必须是 true 或 false。');
  const own = await listOwnPlaylists(options);
  if (own.playlists.some((playlist) => playlist.id === normalizedId)) {
    throw new Error('这是当前账号自己创建的歌单，不能收藏或取消收藏。');
  }
  await requestEapi(
    subscribe ? '/api/playlist/subscribe' : '/api/playlist/unsubscribe',
    { id: normalizedId },
    options,
  );
  return { updated: true, playlistId: normalizedId, subscribed: subscribe };
}
