import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const MEDIA_REMOTE_SOURCE = join(MODULE_DIR, '..', 'native', 'media-remote.c');
const MEDIA_REMOTE_BINARY = join(
  tmpdir(),
  `netease-music-mcp-media-remote-${process.arch}`,
);

export const APP_PATH = '/Applications/NeteaseMusic.app';
export const BUNDLE_ID = 'com.netease.163music';
const PROCESS_NAME = 'NeteaseMusic';
const PLIST_PATH = `${APP_PATH}/Contents/Info.plist`;
const API_ORIGIN = 'https://music.163.com';
const USER_AGENT =
  'Mozilla/5.0 AppleWebKit/537.36 Chrome/136 Safari/537.36';

const ENTITY_TYPES = new Set(['song', 'playlist', 'album', 'artist']);
const AREA_URIS = Object.freeze({
  private_fm: 'orpheus://radio',
  downloads: 'orpheus://download',
  recognize: 'orpheus://recognize',
});
const LISTEN_TOGETHER_URI = 'orpheus://nm/play/listenTogether?refer=mcp';

const CONTROL_MENU_NAMES = Object.freeze({
  play_pause: ['播放/暂停', '暂停', '播放', 'Play/Pause', 'Pause', 'Play'],
  next: ['下一个', '下一首', 'Next'],
  previous: ['上一个', '上一首', 'Previous'],
});

async function run(command, args, options = {}) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
    ...options,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

async function runBoolean(command, args) {
  try {
    await run(command, args);
    return true;
  } catch {
    return false;
  }
}

async function ensureMediaRemoteHelper() {
  try {
    await access(MEDIA_REMOTE_BINARY);
    return MEDIA_REMOTE_BINARY;
  } catch {
    // Compile a tiny local bridge on first use. The binary lives in macOS's
    // temporary directory and contains no account or MCP credentials.
    await run('/usr/bin/clang', [
      '-std=c11',
      '-O2',
      '-Wall',
      '-Wextra',
      MEDIA_REMOTE_SOURCE,
      '-o',
      MEDIA_REMOTE_BINARY,
    ]);
    return MEDIA_REMOTE_BINARY;
  }
}

async function plistValue(key) {
  const { stdout } = await run('/usr/libexec/PlistBuddy', [
    '-c',
    `Print :${key}`,
    PLIST_PATH,
  ]);
  return stdout;
}

function assertMac() {
  if (process.platform !== 'darwin') {
    throw new Error('网易云客户端控制仅支持 macOS；只读搜索和歌词仍可跨平台使用。');
  }
}

function assertNumericId(id) {
  const value = String(id ?? '').trim();
  if (!/^\d{1,20}$/.test(value)) {
    throw new Error('网易云资源 ID 必须是 1–20 位数字。');
  }
  if (!Number.isSafeInteger(Number(value))) {
    throw new Error('网易云资源 ID 超出 JavaScript 安全整数范围。');
  }
  return value;
}

export function buildEntityUrl(type, id) {
  if (!ENTITY_TYPES.has(type)) {
    throw new Error(`不支持的资源类型：${type}`);
  }
  return `${API_ORIGIN}/#/${type}?id=${assertNumericId(id)}`;
}

export function buildAreaUri(area) {
  const uri = AREA_URIS[area];
  if (!uri) {
    throw new Error(`不支持的客户端区域：${area}`);
  }
  return uri;
}

export function buildListenTogetherUri() {
  return LISTEN_TOGETHER_URI;
}

export function getListenTogetherCapabilities(platform = process.platform) {
  const isMac = platform === 'darwin';
  return {
    platform,
    invite: {
      supported: isMac,
      requiresLoggedInClient: true,
      requiresManualFriendSelection: true,
    },
    room: {
      synchronizedPlayback: isMac,
      textChatSend: false,
      voiceChat: false,
      emoticonSend: false,
    },
    mobileInteractionAvailableInOfficialApp: true,
    note: isMac
      ? '当前网易云 Mac 客户端支持发起和加入一起听，但文字聊天、实时语音和表情发送仅在移动端提供。'
      : '搜索、歌词和歌单能力可跨平台使用；一起听邀请与互动由官方客户端和设备权限决定。',
  };
}

export function normalizeSongIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 20) {
    throw new Error('songIds 必须包含 1–20 个歌曲 ID。');
  }
  return ids.map(assertNumericId);
}

function mapArtists(artists) {
  return Array.isArray(artists) ? artists.map((artist) => artist?.name).filter(Boolean) : [];
}

export function mapSong(song) {
  const album = song?.album ?? song?.al ?? {};
  const artists = song?.artists ?? song?.ar ?? [];
  return {
    id: song?.id,
    name: song?.name ?? '',
    artists: mapArtists(artists),
    album: album?.name ?? '',
    durationMs: song?.duration ?? song?.dt ?? null,
    pageUrl: song?.id ? buildEntityUrl('song', song.id) : null,
  };
}

export function parseSearchResponse(payload) {
  const songs = Array.isArray(payload?.result?.songs) ? payload.result.songs.map(mapSong) : [];
  return {
    total: Number(payload?.result?.songCount ?? songs.length),
    songs,
  };
}

export function parseSongDetailResponse(payload) {
  return {
    songs: Array.isArray(payload?.songs) ? payload.songs.map(mapSong) : [],
  };
}

function truncate(text, maxLength = 30_000) {
  if (typeof text !== 'string') return '';
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}\n…[歌词过长，已截断]`;
}

export function parseLyricsResponse(payload, songId) {
  return {
    songId: assertNumericId(songId),
    lyric: truncate(payload?.lrc?.lyric),
    translatedLyric: truncate(payload?.tlyric?.lyric),
    romanizedLyric: truncate(payload?.romalrc?.lyric),
    noLyric: Boolean(payload?.nolyric),
    uncollected: Boolean(payload?.uncollected),
  };
}

async function fetchJson(pathname, params) {
  const url = new URL(pathname, API_ORIGIN);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Referer: `${API_ORIGIN}/`,
      'User-Agent': USER_AGENT,
    },
    redirect: 'error',
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    throw new Error(`网易云接口返回 HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('json')) {
    throw new Error('网易云接口返回了非 JSON 内容。');
  }
  return response.json();
}

export async function searchSongs(query, limit = 10, offset = 0) {
  const normalizedQuery = String(query ?? '').trim();
  if (!normalizedQuery || normalizedQuery.length > 100) {
    throw new Error('query 必须是 1–100 个字符。');
  }

  const payload = await fetchJson('/api/search/get/web', {
    s: normalizedQuery,
    type: 1,
    limit,
    offset,
    total: true,
    csrf_token: '',
  });
  return parseSearchResponse(payload);
}

export async function getSongDetails(songIds) {
  const normalizedIds = normalizeSongIds(songIds);
  const payload = await fetchJson('/api/song/detail/', {
    ids: JSON.stringify(normalizedIds.map(Number)),
  });
  return parseSongDetailResponse(payload);
}

export async function getLyrics(songId) {
  const normalizedId = assertNumericId(songId);
  const payload = await fetchJson('/api/song/lyric', {
    id: normalizedId,
    lv: -1,
    kv: -1,
    tv: -1,
  });
  return parseLyricsResponse(payload, normalizedId);
}

export async function getClientStatus() {
  const status = {
    platform: process.platform,
    deviceKind: process.env.NETEASE_MCP_DEVICE_KIND ?? 'desktop-or-server',
    remoteToolsAvailable: true,
    accountToolsAvailable: true,
    localPlaybackAdapter: process.platform === 'darwin' ? 'macos' : null,
    localPlaybackSupported: process.platform === 'darwin',
    appPath: process.platform === 'darwin' ? APP_PATH : null,
    installed: process.platform === 'darwin' ? false : null,
    running: process.platform === 'darwin' ? false : null,
    bundleId: null,
    version: null,
    build: null,
    architecture: null,
    signatureValid: null,
    signatureWarning: null,
    urlScheme: null,
  };

  if (process.platform !== 'darwin') return status;

  try {
    await access(APP_PATH);
    status.installed = true;
  } catch {
    return status;
  }

  const [bundleId, version, build, executable, running, signatureValid] = await Promise.all([
    plistValue('CFBundleIdentifier'),
    plistValue('CFBundleShortVersionString'),
    plistValue('CFBundleVersion'),
    plistValue('CFBundleExecutable'),
    runBoolean('/usr/bin/pgrep', ['-x', PROCESS_NAME]),
    runBoolean('/usr/bin/codesign', ['--verify', '--deep', '--strict', APP_PATH]),
  ]);

  let architecture = null;
  try {
    const result = await run('/usr/bin/file', [`${APP_PATH}/Contents/MacOS/${executable}`]);
    architecture = result.stdout.includes('arm64') ? 'arm64' : result.stdout;
  } catch {
    architecture = 'unknown';
  }

  status.running = running;
  status.bundleId = bundleId;
  status.version = version;
  status.build = build;
  status.architecture = architecture;
  status.signatureValid = signatureValid;
  status.signatureWarning = signatureValid
    ? null
    : '当前网易云 3.1.9 官方 DMG 原件也未通过 macOS codesign 校验；MCP 不会修改或重签应用。';
  status.urlScheme = 'orpheus';
  return status;
}

export async function launchClient() {
  assertMac();
  await access(APP_PATH);
  await run('/usr/bin/open', ['-b', BUNDLE_ID]);
  return { launched: true, bundleId: BUNDLE_ID };
}

export async function openEntity(type, id) {
  assertMac();
  await access(APP_PATH);
  const url = buildEntityUrl(type, id);
  await run('/usr/bin/open', ['-b', BUNDLE_ID, url]);
  return { opened: true, type, id: assertNumericId(id), url };
}

export async function openClientArea(area) {
  assertMac();
  await access(APP_PATH);
  const uri = buildAreaUri(area);
  await run('/usr/bin/open', [uri]);
  return { opened: true, area, uri };
}

export async function openListenTogetherInvite() {
  assertMac();
  await access(APP_PATH);
  const uri = buildListenTogetherUri();
  await run('/usr/bin/open', ['-b', BUNDLE_ID, uri]);
  return {
    opened: true,
    uri,
    nextStep: '请在网易云弹出的邀请界面中选择好友或分享方式。',
    capabilities: getListenTogetherCapabilities(),
  };
}

export function buildMenuControlScript(menuNames) {
  return `
ObjC.import('stdlib');
function run() {
  const app = Application('${APP_PATH}');
  app.activate();
  delay(0.3);

  const systemEvents = Application('System Events');
  const process = systemEvents.processes.byName('${PROCESS_NAME}');
  if (!process.exists()) throw new Error('网易云音乐进程未运行');

  const wanted = ${JSON.stringify(menuNames)};
  const menuBar = process.menuBars[0];
  const menuBarItems = menuBar.menuBarItems();
  for (const menuBarItem of menuBarItems) {
    const menus = menuBarItem.menus();
    for (const menu of menus) {
      const items = menu.menuItems();
      for (const item of items) {
        const name = item.name();
        if (wanted.includes(name)) {
          item.click();
          return JSON.stringify({ clicked: true, menuItem: name });
        }
      }
    }
  }
  throw new Error('找不到网易云播放菜单项：' + wanted.join(' / '));
}
`;
}

export async function controlPlayback(action) {
  assertMac();
  const menuNames = CONTROL_MENU_NAMES[action];
  if (!menuNames) {
    throw new Error(`不支持的播放动作：${action}`);
  }

  if (!(await runBoolean('/usr/bin/pgrep', ['-x', PROCESS_NAME]))) {
    throw new Error('网易云音乐尚未运行，请先调用 netease_launch。');
  }

  try {
    const { stdout } = await run('/usr/bin/osascript', [
      '-l',
      'JavaScript',
      '-e',
      buildMenuControlScript(menuNames),
    ]);
    return { action, controlled: true, detail: stdout || null };
  } catch (error) {
    const detail = error?.stderr || error?.message || String(error);
    if (/not authorized|不允许|辅助|assistive|1002|-1743/i.test(detail)) {
      throw new Error(
        'macOS 尚未允许播放器自动化。请到“系统设置 → 隐私与安全性 → 辅助功能/自动化”允许 Codex 或 Node 控制 System Events。',
      );
    }
    throw new Error(`播放器控制失败：${detail}`);
  }
}

export async function nextTrackDirect() {
  assertMac();
  if (!(await runBoolean('/usr/bin/pgrep', ['-x', PROCESS_NAME]))) {
    throw new Error('网易云音乐尚未运行，请先调用 netease_launch。');
  }

  try {
    const helper = await ensureMediaRemoteHelper();
    const { stdout } = await run(helper, ['next']);
    const detail = JSON.parse(stdout);
    if (!detail.accepted) {
      throw new Error('macOS 未接受下一首命令。');
    }
    return {
      action: 'next',
      controlled: true,
      method: 'macos_media_remote',
      uiAutomation: false,
      roomControl: false,
    };
  } catch (error) {
    const detail = error?.stderr || error?.message || String(error);
    throw new Error(`普通播放下一首失败：${detail}`);
  }
}
