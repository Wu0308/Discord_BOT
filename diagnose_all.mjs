/**
 * Discord 音樂機器人 - 完整診斷腳本
 * 執行方式：node diagnose_all.mjs
 */
import 'dotenv/config';
import { execSync } from 'child_process';
import { config } from './config.js';

console.log('========================================');
console.log('  🎵 Discord 音樂機器人 - 完整診斷');
console.log('========================================\n');

// 1. 檢查 .env 設定
console.log('【1】📄 .env 設定檢查');
console.log('------------------------');

if (config.token) {
  const tokenPreview = config.token.substring(0, 20) + '...';
  console.log(`  ✅ DISCORD_TOKEN: ${tokenPreview}`);
  // 檢查 token 格式
  if (config.token.includes('.')) {
    console.log(`  ✅ Token 格式正確（包含點號分隔）`);
  } else {
    console.log(`  ❌ Token 格式異常！Discord token 應包含點號`);
    console.log(`     → 請到 Developer Portal → Bot → Reset Token → Copy`);
  }
} else {
  console.log(`  ❌ DISCORD_TOKEN 未設定！`);
}

console.log(`  ${config.token ? '✅' : '❌'} CLIENT_ID: ${process.env.CLIENT_ID || '未設定'}`);
console.log(`  ${process.env.GUILD_ID ? '✅' : 'ℹ️'} GUILD_ID: ${process.env.GUILD_ID || '未設定（全域註冊）'}`);

// 2. 檢查依賴套件
console.log('\n【2】📦 依賴套件檢查');
console.log('------------------------');

const deps = [
  ['discord.js', 'discord.js'],
  ['@discordjs/voice', '@discordjs/voice'],
  ['yt-search', 'yt-search'],
  ['yt-dlp (CLI)', null],
];

for (const [name, pkg] of deps) {
  try {
    if (pkg) {
      const mod = await import(pkg);
      const ver = mod.version || '✅';
      console.log(`  ✅ ${name} ${ver}`);
    } else {
      // yt-dlp CLI 檢查
      const ytdlpOut = execSync('yt-dlp --version', { encoding: 'utf8' }).trim();
      console.log(`  ✅ ${name} ${ytdlpOut}`);
    }
  } catch (e) {
    console.log(`  ❌ ${name} — ${e.message}`);
  }
}

// 3. 檢查 ffmpeg 與 yt-dlp
console.log('\n【3】🎬 FFmpeg & yt-dlp 檢查');
console.log('------------------------');

// 檢查 ffmpeg（Windows 通常內建於 yt-dlp 或系統 PATH）
try {
  execSync('ffmpeg -version', { stdio: 'ignore' });
  console.log('  ✅ ffmpeg 可用（於系統 PATH）');
} catch {
  console.log('  ⚠️ ffmpeg 未在 PATH 中找到（yt-dlp 內建版本可能仍可運作）');
}

// 檢查 yt-dlp
try {
  const ytdlpOut = execSync('yt-dlp --version', { encoding: 'utf8' }).trim();
  console.log(`  ✅ yt-dlp 版本: ${ytdlpOut}`);
} catch {
  console.log('  ❌ yt-dlp 未安裝！請執行：pip install -U yt-dlp');
}

// 4. 檢查 Node.js 版本相容性
console.log('\n【4】🔧 Node.js 環境');
console.log('------------------------');
console.log(`  Node.js: ${process.version}`);
console.log(`  平台: ${process.platform} ${process.arch}`);

const majorVer = parseInt(process.version.slice(1));
if (majorVer >= 24) {
  console.log(`  ⚠️ Node.js v24+ 可能與 @discordjs/voice 有 UDP 相容性問題`);
  console.log(`     如果語音連線失敗，建議降版到 Node.js v22 LTS`);
} else if (majorVer >= 20) {
  console.log(`  ⚠️ Node.js v20+ 可能與 @discordjs/voice 有相容性問題`);
  console.log(`     如果持續失敗，建議降版到 Node.js v18 LTS`);
}

// 5. 防火牆檢查
console.log('\n【5】🛡️ 防火牆建議');
console.log('------------------------');
console.log(`  Windows Defender 防火牆可能封鎖 Discord 語音連線`);
console.log(``);
console.log(`  🔧 解決方法 A：暫時關閉防火牆測試`);
console.log(`     搜尋「防火牆」→ 關閉 Windows Defender 防火牆`);
console.log(`     → 測試 /play → 如果能播，就是防火牆問題`);
console.log(``);
console.log(`  🔧 解決方法 B：以系統管理員執行`);
console.log(`     在終端機按右鍵 → 「以系統管理員身分執行」`);
console.log(`     → 輸入: npm start`);
console.log(``);
console.log(`  🔧 解決方法 C：手動允許 Node.js`);
console.log(`     搜尋「防火牆」→ 「允許應用程式通過防火牆」`);
console.log(`     → 「變更設定」→ 「允許其他應用程式」`);
console.log(`     → 選 C:\\Program Files\\nodejs\\node.exe`);
console.log(`     → ✅ 私人 + ✅ 公用 都打勾`);

// 6. Discord 開發者設定檢查清單
console.log('\n【6】☑️  Discord 開發者後台檢查清單');
console.log('------------------------');
console.log(`  請到 https://discord.com/developers/applications`);
console.log(`  → 點你的應用程式 (MyBOT)`);
console.log(``);
console.log(`  🔴 Bot 頁面：`);
console.log(`     ☐ ✅ Privileged Gateway Intents`);
console.log(`         → VOICE STATES INTENT 已打勾？ ${'← 最常見遺漏！'}`);
console.log(`         → MESSAGE CONTENT INTENT 已打勾？`);
console.log(``);
console.log(`  🔴 OAuth2 → URL Generator 頁面：`);
console.log(`     用這個連結重新邀請機器人：`);
console.log(`     https://discord.com/api/oauth2/authorize?client_id=${process.env.CLIENT_ID || '你的CLIENT_ID'}&permissions=7688256&scope=bot%20applications.commands`);
console.log(``);
console.log(`    這個連結包含的權限：`);
console.log(`    ✅ Send Messages    ✅ Embed Links`);
console.log(`    ✅ Read Message History`);
console.log(`    ✅ Connect (語音連線)  ← ⭐`);
console.log(`    ✅ Speak (語音講話)    ← ⭐`);
console.log(`    ✅ Use Voice Activity`);

// 7. 總結
console.log('\n========================================');
console.log('  📝 診斷總結');
console.log('========================================\n');

console.log(`  如果以上所有檢查都通過，最可能的原因是防火牆。`);
console.log(`  請優先嘗試：`);
console.log(`  1️⃣ 關閉 Windows 防火牆（測試用）`);
console.log(`  2️⃣ 以系統管理員身分執行 npm start`);
console.log(`  3️⃣ 確認 VOICE STATES INTENT 有打勾`);
console.log(`  4️⃣ 用正確連結重新邀請機器人`);
console.log(``);

process.exit(0);
