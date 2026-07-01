/**
 * 簡易日誌模組
 *
 * 提供 timestamp + 層級的 console log，同時將日誌寫入檔案
 */
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
let currentLevel = LEVELS.DEBUG;

const LOG_DIR = join(process.cwd(), 'logs');
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

function timestamp() {
  return new Date().toISOString();
}

function format(level, message) {
  return `[${timestamp()}] [${level}] ${message}`;
}

function writeFile(line) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    appendFileSync(join(LOG_DIR, `bot-${today}.log`), line + '\n');
  } catch {
    // 寫檔失敗不影響主流程
  }
}

/**
 * @param {string} level
 * @param {string} message
 * @param  {...any} args
 */
function log(level, message, ...args) {
  const formatted = format(level, message);
  if (level === 'ERROR') {
    console.error(formatted, ...args);
  } else if (level === 'WARN') {
    console.warn(formatted, ...args);
  } else {
    console.log(formatted, ...args);
  }
  writeFile(formatted + (args.length ? ' ' + args.map(String).join(' ') : ''));
}

export const logger = {
  debug: (msg, ...args) => log('DEBUG', msg, ...args),
  info: (msg, ...args) => log('INFO', msg, ...args),
  warn: (msg, ...args) => log('WARN', msg, ...args),
  error: (msg, ...args) => log('ERROR', msg, ...args),

  /** 設定最低輸出層級 */
  setLevel(level) {
    if (LEVELS[level] !== undefined) {
      currentLevel = LEVELS[level];
    }
  },
};