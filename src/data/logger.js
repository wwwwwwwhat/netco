import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_DIR = path.join(__dirname, '../../data/cache/logs');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * 记录错误日志
 * @param {string} context - 错误上下文 (例如: 'API:sendMessage')
 * @param {Error|string} error - 错误对象或消息
 */
export function logError(context, error) {
  const timestamp = new Date().toISOString();
  const errorMessage = error instanceof Error ? error.stack : error;
  const logMessage = `[${timestamp}] [ERROR] [${context}] ${errorMessage}\n`;
  
  const logFile = path.join(LOG_DIR, 'error.log');
  
  fs.appendFile(logFile, logMessage, (err) => {
    if (err) console.error('Failed to write to log file:', err);
  });
}

/**
 * 记录普通日志
 * @param {string} context - 上下文
 * @param {string} message - 消息
 */
export function logInfo(context, message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [INFO] [${context}] ${message}\n`;
    
    const logFile = path.join(LOG_DIR, 'app.log');
    
    fs.appendFile(logFile, logMessage, (err) => {
      if (err) console.error('Failed to write to log file:', err);
    });
}
