/**
 * 音樂佇列管理器
 * 管理每個伺服器獨立的音樂佇列
 */

class QueueManager {
  constructor() {
    // Map<guildId, Queue>
    this.queues = new Map();
  }

  /**
   * 取得伺服器的佇列，不存在則建立
   * @param {string} guildId
   * @returns {Queue}
   */
  get(guildId) {
    if (!this.queues.has(guildId)) {
      this.queues.set(guildId, {
        songs: [],
        currentSong: null,
        isPlaying: false,
        isLooping: false,     // 單曲循環
        isLoopQueue: false,   // 佇列循環
        volume: 50,
        connection: null,
        player: null,
        resource: null,
        timeout: null,
        startTime: 0,
        pausedTime: 0,
      });
    }
    return this.queues.get(guildId);
  }

  /**
   * 刪除伺服器的佇列
   * @param {string} guildId
   */
  delete(guildId) {
    this.queues.delete(guildId);
  }

  /**
   * 加入歌曲到佇列
   * @param {string} guildId
   * @param {Object} song
   * @returns {number} 佇列中的位置
   */
  addSong(guildId, song) {
    const queue = this.get(guildId);
    queue.songs.push(song);
    return queue.songs.length;
  }

  /**
   * 插入歌曲到佇列最前面
   * @param {string} guildId
   * @param {Object} song
   */
  insertFirst(guildId, song) {
    const queue = this.get(guildId);
    queue.songs.unshift(song);
  }

  /**
   * 取得下一首歌曲
   * @param {string} guildId
   * @returns {Object|null}
   */
  getNextSong(guildId) {
    const queue = this.get(guildId);
    if (queue.songs.length === 0) return null;
    return queue.songs.shift();
  }

  /**
   * 清空佇列
   * @param {string} guildId
   */
  clear(guildId) {
    const queue = this.get(guildId);
    queue.songs = [];
    queue.currentSong = null;
  }

  /**
   * 切換循環模式
   * @param {string} guildId
   * @param {string} mode - 'none' | 'one' | 'queue'
   */
  setLoopMode(guildId, mode) {
    const queue = this.get(guildId);
    queue.isLooping = mode === 'one';
    queue.isLoopQueue = mode === 'queue';
    return mode;
  }

  /**
   * 取得佇列狀態摘要
   * @param {string} guildId
   * @returns {Object}
   */
  getStatus(guildId) {
    const queue = this.get(guildId);
    return {
      currentSong: queue.currentSong,
      queueLength: queue.songs.length,
      isPlaying: queue.isPlaying,
      isLooping: queue.isLooping,
      isLoopQueue: queue.isLoopQueue,
      volume: queue.volume,
    };
  }
}

// 匯出單例
export const queueManager = new QueueManager();
