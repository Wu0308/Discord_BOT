# 🎵 Discord 音樂機器人

基於 [discord.js](https://discord.js.org/) + [yt-dlp](https://github.com/yt-dlp/yt-dlp) 的多功能 Discord 音樂機器人，支援 YouTube 搜尋與播放、佇列管理、音量控制。

---

## ✨ 功能

| 指令 | 說明 |
|---|---|
| `/play <關鍵字\|網址>` | 🎵 播放音樂（YouTube 搜尋或直接網址） |
| `/skip` | ⏭️ 跳過目前歌曲 |
| `/stop` | ⏹️ 停止播放並清空佇列 |
| `/pause` | ⏸️ 暫停 |
| `/resume` | ▶️ 繼續 |
| `/queue` | 📋 顯示播放佇列 |
| `/nowplaying` | 🎶 目前播放資訊（含進度條） |
| `/loop <模式>` | 🔁 循環模式：關閉 / 單曲 / 佇列 |
| `/volume <0-100>` | 🔊 調整音量 |
| `/shuffle` | 🔀 隨機打亂佇列 |
| `/remove <位置>` | 🗑️ 移除指定歌曲 |
| `/leave` | 👋 離開語音頻道 |
| `/diagnose` | 🔍 語音連線診斷 |
| `/help` | 📖 指令說明 |
| `/ping` | 🏓 延遲測試 |

---

## 🛠️ 技術棧

| 套件 | 用途 |
|---|---|
| `discord.js` v14 | Discord API 客戶端 |
| `@discordjs/voice` v0.19 | 語音連線與音頻串流 |
| `@discordjs/opus` | Opus 音頻編解碼（原生效能） |
| `yt-search` | YouTube 關鍵字搜尋 |
| `yt-dlp` | YouTube 音頻下載/串流（外部 CLI） |
| `tweetnacl` | Discord 語音加密 |

> **為什麼用 yt-dlp 而不是純 JS 函式庫？**  
> YouTube 頻繁更改其 JS player，純 JS 解析庫（如 `play-dl`、`ytdl-core`）經常失效。`yt-dlp` 活躍維護、更新迅速，比任何 Node.js 庫都穩定。

---

## 🚀 安裝

### 前置需求

- **Node.js v22 LTS**（v24 可運行但 @discordjs/opus 無預編譯檔）
- **Python 3** + **yt-dlp**（用於串流 YouTube 音頻）
- **Discord Bot**（[建立方式](#1-discord-開發者設定)）

### 1. 安裝 yt-dlp

```powershell
pip install -U yt-dlp
```

> yt-dlp 需要定期更新：`pip install -U yt-dlp`。YouTube 機制時常改變，舊版可能無法提取格式。

### 2. 安裝 Node.js 依賴

```powershell
npm install
```

> 若 `@discordjs/opus` 編譯失敗（缺少 C++ 編譯器），改用純 JS 備用方案：
> ```powershell
> npm uninstall @discordjs/opus
> npm install opusscript@0.0.8
> ```

### 3. Discord 開發者設定

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
2. 左側 **Bot** → **Add Bot**
3. 在 **Privileged Gateway Intents** 開啟全部三個：
   - ✅ Server Members Intent
   - ✅ Message Content Intent
   - ✅ Voice States Intent
4. 複製 **Token**

### 4. 邀請機器人

左側 **OAuth2** → **URL Generator**：

| 類別 | 勾選 |
|---|---|
| Scopes | `bot`、`applications.commands` |
| Bot Permissions | `Send Messages`、`Embed Links`、`Read Message History`、`Connect`、`Speak`、`Use Voice Activity` |

將產生的 URL 貼到瀏覽器，選擇伺服器。

### 5. 環境變數

建立 `.env` 檔案：

```env
DISCORD_TOKEN=你的BotToken
CLIENT_ID=你的ApplicationID
GUILD_ID=你的伺服器ID（選用，開發時即時生效）
PREFIX=!
```

> `CLIENT_ID` 在 Developer Portal → General Information → **Application ID**

### 6. 註冊指令 + 啟動

```powershell
npm run deploy
npm start
```

---

## 📁 專案結構

```
Discor_BOT/
├── index.js              # 主程式（事件處理、指令路由）
├── config.js             # 設定（Token、音量、顏色等）
├── musicPlayer.js        # 音樂播放器（語音連線、yt-dlp 串流、播放控制）
├── queueManager.js       # 佇列管理器（歌曲佇列、循環模式）
├── deployCommands.js     # 斜線指令註冊
├── diagnose_all.mjs      # 完整診斷腳本（檢查 .env、依賴、ffmpeg、防火牆等）
├── .env                  # 環境變數（不入版控）
├── .env.example          # 環境變數範例
├── package.json
└── README.md
```

---

## 🔧 設定調整

在 `config.js` 中：

```js
voice: {
  defaultVolume: 50,       // 預設音量 (0-100)
  autoLeaveSeconds: 300,   // 閒置自動離開秒數（設 0 停用）
}
```

---

## ❓ 常見問題

### 機器人連線語音頻道超時

```text
[Voice] 連線超時（30秒）
```

1. 以**系統管理員**打開 PowerShell，執行：
   ```powershell
   New-NetFirewallRule -DisplayName "Discord Bot UDP In" -Direction Inbound -Protocol UDP -LocalPort 50000-65535 -Action Allow
   New-NetFirewallRule -DisplayName "Discord Bot UDP Out" -Direction Outbound -Protocol UDP -LocalPort 50000-65535 -Action Allow
   ```
2. 關閉 VPN / 代理 / 遊戲加速器
3. Discord 語音頻道設定 → 區域覆蓋 → 改為「巴西」或「自動」

### 沒有聲音 / 播放無反應

確認啟動日誌中有：
```
✅ @discordjs/voice 載入成功
✅ @discordjs/opus 載入成功
✅ tweetnacl 載入成功
```

若顯示 `⚠️ @discordjs/opus 未安裝`，請安裝 `@discordjs/opus` 或 `opusscript@0.0.8`。

### `[yt-dlp stderr] Requested format is not available`

yt-dlp 版本過舊，YouTube 改了機制。

```powershell
pip install -U yt-dlp
```

### 斜線指令無反應 / Unknown interaction

```powershell
npm run deploy   # 重新註冊指令
```

---

## 📄 授權

MIT License
