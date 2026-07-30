import { createCipheriv, createHash, randomBytes } from 'node:crypto';

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
    pageUrl: playlist?.id ? `${API_ORIGIN}/#/playlist?id=${playlist.id}` : null,
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
  return {
    userId: String(userId),
    nickname: result?.profile?.nickname ?? '',
  };
}

export async function listOwnPlaylists(options = {}) {
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
    playlists: playlists.map((playlist) => mapPlaylist(playlist, account.userId)).filter((p) => p.owned),
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
