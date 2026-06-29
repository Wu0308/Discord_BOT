/**
 * 音樂播放器核心邏輯
 * 處理語音連接、音頻串流、播放控制
 */
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
  entersState,
  VoiceConnectionStatus,
  demuxProbe,
} from '@discordjs/voice';
import { spawn } from 'child_process';
import yts from 'yt-search';
import { queueManager } from './queueManager.js';
import { config } from './config.js';

class MusicPlayer {
  constructor() {
    // no manual init needed
  }

  /**
   * 加入語音頻道
   * @param {import('discord.js').GuildMember} member
   * @param {import('discord.js').TextChannel} textChannel
   * @returns {Promise<boolean>}
   */
  async join(member, textChannel) {
    const voiceChannel = member.voice.channel;
    if (!voiceChannel) {
      await textChannel.send('❌ 你必須先在語音頻道中！');
      return false;
    }

    const guildId = voiceChannel.guild.id;
    let queue = queueManager.get(guildId);

    // 如果已經在同一個頻道，則不需要重新連接
    if (queue.connection) {
      const currentChannelId = queue.connection.joinConfig.channelId;
      if (currentChannelId === voiceChannel.id) {
        return true;
      }
      console.log(`🔄 從頻道 ${currentChannelId} 切換到 ${voiceChannel.id}`);
      this.leave(guildId);
      queue = queueManager.get(guildId);
    }

    // 建立語音連接
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });

    // 手動監聽狀態轉換（相容 Node 24）
    return new Promise((resolve) => {
      let resolved = false;
      const done = (success) => {
        if (resolved) return;
        resolved = true;
        connection.off('stateChange', onStateChange);
        connection.off('error', onError);
        clearTimeout(timer);
        if (!success) try { connection.destroy(); } catch {}
        resolve(success);
      };

      const onStateChange = (oldState, newState) => {
        // 只在從非 Ready 進入 Ready 時輸出一次
        if (newState.status === VoiceConnectionStatus.Ready &&
            oldState.status !== VoiceConnectionStatus.Ready) {
          console.log(`✅ 已連接到語音頻道: ${voiceChannel.name}`);

          queue.connection = connection;

          // 建立音頻播放器
          if (!queue.player) {
            queue.player = createAudioPlayer();
            connection.subscribe(queue.player);

            queue.player.on(AudioPlayerStatus.Idle, () => {
              this.onPlayerIdle(guildId, textChannel);
            });
            queue.player.on('error', (error) => {
              console.error(`[Player Error] ${error.message}`);
              this.onPlayerIdle(guildId, textChannel);
            });
          }

          // 斷線時自動重連
          connection.on(VoiceConnectionStatus.Disconnected, async () => {
            console.log('[Voice] 斷線，嘗試重連...');
            try {
              await Promise.race([
                entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
              ]);
            } catch {
              console.log('[Voice] 重連失敗');
              queue.connection = null;
              if (queue.player) queue.player.stop();
              try { connection.destroy(); } catch {}
            }
          });

          connection.on('error', (error) => {
            console.error('[Voice Error]', error.message);
          });

          done(true);
        }

        if (newState.status === VoiceConnectionStatus.Destroyed) {
          done(false);
        }
      };

      const onError = (error) => {
        console.error('[Voice Error]', error.message);
        done(false);
      };

      connection.on('stateChange', onStateChange);
      connection.on('error', onError);

      const timer = setTimeout(async () => {
        console.error('[Voice] 連線超時');
        done(false);
        await textChannel.send(
          '❌ 語音連線超時。這是 **Node.js v24 + @discordjs/voice** 的 UDP 相容性問題。\n\n' +
          '**🔧 請嘗試：**\n' +
          '• Discord 語音頻道 → **區域覆蓋** → 改為「**巴西**」或「**美國西部**」\n' +
          '• 或降級 Node.js 到 v22 LTS：`nvm install 22 && nvm use 22`'
        ).catch(() => {});
      }, 30_000);
    });
  }

  /**
   * 播放器空閒時觸發（播放下一首或離開）
   */
  async onPlayerIdle(guildId, textChannel) {
    const queue = queueManager.get(guildId);

    // 單曲循環
    if (queue.isLooping && queue.currentSong) {
      queueManager.insertFirst(guildId, { ...queue.currentSong });
    }
    // 佇列循環：將目前歌曲放回佇列尾端
    else if (queue.isLoopQueue && queue.currentSong) {
      queueManager.addSong(guildId, { ...queue.currentSong });
    }

    // 是否有下一首
    const nextSong = queueManager.getNextSong(guildId);
    if (nextSong) {
      await this.playSong(guildId, nextSong, textChannel);
    } else {
      queue.isPlaying = false;
      queue.currentSong = null;
      queue.startTime = 0;
      queue.pausedTime = 0;

      // 清除閒置計時器
      this.clearAutoLeave(guildId);

      // 自動離開語音頻道
      if (config.voice.autoLeaveSeconds > 0) {
        queue.timeout = setTimeout(async () => {
          const q = queueManager.get(guildId);
          if (q.connection && !q.isPlaying && q.songs.length === 0) {
            this.leave(guildId);
            if (textChannel) {
              try {
                await textChannel.send('👋 閒置太久，我離開語音頻道了！');
              } catch { /* ignore */ }
            }
          }
        }, config.voice.autoLeaveSeconds * 1000);
      }
    }
  }

  /**
   * 播放指定歌曲
   */
  async playSong(guildId, song, textChannel) {
    const queue = queueManager.get(guildId);

    try {
      queue.currentSong = song;
      queue.isPlaying = true;
      queue.startTime = Date.now();
      queue.pausedTime = 0;

      console.log(`[Play] URL: ${song.url}`);

      // yt-dlp: 靈活格式選擇（不強制 opus，讓 yt-dlp 自選最佳音頻）
      const ytdlp = spawn('yt-dlp', [
        song.url,
        '-x',                      // 提取音頻
        '--no-playlist',
        '-o', '-',
        '-q',
        '--no-warnings',
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      ytdlp.on('error', (err) => {
        console.error('[yt-dlp Error]', err.message);
        queue.player?.stop();
      });

      ytdlp.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) console.error('[yt-dlp stderr]', msg);
      });

      // demuxProbe 自動偵測串流格式
      const probe = await demuxProbe(ytdlp.stdout);
      console.log(`[Probe] 偵測到格式: ${probe.type}`);

      const resource = createAudioResource(probe.stream, {
        inputType: probe.type,
        inlineVolume: true,
      });

      resource.volume?.setVolume(queue.volume / 100);
      queue.resource = resource;
      queue.ytdlpProcess = ytdlp;   // 追蹤進程以便清理

      queue.player.play(resource);

      ytdlp.on('close', () => { queue.ytdlpProcess = null; });

      // 發送現在播放訊息
      const embed = {
        color: config.colors.success,
        title: '🎵 正在播放',
        description: `[${song.title}](${song.url})`,
        thumbnail: { url: song.thumbnail },
        fields: [
          { name: '⏱️ 時長', value: song.duration, inline: true },
          { name: '👤 要求者', value: song.requestedBy, inline: true },
        ],
        footer: { text: `📋 佇列中還有 ${queue.songs.length} 首` },
        timestamp: new Date(),
      };

      await textChannel.send({ embeds: [embed] });
    } catch (error) {
      console.error(`[Play Error] ${song.title}:`, error.message);
      await textChannel.send(`❌ 無法播放 **${song.title}**：${error.message}`);
      // 嘗試播下一首
      this.onPlayerIdle(guildId, textChannel);
    }
  }

  /**
   * 搜尋 YouTube 影片
   * @param {string} query 搜尋關鍵字或 URL
   * @returns {Promise<Object|null>}
   */
  async search(query) {
    try {
      // yt-search 同時支援 URL 和關鍵字搜尋
      const results = await yts(query);
      const video = results.videos?.[0];
      if (!video) return null;

      console.log('[Search] Result:', JSON.stringify({
        title: video.title,
        url: video.url,
        duration: video.duration?.seconds,
      }));

      return {
        title: video.title || '未知標題',
        url: video.url || '',
        thumbnail: video.thumbnail || '',
        duration: video.duration?.timestamp || this.formatDuration(video.duration?.seconds || 0),
        durationSec: video.duration?.seconds || 0,
      };
    } catch (error) {
      console.error('[Search Error]', error);
      return null;
    }
  }

  /**
   * 暫停播放
   */
  pause(guildId) {
    const queue = queueManager.get(guildId);
    if (!queue.player || !queue.isPlaying) return false;

    queue.player.pause();
    queue.isPlaying = false;
    queue.pausedTime = Date.now();
    return true;
  }

  /**
   * 恢復播放
   */
  resume(guildId) {
    const queue = queueManager.get(guildId);
    if (!queue.player || queue.isPlaying) return false;

    queue.player.unpause();
    queue.isPlaying = true;
    // 調整開始時間以補償暫停
    const pauseDuration = Date.now() - queue.pausedTime;
    queue.startTime += pauseDuration;
    queue.pausedTime = 0;
    return true;
  }

  /**
   * 跳過目前歌曲
   */
  skip(guildId) {
    const queue = queueManager.get(guildId);
    if (!queue.player) return false;
    if (queue.ytdlpProcess) { try { queue.ytdlpProcess.kill(); } catch {} queue.ytdlpProcess = null; }
    queue.player.stop();
    return true;
  }

  /**
   * 停止播放並清空佇列
   */
  stop(guildId) {
    const queue = queueManager.get(guildId);
    if (queue.ytdlpProcess) { try { queue.ytdlpProcess.kill(); } catch {} queue.ytdlpProcess = null; }
    if (queue.player) {
      queue.player.stop();
    }
    queue.songs = [];
    queue.currentSong = null;
    queue.isPlaying = false;
    queue.startTime = 0;
    queue.pausedTime = 0;
    return true;
  }

  /**
   * 設定音量
   */
  setVolume(guildId, volume) {
    const queue = queueManager.get(guildId);
    queue.volume = Math.max(0, Math.min(100, volume));
    if (queue.resource?.volume) {
      queue.resource.volume.setVolume(queue.volume / 100);
    }
    return queue.volume;
  }

  /**
   * 離開語音頻道
   */
  leave(guildId) {
    const queue = queueManager.get(guildId);
    this.clearAutoLeave(guildId);
    if (queue.ytdlpProcess) { try { queue.ytdlpProcess.kill(); } catch {} queue.ytdlpProcess = null; }
    if (queue.player) {
      queue.player.stop();
    }
    if (queue.connection) {
      queue.connection.destroy();
    }
    queueManager.delete(guildId);
  }

  /**
   * 清除自動離開計時器
   */
  clearAutoLeave(guildId) {
    const queue = queueManager.get(guildId);
    if (queue.timeout) {
      clearTimeout(queue.timeout);
      queue.timeout = null;
    }
  }

  /**
   * 格式化秒數為 mm:ss 或 hh:mm:ss
   */
  formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '∞';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  /**
   * 獲取目前播放進度字串
   */
  getProgress(guildId) {
    const queue = queueManager.get(guildId);
    if (!queue.isPlaying || !queue.currentSong || !queue.currentSong.durationSec) return '';

    const elapsed = Math.floor((Date.now() - queue.startTime) / 1000);
    const total = queue.currentSong.durationSec;
    const progress = Math.min(elapsed / total, 1);

    const barLength = 20;
    const filled = Math.round(progress * barLength);
    const bar = '█'.repeat(filled) + '▬'.repeat(barLength - filled);

    return `${bar} \`${this.formatDuration(elapsed)} / ${queue.currentSong.duration}\``;
  }
}

export const musicPlayer = new MusicPlayer();
