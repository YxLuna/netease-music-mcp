#!/usr/bin/env node
// 扫码登录：终端里出二维码，用网易云 App 扫一下、在手机上点确认，
// 程序自动只把 MUSIC_U 和 __csrf 存进 600 权限的会话文件。全程不打印 Cookie。
//
// 用法：
//   npm run login:qr                          # 存到 NETEASE_MCP_COOKIE_FILE
//   npm run login:qr -- --out ./netease.cookie
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import qrcode from 'qrcode-terminal';

import { checkQrLogin, saveSessionFile, startQrLogin } from '../src/qr-login.js';
import { getAuthenticatedAccount } from '../src/playlist.js';

const POLL_MS = 2_000;
const MAX_CODES = 3;   // 过期最多换 3 次码

function outputPath() {
  const index = process.argv.indexOf('--out');
  const path = index >= 0 ? process.argv[index + 1] : process.env.NETEASE_MCP_COOKIE_FILE;
  if (!path) {
    console.error('请用 --out <文件> 指定会话文件，或先设置 NETEASE_MCP_COOKIE_FILE。');
    process.exit(2);
  }
  return resolve(path);
}

async function main() {
  const path = outputPath();
  for (let round = 1; round <= MAX_CODES; round += 1) {
    const { key, url } = await startQrLogin();
    console.log('\n用网易云音乐 App 扫下面的二维码（App 首页左上角菜单 → 扫一扫），然后在手机上点「确认登录」：\n');
    qrcode.generate(url, { small: true }, (text) => console.log(text));
    let announced = false;
    for (;;) {
      await sleep(POLL_MS);
      const result = await checkQrLogin(key);
      if (result.state === 'scanned' && !announced) {
        console.log(`已扫码${result.nickname ? `（${result.nickname}）` : ''}，请在手机上确认……`);
        announced = true;
      } else if (result.state === 'expired') {
        console.log(round < MAX_CODES ? '二维码过期了，换一个新的。' : '二维码过期了。');
        break;
      } else if (result.state === 'ok') {
        await saveSessionFile(path, result.cookieHeader);
        console.log(`登录成功，会话已保存到 ${path}（权限 600）。`);
        await reportAccount(path);
        return;
      } else if (result.state === 'unknown') {
        throw new Error(`网易云返回了未知状态（code ${result.code}）。`);
      }
    }
  }
  console.error('没有完成扫码，请重新运行。');
  process.exit(1);
}

// 顺便读一次账号，告诉用户是不是会员；失败不影响登录结果
async function reportAccount(path) {
  try {
    process.env.NETEASE_MCP_COOKIE_FILE = path;
    process.env.NETEASE_MCP_ACCOUNT_WRITE_ENABLED = '1';
    const account = await getAuthenticatedAccount();
    console.log(`当前账号：${account.nickname || account.userId}，${account.isVip ? `会员（vipType ${account.vipType}）` : '不是会员（vipType 0）'}。`);
  } catch (error) {
    console.log(`会话已保存，但读取账号信息失败：${error instanceof Error ? error.message : error}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
