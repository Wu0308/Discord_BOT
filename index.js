/**
 * Discord 音樂機器人主程式
 * 
 * 功能：
 * - 🎵 播放 YouTube 音樂（URL 或關鍵字搜尋）
 * - 📋 播放佇列管理
 * - 🔁 循環播放（單曲/佇列）
 * - ⏸️ 暫停/繼續
 * - ⏭️ 跳過歌曲
 * - 🔊 音量控制
 * - 🔀 隨機播放
 * - ⏹️ 停止播放
 */
import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  ActivityType,
  EmbedBuilder,
} from 'discord.js';
import { config } from './config.js';
import { queueManager } from './queueManager.js';
import { musicPlayer } from './musicPlayer.js';

// 建立 Discord 客戶端
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// ===== 機器人啟動事件 =====
client.once('clientReady', async () => {
  console.log(`✅ 機器人已上線！`);
  console.log(`🤖 名稱：${client.user.tag}`);
  console.log(`🆔 ID：${client.user.id}`);
  console.log(`🌐 伺服器數量：${client.guilds.cache.size}`);
  console.log(`👥 使用者數量：${client.users.cache.size}`);

  // 檢查語音相關依賴
  try {
    const { getVoiceConnection } = await import('@discordjs/voice');
    console.log('✅ @discordjs/voice 載入成功');
  } catch (e) {
    console.error('❌ @discordjs/voice 載入失敗：', e.message);
  }

  try {
    await import('@discordjs/opus');
    console.log('✅ @discordjs/opus 載入成功');
  } catch (e) {
    console.warn('⚠️ @discordjs/opus 未安裝，將嘗試使用 opusscript');
  }

  try {
    await import('tweetnacl');
    console.log('✅ tweetnacl 載入成功');
  } catch (e) {
    console.warn('⚠️ tweetnacl 未安裝，語音加密可能無法運作');
  }

  // 設定狀態
  client.user.setPresence({
    activities: [{
      name: config.statusMessage,
      type: ActivityType.Custom,
    }],
    status: 'online',
  });
});

// ===== 斜線指令處理 =====
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, member, guild, channel } = interaction;

  try {
    switch (commandName) {
      case 'play':     await handlePlay(interaction); break;
      case 'skip':     await handleSkip(interaction); break;
      case 'stop':     await handleStop(interaction); break;
      case 'pause':    await handlePause(interaction); break;
      case 'resume':   await handleResume(interaction); break;
      case 'queue':    await handleQueue(interaction); break;
      case 'nowplaying': await handleNowPlaying(interaction); break;
      case 'loop':     await handleLoop(interaction); break;
      case 'volume':   await handleVolume(interaction); break;
      case 'leave':    await handleLeave(interaction); break;
      case 'shuffle':  await handleShuffle(interaction); break;
      case 'remove':   await handleRemove(interaction); break;
      case 'diagnose': await handleDiagnose(interaction); break;
      case 'help':     await handleHelp(interaction); break;
      case 'ping':     await handlePing(interaction); break;
      default:
        await interaction.reply({ content: '❌ 未知的指令', ephemeral: true });
    }
  } catch (error) {
    console.error(`[Command Error] /${commandName}:`, error.message);
    try {
      if (interaction.deferred) {
        await interaction.editReply({ content: `❌ 執行指令時發生錯誤：${error.message}` });
      } else if (!interaction.replied) {
        await interaction.reply({ content: `❌ 執行指令時發生錯誤：${error.message}`, flags: 64 });
      } else {
        await interaction.followUp({ content: `❌ 執行指令時發生錯誤：${error.message}`, flags: 64 });
      }
    } catch { /* interaction might be expired */ }
  }
});

// ===== 指令處理函式 =====

/**
 * /play - 播放音樂
 */
async function handlePlay(interaction) {
  const query = interaction.options.getString('query');

  // 不延遲回覆，直接開始處理
  await interaction.reply({ content: '🔍 搜尋中...', flags: 64 }).catch(() => {});

  // 加入語音頻道
  const joined = await musicPlayer.join(interaction.member, interaction.channel);
  if (!joined) {
    return interaction.editReply('❌ 無法加入語音頻道！').catch(() => {});
  }

  // 搜尋歌曲
  const song = await musicPlayer.search(query);
  if (!song) {
    return interaction.editReply('❌ 找不到該歌曲，請檢查網址或關鍵字是否正確。').catch(() => {});
  }

  const guildId = interaction.guildId;
  const queue = queueManager.get(guildId);

  // 加上要求者資訊
  song.requestedBy = interaction.user.toString();

  // 如果正在播放，加入佇列；否則直接播放
  if (queue.isPlaying) {
    const pos = queueManager.addSong(guildId, song);
    const embed = new EmbedBuilder()
      .setColor(config.colors.info)
      .setTitle('📥 已加入佇列')
      .setDescription(`[${song.title}](${song.url})`)
      .setThumbnail(song.thumbnail)
      .addFields(
        { name: '⏱️ 時長', value: song.duration, inline: true },
        { name: '📌 位置', value: `第 ${pos} 首`, inline: true },
        { name: '👤 要求者', value: song.requestedBy, inline: true },
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] }).catch(() => {});
  } else {
    queueManager.addSong(guildId, song);
    await interaction.editReply(`✅ 已開始播放 **${song.title}**，請稍候...`).catch(() => {});
    await musicPlayer.playSong(guildId, song, interaction.channel);
  }
}

/**
 * /skip - 跳過目前歌曲
 */
async function handleSkip(interaction) {
  await interaction.deferReply().catch(() => {});
  const guildId = interaction.guildId;
  const queue = queueManager.get(guildId);

  if (!queue.isPlaying || !queue.currentSong) {
    return interaction.editReply('❌ 目前沒有正在播放的歌曲。');
  }

  musicPlayer.skip(guildId);
  await interaction.editReply(`⏭️ 已跳過 **${queue.currentSong.title}**`);
}

/**
 * /stop - 停止播放並清空佇列
 */
async function handleStop(interaction) {
  await interaction.deferReply().catch(() => {});
  const guildId = interaction.guildId;
  const queue = queueManager.get(guildId);

  if (!queue.isPlaying && queue.songs.length === 0) {
    return interaction.editReply('❌ 目前沒有播放中的歌曲。');
  }

  const songTitle = queue.currentSong?.title || '';
  musicPlayer.stop(guildId);
  await interaction.editReply(`⏹️ 已停止播放${songTitle ? ` **${songTitle}**` : ''}，並清空佇列。`);
}

/**
 * /pause - 暫停播放
 */
async function handlePause(interaction) {
  await interaction.deferReply().catch(() => {});
  const guildId = interaction.guildId;
  const queue = queueManager.get(guildId);

  if (!queue.isPlaying) {
    return interaction.editReply('❌ 沒有正在播放的歌曲可以暫停。');
  }

  musicPlayer.pause(guildId);
  await interaction.editReply('⏸️ 已暫停播放。使用 `/resume` 繼續播放。');
}

/**
 * /resume - 恢復播放
 */
async function handleResume(interaction) {
  await interaction.deferReply().catch(() => {});
  const guildId = interaction.guildId;
  const queue = queueManager.get(guildId);

  if (queue.isPlaying) {
    return interaction.editReply('❌ 播放器正在播放中。');
  }
  if (!queue.currentSong) {
    return interaction.editReply('❌ 佇列中沒有歌曲。');
  }

  musicPlayer.resume(guildId);
  await interaction.editReply(`▶️ 已恢復播放 **${queue.currentSong.title}**`);
}

/**
 * /queue - 顯示播放佇列
 */
async function handleQueue(interaction) {
  await interaction.deferReply().catch(() => {});
  const guildId = interaction.guildId;
  const queue = queueManager.get(guildId);
  const status = queueManager.getStatus(guildId);

  if (!status.currentSong && status.queueLength === 0) {
    return interaction.editReply('📋 佇列是空的。使用 `/play` 來加入歌曲！');
  }

  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle('📋 播放佇列')
    .setTimestamp();

  // 目前播放
  if (status.currentSong) {
    embed.addFields({
      name: '🎵 正在播放',
      value: `[${status.currentSong.title}](${status.currentSong.url})\n` +
             `⏱️ ${status.currentSong.duration} | 👤 ${status.currentSong.requestedBy}\n` +
             `${musicPlayer.getProgress(guildId)}`,
    });
  }

  // 循環狀態
  let loopStatus = '❌ 關閉';
  if (status.isLooping) loopStatus = '🔂 單曲循環';
  if (status.isLoopQueue) loopStatus = '🔁 佇列循環';

  // 佇列列表
  if (status.queueLength > 0) {
    const songs = queue.songs;
    let queueList = '';
    for (let i = 0; i < Math.min(songs.length, 15); i++) {
      queueList += `**${i + 1}.** [${songs[i].title}](${songs[i].url}) \`${songs[i].duration}\`\n`;
    }
    if (songs.length > 15) {
      queueList += `\n...以及其他 ${songs.length - 15} 首歌曲`;
    }
    embed.addFields(
      { name: `📌 即將播放 (共 ${status.queueLength} 首)`, value: queueList },
    );
  }

  embed.addFields(
    { name: '🔊 音量', value: `${status.volume}%`, inline: true },
    { name: '🔁 循環', value: loopStatus, inline: true },
  );

  embed.setFooter({ text: `🔊 音量: ${status.volume}% | ${loopStatus}` });
  await interaction.editReply({ embeds: [embed] });
}

/**
 * /nowplaying - 顯示目前播放資訊
 */
async function handleNowPlaying(interaction) {
  await interaction.deferReply().catch(() => {});
  const guildId = interaction.guildId;
  const status = queueManager.getStatus(guildId);

  if (!status.currentSong) {
    return interaction.editReply('❌ 目前沒有正在播放的歌曲。');
  }

  const embed = new EmbedBuilder()
    .setColor(config.colors.success)
    .setTitle('🎵 正在播放')
    .setDescription(`[${status.currentSong.title}](${status.currentSong.url})`)
    .setThumbnail(status.currentSong.thumbnail)
    .addFields(
      { name: '⏱️ 時長', value: status.currentSong.duration, inline: true },
      { name: '👤 要求者', value: status.currentSong.requestedBy, inline: true },
      { name: '🔊 音量', value: `${status.volume}%`, inline: true },
      { name: '📋 佇列', value: `還有 ${status.queueLength} 首`, inline: true },
      { name: '\u200B', value: musicPlayer.getProgress(guildId) },
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

/**
 * /loop - 切換循環模式
 */
async function handleLoop(interaction) {
  await interaction.deferReply().catch(() => {});
  const mode = interaction.options.getString('mode');
  const guildId = interaction.guildId;

  const result = queueManager.setLoopMode(guildId, mode);

  const modeMap = {
    'none': '❌ 已關閉循環模式',
    'one': '🔂 已啟用**單曲循環**模式',
    'queue': '🔁 已啟用**佇列循環**模式',
  };

  await interaction.editReply(modeMap[result] || `✅ 已設定循環模式`);
}

/**
 * /volume - 設定音量
 */
async function handleVolume(interaction) {
  await interaction.deferReply().catch(() => {});
  const level = interaction.options.getInteger('level');
  const guildId = interaction.guildId;

  const volume = musicPlayer.setVolume(guildId, level);

  // 音量 icon
  let icon = '🔇';
  if (volume > 66) icon = '🔊';
  else if (volume > 33) icon = '🔉';
  else if (volume > 0) icon = '🔈';

  // 音量條
  const barLen = 20;
  const filled = Math.round((volume / 100) * barLen);
  const bar = '█'.repeat(filled) + '▬'.repeat(barLen - filled);

  await interaction.editReply(`${icon} 音量已設定為 **${volume}%**\n\`${bar}\``);
}

/**
 * /leave - 離開語音頻道
 */
async function handleLeave(interaction) {
  await interaction.deferReply().catch(() => {});
  const guildId = interaction.guildId;
  const queue = queueManager.get(guildId);

  if (!queue.connection) {
    return interaction.editReply('❌ 我不在語音頻道中。');
  }

  musicPlayer.leave(guildId);
  await interaction.editReply('👋 已離開語音頻道！');
}

/**
 * /shuffle - 隨機打亂佇列
 */
async function handleShuffle(interaction) {
  await interaction.deferReply().catch(() => {});
  const guildId = interaction.guildId;
  const queue = queueManager.get(guildId);

  if (queue.songs.length < 2) {
    return interaction.editReply('❌ 佇列中至少需要 2 首歌曲才能打亂。');
  }

  // Fisher-Yates 洗牌演算法
  for (let i = queue.songs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue.songs[i], queue.songs[j]] = [queue.songs[j], queue.songs[i]];
  }

  await interaction.editReply(`🔀 已隨機打亂 ${queue.songs.length} 首歌曲的順序！`);
}

/**
 * /remove - 移除佇列中的歌曲
 */
async function handleRemove(interaction) {
  await interaction.deferReply().catch(() => {});
  const position = interaction.options.getInteger('position');
  const guildId = interaction.guildId;
  const queue = queueManager.get(guildId);

  if (position > queue.songs.length) {
    return interaction.editReply(`❌ 佇列中只有 ${queue.songs.length} 首歌曲，沒有第 ${position} 首。`);
  }

  const removed = queue.songs.splice(position - 1, 1)[0];
  await interaction.editReply(`🗑️ 已移除 **[${position}] ${removed.title}**`);
}

/**
 * /help - 顯示說明
 */
async function handleHelp(interaction) {
  await interaction.deferReply().catch(() => {});
  const embed = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle('🎵 Discord 音樂機器人 - 使用說明')
    .setDescription('使用斜線指令控制音樂播放！')
    .addFields(
      {
        name: '🎵 音樂播放',
        value:
          '`/play <關鍵字/網址>` - 播放 YouTube 音樂\n' +
          '`/skip` - 跳過目前歌曲\n' +
          '`/stop` - 停止播放並清空佇列\n' +
          '`/pause` - 暫停播放\n' +
          '`/resume` - 恢復播放\n' +
          '`/volume <0-100>` - 調整音量',
        inline: false,
      },
      {
        name: '📋 佇列管理',
        value:
          '`/queue` - 顯示播放佇列\n' +
          '`/nowplaying` - 顯示目前播放\n' +
          '`/shuffle` - 隨機打亂佇列\n' +
          '`/remove <位置>` - 移除指定歌曲\n' +
          '`/loop <模式>` - 循環模式 (關閉/單曲/佇列)',
        inline: false,
      },
      {
        name: '⚙️ 其他',
        value:
          '`/leave` - 機器人離開語音頻道\n' +
          '`/ping` - 檢查延遲\n' +
          '`/diagnose` - 診斷語音連線問題\n' +
          '`/help` - 顯示此說明',
        inline: false,
      },
    )
    .setFooter({ text: '💡 提示：機器人需要語音頻道權限才能播放音樂' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

/**
 * /ping - 檢查延遲
 */
async function handlePing(interaction) {
  const hidden = interaction.options.getBoolean('hidden') || false;
  await interaction.deferReply({ flags: hidden ? 64 : 0 }).catch(() => {});
  const replyMsg = await interaction.fetchReply();

  const latency = replyMsg.createdTimestamp - interaction.createdTimestamp;
  const apiLatency = client.ws.ping;

  const emoji = apiLatency < 100 ? '🟢' : apiLatency < 300 ? '🟡' : '🔴';

  await interaction.editReply(
    `🏓 **Pong！**\n` +
    `🤖 機器人延遲：\`${latency}ms\`\n` +
    `🌐 API 延遲：${emoji} \`${apiLatency}ms\``
  );
}

/**
 * /diagnose - 診斷語音連線問題
 */
async function handleDiagnose(interaction) {
  await interaction.deferReply().catch(() => {});
  const embed = new EmbedBuilder()
    .setColor(config.colors.info)
    .setTitle('🔍 語音連線診斷')
    .setDescription('檢查可能影響語音連線的因素')
    .addFields(
      {
        name: '🤖 機器人狀態',
        value: `✅ 機器人在線\n🌐 連線 ${client.guilds.cache.size} 個伺服器`,
        inline: false,
      },
      {
        name: '🎤 你的狀態',
        value: interaction.member.voice.channel
          ? `✅ 在語音頻道：**${interaction.member.voice.channel.name}**`
          : '❌ 你不在語音頻道中',
        inline: false,
      },
      {
        name: '🔊 機器人權限（語音頻道）',
        value: interaction.member.voice.channel
          ? checkVoicePermissions(interaction)
          : '⚠️ 請先加入語音頻道再執行',
        inline: false,
      },
      {
        name: '🛡️ Windows 防火牆',
        value:
          '請確認 Windows 防火牆允許 Node.js 通過：\n' +
          '1️⃣ 搜尋「防火牆」→ 進階設定\n' +
          '2️⃣ 檢查是否有 Node.js 的輸入/輸出規則\n' +
          '3️⃣ Discord 語音使用 UDP 連接埠 50000-65535',
        inline: false,
      },
      {
        name: '🔧 建議解決方案',
        value:
          '1️⃣ **以系統管理員執行**：`npm start`\n' +
          '2️⃣ **關閉防火牆測試**：暫時關閉 Windows Defender 防火牆測試\n' +
          '3️⃣ **切換語音區域**：伺服器設定 → 語音頻道 → 區域改爲「自動」或「美國西部」\n' +
          '4️⃣ **VPN/代理**：關閉任何 VPN 或代理軟體\n' +
          '5️⃣ **重新邀請機器人**：確保勾選了 Connect + Speak 權限',
        inline: false,
      },
    )
    .setFooter({ text: '請先使用 /play 測試，若仍有問題再依上述步驟排查' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

/**
 * 檢查語音頻道權限
 */
function checkVoicePermissions(interaction) {
  const channel = interaction.member.voice.channel;
  if (!channel) return '⚠️ 無法檢查（不在語音頻道）';

  const permissions = channel.permissionsFor(interaction.guild.members.me);
  const checks = {
    '連線 (Connect)': permissions.has('Connect'),
    '講話 (Speak)': permissions.has('Speak'),
    '使用語音活動 (Use VAD)': permissions.has('UseVAD'),
  };

  return Object.entries(checks)
    .map(([name, ok]) => (ok ? '✅' : '❌') + ' ' + name)
    .join('\n');
}

// ===== 前綴指令支援（選擇性） =====
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(config.prefix)) return;

  const args = message.content.slice(config.prefix.length).trim().split(/ +/);
  const cmd = args.shift()?.toLowerCase();

  // 簡單的前綴指令支援
  const prefixCommands = {
    'ping': async () => {
      const msg = await message.reply('🏓 Pong!');
      const latency = msg.createdTimestamp - message.createdTimestamp;
      await msg.edit(`🏓 Pong! 延遲：${latency}ms`);
    },
    'help': async () => {
      // 導向斜線指令
      await message.reply('📖 請使用 `/help` 查看完整指令清單！');
    },
  };

  if (prefixCommands[cmd]) {
    await prefixCommands[cmd]();
  }
});

// ===== 啟動機器人 =====
if (!config.token) {
  console.error('❌ 錯誤：未設定 DISCORD_TOKEN！');
  console.error('📝 請複製 .env.example 為 .env 並填入你的 Discord Bot Token。');
  process.exit(1);
}

console.log('🚀 正在啟動 Discord 音樂機器人...');
client.login(config.token).catch((error) => {
  console.error('❌ 登入失敗：', error.message);
  process.exit(1);
});
