import test from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv } from 'node:crypto';

import {
  getCloudSongs,
  getDailyRecommendSongs,
  getLikedSongs,
  getPlaylistTracks,
  getPlayRecord,
  getRecommendPlaylists,
  getSimilarSongs,
  listAccountPlaylists,
  setPlaylistSubscribed,
  setSongLiked,
} from '../src/playlist.js';

const EAPI_KEY = Buffer.from('e82ckenh8dichen8', 'utf8');
const ACCOUNT_ID = '1001';

function decodeEapiBody(body) {
  const hex = new URLSearchParams(body).get('params');
  const decipher = createDecipheriv('aes-128-ecb', EAPI_KEY, null);
  const text = Buffer.concat([decipher.update(Buffer.from(hex, 'hex')), decipher.final()]).toString('utf8');
  const [apiPath, payload] = text.split('-36cd479b6b5-');
  return { apiPath, payload: JSON.parse(payload) };
}

function rawSong(id, name = `歌${id}`) {
  return { id: Number(id), name, ar: [{ name: '歌手' }], al: { name: '专辑' }, dt: 200000 };
}

// 按 eapi 路径返回固定响应，并记录每次调用的解密参数。
function fakeNetease(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const { apiPath, payload } = decodeEapiBody(init.body);
    assert.equal(new URL(url).pathname, apiPath.replace(/^\/api\//, '/eapi/'));
    calls.push({ apiPath, payload });
    const route = apiPath === '/api/w/nuser/account/get'
      ? () => ({ profile: { userId: Number(ACCOUNT_ID), nickname: '汐汐' }, account: { vipType: 11 } })
      : routes[apiPath];
    if (!route) throw new Error(`unexpected path ${apiPath}`);
    const body = { code: 200, ...route(payload) };
    return { ok: true, status: 200, json: async () => body };
  };
  const options = {
    fetchImpl,
    sessionProvider: async () => ({ cookieHeader: 'MUSIC_U=test', csrfToken: 'csrf' }),
  };
  return { calls, options };
}

const USER_PLAYLISTS = {
  '/api/user/playlist': () => ({
    playlist: [
      { id: 1, name: '我喜欢的音乐', userId: Number(ACCOUNT_ID), specialType: 5, trackCount: 3 },
      { id: 2, name: '跑步', userId: Number(ACCOUNT_ID), trackCount: 10 },
      { id: 3, name: '别人的歌单', userId: 42, subscribed: true, creator: { nickname: '路人' } },
    ],
  }),
};

test('lists created, subscribed or all playlists', async () => {
  const { options } = fakeNetease(USER_PLAYLISTS);
  const created = await listAccountPlaylists('created', options);
  assert.deepEqual(created.playlists.map((p) => p.id), ['1', '2']);
  assert.equal(created.playlists[0].specialType, 5);

  const subscribed = await listAccountPlaylists('subscribed', options);
  assert.deepEqual(subscribed.playlists.map((p) => p.id), ['3']);
  assert.equal(subscribed.playlists[0].subscribed, true);
  assert.equal(subscribed.playlists[0].creator, '路人');

  assert.equal((await listAccountPlaylists('all', options)).playlists.length, 3);
  await assert.rejects(listAccountPlaylists('everything', options), /include/);
});

test('reads playlist tracks page in playlist order', async () => {
  const { calls, options } = fakeNetease({
    '/api/v6/playlist/detail': () => ({
      playlist: { id: 2, name: '跑步', trackCount: 4, trackIds: [{ id: 11 }, { id: 12 }, { id: 13 }, { id: 14 }] },
    }),
    // 故意打乱返回顺序，结果仍应按 trackIds 排列
    '/api/v3/song/detail': () => ({ songs: [rawSong(13), rawSong(12)] }),
  });
  const result = await getPlaylistTracks('2', { limit: 2, offset: 1 }, options);
  assert.equal(result.total, 4);
  assert.equal(result.hasMore, true);
  assert.deepEqual(result.songs.map((song) => song.id), [12, 13]);
  assert.deepEqual(result.songs[0].artists, ['歌手']);
  const detailCall = calls.find((call) => call.apiPath === '/api/v3/song/detail');
  assert.deepEqual(JSON.parse(detailCall.payload.c), [{ id: 12 }, { id: 13 }]);
  await assert.rejects(getPlaylistTracks('2', { limit: 501 }, options), /limit/);
  await assert.rejects(getPlaylistTracks('../2', {}, options), /歌单 ID/);
});

test('reads liked songs as ids or detailed pages', async () => {
  const { calls, options } = fakeNetease({
    '/api/song/like/get': () => ({ ids: [21, 22, 23] }),
    '/api/v3/song/detail': ({ c }) => ({ songs: JSON.parse(c).map(({ id }) => rawSong(id)) }),
  });
  assert.deepEqual(await getLikedSongs({ idsOnly: true }, options), {
    total: 3,
    songIds: ['21', '22', '23'],
  });
  assert.equal(calls.find((call) => call.apiPath === '/api/song/like/get').payload.uid, ACCOUNT_ID);

  const page = await getLikedSongs({ limit: 2, offset: 0 }, options);
  assert.deepEqual(page.songs.map((song) => song.id), [21, 22]);
  assert.equal(page.hasMore, true);
});

test('reads weekly or all-time play records', async () => {
  const { calls, options } = fakeNetease({
    '/api/v1/play/record': ({ type }) => (type === 1
      ? { weekData: [{ playCount: 9, score: 100, song: rawSong(31) }] }
      : { allData: [{ playCount: 99, score: 100, song: rawSong(32) }] }),
  });
  const week = await getPlayRecord('week', options);
  assert.equal(week.songs[0].id, 31);
  assert.equal(week.songs[0].playCount, 9);
  assert.equal((await getPlayRecord('all', options)).songs[0].id, 32);
  assert.deepEqual(calls.filter((c) => c.apiPath === '/api/v1/play/record').map((c) => c.payload.type), [1, 0]);
  await assert.rejects(getPlayRecord('month', options), /period/);
});

test('reads daily songs with reasons, similar songs and recommended playlists', async () => {
  const { options } = fakeNetease({
    '/api/v3/discovery/recommend/songs': () => ({
      data: { dailySongs: [rawSong(41), rawSong(42)], recommendReasons: [{ songId: 41, reason: '超 80% 人播放' }] },
    }),
    '/api/v1/discovery/simiSong': ({ songid }) => ({
      songs: [{ id: 51, name: `像${songid}`, artists: [{ name: 'A' }], album: { name: 'B' } }],
    }),
    '/api/v1/discovery/recommend/resource': () => ({
      recommend: [{ id: 61, name: '推荐歌单', copywriter: '根据你喜欢的单曲推荐', trackCount: 30 }],
    }),
  });
  const daily = await getDailyRecommendSongs(options);
  assert.equal(daily.songs[0].reason, '超 80% 人播放');
  assert.equal(daily.songs[1].reason, null);

  const similar = await getSimilarSongs('41', 10, options);
  assert.equal(similar.seedSongId, '41');
  assert.equal(similar.songs[0].name, '像41');
  await assert.rejects(getSimilarSongs('41', 51, options), /limit/);

  const playlists = await getRecommendPlaylists(options);
  assert.equal(playlists.playlists[0].reason, '根据你喜欢的单曲推荐');
});

test('lists cloud disk songs with usage and paging', async () => {
  const { calls, options } = fakeNetease({
    '/api/v1/cloud/get': () => ({
      count: 3,
      size: 1024,
      maxSize: 4096,
      data: [
        { songId: 81, songName: '卡农-Rain-Piano', artist: '云汐', album: '', fileName: 'canon.mp3', fileSize: 512, addTime: 0 },
        { songId: 82, simpleSong: { id: 82, name: '晴天', ar: [{ name: '周杰伦' }], al: { name: '叶惠美' } } },
      ],
    }),
  });
  const result = await getCloudSongs({ limit: 2, offset: 0 }, options);
  assert.equal(result.total, 3);
  assert.equal(result.hasMore, true);
  assert.equal(result.usedBytes, 1024);
  assert.deepEqual(result.songs[0], {
    id: '81',
    name: '卡农-Rain-Piano',
    artists: ['云汐'],
    album: '',
    fileName: 'canon.mp3',
    sizeBytes: 512,
    uploadedAt: null,
  });
  assert.deepEqual(result.songs[1].artists, ['周杰伦']);
  assert.equal(result.songs[1].album, '叶惠美');
  assert.deepEqual(calls.find((call) => call.apiPath === '/api/v1/cloud/get').payload.limit, 2);
  await assert.rejects(getCloudSongs({ limit: 0 }, options), /limit/);
});

test('likes songs and subscribes only to playlists owned by others', async () => {
  const { calls, options } = fakeNetease({
    ...USER_PLAYLISTS,
    '/api/v1/playlist/manipulate/tracks': () => ({}),
    '/api/playlist/subscribe': () => ({}),
    '/api/playlist/unsubscribe': () => ({}),
  });
  assert.deepEqual(await setSongLiked('71', true, options), { updated: true, songId: '71', liked: true });
  await setSongLiked('71', false, options);
  const likeCalls = calls.filter((call) => call.apiPath === '/api/v1/playlist/manipulate/tracks');
  assert.deepEqual(likeCalls.map((call) => call.payload.op), ['add', 'del']);
  assert.equal(likeCalls[0].payload.pid, '1');
  assert.equal(likeCalls[0].payload.trackIds, '["71"]');
  await assert.rejects(setSongLiked('71', 'yes', options), /like/);

  assert.equal((await setPlaylistSubscribed('3', true, options)).subscribed, true);
  assert.equal((await setPlaylistSubscribed('3', false, options)).subscribed, false);
  await assert.rejects(setPlaylistSubscribed('2', true, options), /自己创建/);
});
