import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkQrLogin, encryptWeapi, pickSessionCookies, saveSessionFile, startQrLogin } from '../src/qr-login.js';
import { getAccountStatus } from '../src/playlist.js';

function fakeFetch(json, setCookie = [], calls = []) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => json,
      headers: { getSetCookie: () => setCookie },
    };
  };
}

test('weapi body has params and a 256-hex encSecKey', () => {
  const body = encryptWeapi({ type: 1 });
  assert.ok(body.get('params').length > 20);
  assert.match(body.get('encSecKey'), /^[0-9a-f]{256}$/);
});

test('QR login start returns key and codekey link, sends os=pc cookie', async () => {
  const calls = [];
  const result = await startQrLogin({ fetchImpl: fakeFetch({ code: 200, unikey: 'abcd-1234-efgh' }, [], calls) });
  assert.equal(result.key, 'abcd-1234-efgh');
  assert.equal(result.url, 'https://music.163.com/login?codekey=abcd-1234-efgh');
  assert.equal(calls[0].url, 'https://music.163.com/weapi/login/qrcode/unikey?csrf_token=');
  assert.match(calls[0].init.headers.Cookie, /os=pc; appver=/);
});

test('QR login status maps 800/801/802 without touching cookies', async () => {
  for (const [code, state] of [[800, 'expired'], [801, 'waiting'], [802, 'scanned']]) {
    const result = await checkQrLogin('abcd-1234-efgh', { fetchImpl: fakeFetch({ code, nickname: code === 802 ? 'someone' : undefined }) });
    assert.equal(result.state, state);
    assert.equal(result.cookieHeader, undefined);
  }
});

test('QR login 803 keeps only MUSIC_U and __csrf', async () => {
  const setCookie = [
    'MUSIC_U=secret-value; Max-Age=1296000; Path=/; HttpOnly',
    '__csrf=csrf-value; Max-Age=1296010; Path=/',
    'NMTID=device; Path=/',
    'MUSIC_A_T=other; Path=/',
  ];
  const result = await checkQrLogin('abcd-1234-efgh', { fetchImpl: fakeFetch({ code: 803 }, setCookie) });
  assert.equal(result.state, 'ok');
  assert.equal(result.cookieHeader, 'MUSIC_U=secret-value; __csrf=csrf-value');
});

test('QR login 803 without MUSIC_U is an error', async () => {
  await assert.rejects(checkQrLogin('abcd-1234-efgh', { fetchImpl: fakeFetch({ code: 803 }, ['__csrf=x; Path=/']) }), /MUSIC_U/);
});

test('cookie picker ignores empty values', () => {
  assert.deepEqual([...pickSessionCookies(['MUSIC_U=; Path=/', '__csrf=a; Path=/'])], [['__csrf', 'a']]);
});

test('session file is written with 600 permission, even if it existed', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX permissions only');
  const dir = await mkdtemp(join(tmpdir(), 'netease-qr-'));
  const file = join(dir, 'netease.cookie');
  await writeFile(file, 'old', { mode: 0o644 });
  await saveSessionFile(file, 'MUSIC_U=a; __csrf=b');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(await readFile(file, 'utf8'), 'MUSIC_U=a; __csrf=b\n');
  await rm(dir, { recursive: true, force: true });
});

test('account status reports vipType and isVip', async () => {
  const session = async () => ({ cookieHeader: 'MUSIC_U=a; __csrf=b', csrfToken: 'b' });
  const vip = await getAccountStatus({
    sessionProvider: session,
    fetchImpl: fakeFetch({ code: 200, account: { id: 1, vipType: 11 }, profile: { userId: 1, nickname: 'n' } }),
  });
  assert.deepEqual(vip, { loggedIn: true, nickname: 'n', vipType: 11, isVip: true });
  const plain = await getAccountStatus({
    sessionProvider: session,
    fetchImpl: fakeFetch({ code: 200, account: { id: 2, vipType: 0 }, profile: { userId: 2, nickname: 'm' } }),
  });
  assert.equal(plain.isVip, false);
});
