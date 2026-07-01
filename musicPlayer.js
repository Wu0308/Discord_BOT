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
import { logger } from './logger.js';

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
      logger.info(`🔄 從頻道 ${currentChannelId} 切換到 ${voiceChannel.id}`);
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
          logger.info(`✅ 已連接到語音頻道: ${voiceChannel.name}`);

          queue.connection = connection;

          // 建立音頻播放器
          if (!queue.player) {
            queue.player = createAudioPlayer();
            connection.subscribe(queue.player);

            queue.player.on(AudioPlayerStatus.Idle, () => {
              this.onPlayerIdle(guildId, textChannel);
            });
            queue.player.on('error', (error) => {
              logger.error(`[Player Error] ${error.message}`);
              this.onPlayerIdle(guildId, textChannel);
            });
          }

          // 斷線時自動重連
          connection.on(VoiceConnectionStatus.Disconnected, async () => {
            logger.info('[Voice] 斷線，嘗試重連...');
            try {
              await Promise.race([
                entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
              ]);
            } catch {
              logger.info('[Voice] 重連失敗');
              queue.connection = null;
              if (queue.player) queue.player.stop();
              try { connection.destroy(); } catch {}
            }
          });

          connection.on('error', (error) => {
            logger.error('[Voice Error]', error.message);
          });

          done(true);
        }

        if (newState.status === VoiceConnectionStatus.Destroyed) {
          done(false);
        }
      };

      const onError = (error) => {
        logger.error('[Voice Error]', error.message);
        done(false);
      };

      connection.on('stateChange', onStateChange);
      connection.on('error', onError);

      const timer = setTimeout(async () => {
        logger.error('[Voice] 連線超時');
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

    // 速度調整或重啟中，跳過自動下一首
    if (queue._suppressIdle) {
      logger.debug('[Idle] 已抑制（速度調整中）');
      return;
    }

    // 防止短時間內重複觸發 Idle 事件（player.stop() 有時會觸發兩次）
    if (queue._idleDebounce) {
      logger.debug('[Idle] 已抑制（debounce）');
      return;
    }
    queue._idleDebounce = true;
    setTimeout(() => { queue._idleDebounce = false; }, 300);

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
   * 建立 atempo 濾鏡字串 (支援 0.25 ~ 3.0 的播放速度)
   * @param {number} speed
   * @returns {string} FFmpeg atempo 濾鏡鏈
   */
  _atempoFilter(speed) {
    if (speed === 1.0) return null; // 正常速度，無需濾鏡
    const parts = [];
    let remaining = speed;
    while (remaining > 2.0 || remaining < 0.5) {
      if (remaining > 2.0) {
        parts.push('atempo=2.0');
        remaining /= 2.0;
      } else {
        parts.push('atempo=0.5');
        remaining /= 0.5;
      }
    }
    parts.push(`atempo=${remaining}`);
    return parts.join(',');
  }

  /**
   * 建立音頻串流：yt-dlp → FFmpeg (可選 atempo) → demuxProbe → AudioResource
   */
  async _createAudioStream(guildId, song) {
    const queue = queueManager.get(guildId);
    const filter = this._atempoFilter(queue.speed);

    // ===== 1. yt-dlp：下載音頻，輸出到 stdout =====
    const ytdlpArgs = [
      song.url,
      '-x',                // 提取音頻
      '--no-playlist',
      '-o', '-',
      '-q',
      '--no-warnings',
    ];

    const ytdlp = spawn('yt-dlp', ytdlpArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    queue.ytdlpProcess = ytdlp;
    ytdlp.on('close', () => { queue.ytdlpProcess = null; });
    ytdlp.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) logger.error('[yt-dlp stderr]', msg);
    });

    // ===== 2. FFmpeg：可選 atempo 濾鏡 → webm/opus 輸出 =====
    let audioStream;
    if (filter) {
      logger.info(`[FFmpeg] 套用 atempo 濾鏡: ${filter}`);
      const ffmpeg = spawn('ffmpeg', [
        '-i', 'pipe:0',                           // stdin 來自 yt-dlp
        '-af', filter,                            // atempo 速度濾鏡
        '-c:a', 'libopus',                        // 重新編碼為 opus
        '-b:a', '128k',                           // 碼率
        '-vbr', 'on',
        '-compression_level', '5',                // opus 品質/速度平衡
        '-f', 'webm',                             // 輸出容器
        'pipe:1',                                 // 輸出到 stdout
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      queue.ffmpegProcess = ffmpeg;
      ffmpeg.on('close', () => { queue.ffmpegProcess = null; });
      ffmpeg.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) logger.debug(`[ffmpeg] ${msg}`);
      });

      // yt-dlp stdout → ffmpeg stdin（加入 EPIPE 防護）
      ytdlp.stdout.pipe(ffmpeg.stdin);

      // 捕獲 pipe 過程中的 EPIPE / ECONNRESET 等錯誤
      ytdlp.stdout.on('error', (err) => {
        if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
          logger.debug(`[yt-dlp stdout] pipe 中斷 (${err.code})`);
        } else {
          logger.error(`[yt-dlp stdout] 錯誤: ${err.message}`);
        }
      });
      ffmpeg.stdin.on('error', (err) => {
        if (err.code === 'EPIPE' || err.code === 'ECONNRESET') {
          logger.debug(`[ffmpeg stdin] pipe 中斷 (${err.code})`);
        } else {
          logger.error(`[ffmpeg stdin] 錯誤: ${err.message}`);
        }
      });

      audioStream = ffmpeg.stdout;
    } else {
      // 正常速度：直接使用 yt-dlp 輸出
      audioStream = ytdlp.stdout;
    }

    // ===== 3. demuxProbe → AudioResource =====
    const probe = await demuxProbe(audioStream);
    logger.info(`[Probe] 偵測到格式: ${probe.type}`);

    const resource = createAudioResource(probe.stream, {
      inputType: probe.type,
      inlineVolume: true,
    });

    resource.volume?.setVolume(queue.volume / 100);
    return resource;
  }

  /**
   * 停止所有外部進程 (yt-dlp + ffmpeg)
   * 先停 ffmpeg → 再停 yt-dlp，避免 EPIPE
   */
  _killProcesses(guildId) {
    const queue = queueManager.get(guildId);

    // 先終止 ffmpeg，讓 pipe 的接收端先斷開
    if (queue.ffmpegProcess) {
      try {
        queue.ffmpegProcess.stdin.destroy(); // 先關閉 stdin 管道
      } catch {}
      try {
        queue.ffmpegProcess.kill('SIGKILL');
      } catch {}
      queue.ffmpegProcess = null;
    }

    // 再終止 yt-dlp（此時 pipe 輸出端已無接收方，但錯誤處理器會攔截 EPIPE）
    if (queue.ytdlpProcess) {
      try {
        queue.ytdlpProcess.stdout.destroy(); // 先關閉 stdout 管道
      } catch {}
      try {
        queue.ytdlpProcess.stderr.destroy();
      } catch {}
      try {
        queue.ytdlpProcess.kill('SIGKILL');
      } catch {}
      queue.ytdlpProcess = null;
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

      logger.info(`[Play] URL: ${song.url}, Speed: ${queue.speed}x`);

      // 先清理舊進程
      this._killProcesses(guildId);

      const resource = await this._createAudioStream(guildId, song);
      queue.resource = resource;

      queue.player.play(resource);

      // 解除閒置抑制（若為速度調整觸發的重播）
      queue._suppressIdle = false;

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
      logger.error(`[Play Error] ${song.title}:`, error.message);
      await textChannel.send(`❌ 無法播放 **${song.title}**：${error.message}`);
      // 清除保護旗標，確保 onPlayerIdle 能正常運作
      queue._suppressIdle = false;
      queue._idleDebounce = false;
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

      logger.info('[Search] Result:', JSON.stringify({
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
      logger.error('[Search Error]', error);
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
    this._killProcesses(guildId);
    queue.player.stop();
    return true;
  }

  /**
   * 停止播放並清空佇列
   */
  stop(guildId) {
    const queue = queueManager.get(guildId);
    this._killProcesses(guildId);
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
   * 設定播放速度 (0.25 ~ 3.0)
   * 若目前有歌曲播放中，會重啟以套用新速度
   */
  async setSpeed(guildId, speed, textChannel) {
    const queue = queueManager.get(guildId);
    queue.speed = Math.max(0.25, Math.min(3.0, speed));
    logger.info(`[Speed] 設定為 ${queue.speed}x`);

    // 若正在播放，重新播放目前歌曲以套用新速度
    if (queue.isPlaying && queue.currentSong) {
      const song = { ...queue.currentSong };
      // 抑制 idle 事件，避免 player.stop() 觸發自動下一首
      queue._suppressIdle = true;

      // 先終止外部進程並關閉管道（order: ffmpeg → ytdlp）
      this._killProcesses(guildId);

      // 停止 audio player
      try {
        queue.player.stop(true);
      } catch {
        // 可能已在過渡期，無視停止錯誤
      }

      // 短延遲確保舊資源完全釋放
      await new Promise((r) => setTimeout(r, 100));

      // 重新播放同一首歌 (playSong 會重新建立 ytdlp + ffmpeg 並套用新速度)
      await this.playSong(guildId, song, textChannel);
    }

    return queue.speed;
  }

  /**
   * 離開語音頻道
   */
  leave(guildId) {
    const queue = queueManager.get(guildId);
    this.clearAutoLeave(guildId);
    this._killProcesses(guildId);
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

    // 實際時間 × 速度倍率 = 音頻實際播放進度
    const realElapsed = (Date.now() - queue.startTime) / 1000;
    const elapsed = Math.floor(realElapsed * queue.speed);
    const total = queue.currentSong.durationSec;
    const progress = Math.min(elapsed / total, 1);

    const barLength = 20;
    const filled = Math.round(progress * barLength);
    const bar = '█'.repeat(filled) + '▬'.repeat(barLength - filled);

    return `${bar} \`${this.formatDuration(elapsed)} / ${queue.currentSong.duration}\``;
  }
}

export const musicPlayer = new MusicPlayer();