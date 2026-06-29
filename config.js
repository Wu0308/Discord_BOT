import 'dotenv/config';

export const config = {
  // Discord Bot Token（必要）
  token: process.env.DISCORD_TOKEN,

  // 前綴指令符號
  prefix: process.env.PREFIX || '!',

  // YouTube API Key（選用）
  youtubeApiKey: process.env.YOUTUBE_API_KEY || null,

  // 機器人狀態
  statusMessage: process.env.STATUS_MESSAGE || '🎵 輸入 /play 聽音樂！',

  // 語音設定
  voice: {
    // 預設音量 (0-100)
    defaultVolume: 50,
    // 離開閒置語音頻道的秒數（設為 0 停用）
    autoLeaveSeconds: 300,
  },

  // 嵌入訊息顏色
  colors: {
    primary: 0x5865F2,      // Discord Blurple
    success: 0x57F287,      // 綠色
    warning: 0xFEE75C,      // 黃色
    error: 0xED4245,        // 紅色
    info: 0x00B0F4,         // 藍色
  },
};
