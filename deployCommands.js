/**
 * 註冊斜線指令到 Discord
 * 
 * 使用方法：
 *   npm run deploy
 *   或
 *   node deployCommands.js
 * 
 * 需要先在 .env 中設定：
 *   DISCORD_TOKEN=你的機器人TOKEN
 *   CLIENT_ID=你的應用程式ID
 * 
 * 選擇性（開發用，註冊到單一伺服器即時生效）：
 *   GUILD_ID=你的伺服器ID
 */
import 'dotenv/config';
import { REST, Routes, ApplicationCommandOptionType } from 'discord.js';
import { config } from './config.js';

const commands = [
  // ===== 音樂指令 =====
  {
    name: 'play',
    description: '🎵 播放音樂（支援 YouTube 連結或關鍵字搜尋）',
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: 'query',
        description: 'YouTube URL 或搜尋關鍵字',
        required: true,
      },
    ],
  },
  {
    name: 'skip',
    description: '⏭️ 跳過目前正在播放的歌曲',
  },
  {
    name: 'stop',
    description: '⏹️ 停止播放並清空佇列',
  },
  {
    name: 'pause',
    description: '⏸️ 暫停播放',
  },
  {
    name: 'resume',
    description: '▶️ 恢復播放',
  },
  {
    name: 'queue',
    description: '📋 顯示目前的播放佇列',
  },
  {
    name: 'nowplaying',
    description: '🎶 顯示目前正在播放的歌曲資訊',
  },
  {
    name: 'loop',
    description: '🔁 切換循環模式 (關閉/單曲/佇列)',
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: 'mode',
        description: '循環模式',
        required: true,
        choices: [
          { name: '❌ 關閉循環', value: 'none' },
          { name: '🔂 單曲循環', value: 'one' },
          { name: '🔁 佇列循環', value: 'queue' },
        ],
      },
    ],
  },
  {
    name: 'volume',
    description: '🔊 設定音量 (0-100)',
    options: [
      {
        type: ApplicationCommandOptionType.Integer,
        name: 'level',
        description: '音量大小 (0-100)',
        required: true,
        min_value: 0,
        max_value: 100,
      },
    ],
  },
  {
    name: 'leave',
    description: '👋 離開語音頻道並清空佇列',
  },
  {
    name: 'shuffle',
    description: '🔀 隨機打亂播放佇列',
  },
  {
    name: 'remove',
    description: '🗑️ 移除佇列中指定位置的歌曲',
    options: [
      {
        type: ApplicationCommandOptionType.Integer,
        name: 'position',
        description: '歌曲在佇列中的位置（從 1 開始）',
        required: true,
        min_value: 1,
      },
    ],
  },
  {
    name: 'diagnose',
    description: '🔍 診斷機器人語音連線狀態',
  },
  // ===== 實用指令 =====
  {
    name: 'help',
    description: '📖 顯示所有可用指令及使用說明',
  },
  {
    name: 'ping',
    description: '🏓 檢查機器人延遲',
    options: [
      {
        type: ApplicationCommandOptionType.Boolean,
        name: 'hidden',
        description: '是否只讓自己看到回覆',
        required: false,
      },
    ],
  },
];

async function deploy() {
  if (!config.token) {
    console.error('❌ 錯誤：未設定 DISCORD_TOKEN！');
    console.error('📝 請先將 .env.example 複製為 .env，並填入你的 Discord Bot Token');
    process.exit(1);
  }

  const clientId = process.env.CLIENT_ID;
  if (!clientId) {
    console.error('❌ 錯誤：未設定 CLIENT_ID！');
    console.error('📝 請在 .env 中加入 CLIENT_ID=你的應用程式ID');
    console.error('🔍 可在 Discord Developer Portal → General Information → Application ID 找到');
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(config.token);

  try {
    console.log('🔄 正在註冊斜線指令...\n');

    let data;

    if (process.env.GUILD_ID) {
      // 註冊到特定伺服器（開發用，立即生效）
      console.log(`📍 目標伺服器：${process.env.GUILD_ID}`);
      data = await rest.put(
        Routes.applicationGuildCommands(clientId, process.env.GUILD_ID),
        { body: commands },
      );
      console.log('✅ 已註冊到指定伺服器（即時生效）\n');
    } else {
      // 全域註冊（所有加入的伺服器，快取需最多 1 小時）
      data = await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands },
      );
      console.log('✅ 已全域註冊（全球快取可能需要 1 小時才會更新）\n');
    }

    console.log(`📋 成功註冊 ${data.length} 個斜線指令：`);
    const categories = {
      '🎵 音樂播放': ['play', 'skip', 'stop', 'pause', 'resume'],
      '📋 佇列管理': ['queue', 'nowplaying', 'shuffle', 'remove', 'loop', 'volume'],
      '⚙️ 其他': ['leave', 'help', 'ping', 'diagnose'],
    };

    for (const [category, cmds] of Object.entries(categories)) {
      console.log(`  ${category}:`);
      for (const c of data) {
        if (cmds.includes(c.name)) {
          console.log(`    /${c.name} - ${c.description}`);
        }
      }
      console.log('');
    }
  } catch (error) {
    console.error('❌ 註冊失敗：', error.message);
    if (error.code === 50001) {
      console.error('💡 提示：請確認機器人已加入伺服器，且 OAuth2 有勾選 applications.commands 範圍');
    }
    process.exit(1);
  }
}

deploy();
