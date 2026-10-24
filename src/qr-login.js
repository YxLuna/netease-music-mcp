import { constants, createCipheriv, publicEncrypt, randomBytes } from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';

import { serializeSessionCookies } from './session.js';

// 扫码登录走网页版 weapi：固定密钥、IV 和 RSA 模数都是网易云网页端公开的参数。
const API_ORIGIN = 'https://music.163.com';
const PRESET_KEY = Buffer.from('0CoJUm6Qyw8W8jud', 'utf8');
const IV = Buffer.from('0102030405060708', 'utf8');
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const RSA_MODULUS =
  '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7';
const RSA_EXPONENT = '010001';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
// 不带 os/appver 时服务器会把请求当成普通网页访客，会员账号也可能只给试听或低码率。
const CLIENT_COOKIE = 'os=pc; appver=2.10.13';

const STATES = { 800: 'expired', 801: 'waiting', 802: 'scanned', 803: 'ok' };

function aes(text, key) {
  const cipher = createCipheriv('aes-128-cbc', key, IV);
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64');
}

function rsaPublicKey() {
  const n = Buffer.from(RSA_MODULUS, 'hex').subarray(1);
  return { key: { kty: 'RSA', n: n.toString('base64url'), e: Buffer.from(RSA_EXPONENT, 'hex').toString('base64url') }, format: 'jwk' };
}

// 网易云的 RSA 是「密钥倒序、无填充」的老写法
function rsaNoPadding(secretKey) {
  const reversed = Buffer.from([...secretKey].reverse().join(''), 'utf8');
  const block = Buffer.alloc(128);
  reversed.copy(block, 128 - reversed.length);
  return publicEncrypt({ ...rsaPublicKey(), padding: constants.RSA_NO_PADDING }, block).toString('hex');
}

export function encryptWeapi(payload) {
  const secretKey = Array.from(randomBytes(16), (byte) => BASE62[byte % 62]).join('');
  return new URLSearchParams({
    params: aes(aes(JSON.stringify(payload), PRESET_KEY), Buffer.from(secretKey, 'utf8')),
    encSecKey: rsaNoPadding(secretKey),
  });
}

export function pickSessionCookies(setCookieLines = []) {
  const selected = new Map();
  for (const line of setCookieLines) {
    const match = String(line).match(/^\s*(MUSIC_U|__csrf)=([^;]*)/);
    if (match && match[2]) selected.set(match[1], match[2]);
  }
  return selected;
}

async function requestWeapi(apiPath, payload, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(new URL(`/weapi${apiPath}?csrf_token=`, API_ORIGIN), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: CLIENT_COOKIE,
      Referer: `${API_ORIGIN}/`,
      'User-Agent': USER_AGENT,
    },
    body: encryptWeapi({ ...payload, csrf_token: '' }).toString(),
    redirect: 'error',
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`网易云登录接口返回 HTTP ${response.status}`);
  const json = await response.json();
  const setCookie = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  return { json, setCookie };
}

/** 第 1 步：要一个登录码，返回 key 和要画成二维码的链接 */
export async function startQrLogin(options = {}) {
  const { json } = await requestWeapi('/login/qrcode/unikey', { type: 1 }, options);
  if (!json?.unikey) throw new Error(`取不到登录码（code ${json?.code ?? 'unknown'}）`);
  return { key: json.unikey, url: `${API_ORIGIN}/login?codekey=${json.unikey}` };
}

/**
 * 第 2 步：问一次扫码状态。state 为 waiting / scanned / expired / ok。
 * ok 时带回只含 MUSIC_U 和 __csrf 的 cookie 串（调用方负责存进 600 文件，不要打印）。
 */
export async function checkQrLogin(key, options = {}) {
  if (!/^[\w-]{8,128}$/.test(String(key ?? ''))) throw new Error('登录码格式无效。');
  const { json, setCookie } = await requestWeapi('/login/qrcode/client/login', { key, type: 1 }, options);
  const code = Number(json?.code);
  const state = STATES[code] ?? 'unknown';
  if (state !== 'ok') return { state, code, nickname: json?.nickname ?? null };
  const cookies = pickSessionCookies(setCookie);
  return { state, code, cookieHeader: serializeSessionCookies(cookies) };
}

/** 把会话写进只有自己能读的文件（600），与 NETEASE_MCP_COOKIE_FILE 的格式一致 */
export async function saveSessionFile(path, cookieHeader) {
  await writeFile(path, `${cookieHeader}\n`, { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') await chmod(path, 0o600);   // 文件原来就在时 mode 不生效
}
