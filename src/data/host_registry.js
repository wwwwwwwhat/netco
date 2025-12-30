import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Store in data/system/host_registry.json
const DATA_DIR = path.join(__dirname, '../../data/system');
const USER_DATA_DIR = path.join(__dirname, '../../data/user');
const REGISTRY_FILE = path.join(DATA_DIR, 'host_registry.json');

// Configuration
const MAX_USERS_PER_HOST = 3; // 限制本机最多创建3个用户
const REGISTRATION_COOLDOWN_MS = 60 * 60 * 1000; // 1小时冷却时间

// 内存缓存
let cachedRegistry = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadRegistryFromFile() {
  try {
    if (!fs.existsSync(REGISTRY_FILE)) {
      return { userCount: 0, lastRegistrationTime: 0 };
    }
    const data = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    
    return {
      userCount: data.userCount || 0,
      lastRegistrationTime: data.lastRegistrationTime || 0
    };
  } catch (error) {
    return { userCount: 0, lastRegistrationTime: 0 };
  }
}

/**
 * 初始化注册表（读取文件 + 扫描目录）
 * 必须在程序启动时调用
 */
export function initRegistry() {
  const fileData = loadRegistryFromFile();
  
  // 扫描实际文件数量
  let fileCount = 0;
  try {
    if (fs.existsSync(USER_DATA_DIR)) {
      const files = fs.readdirSync(USER_DATA_DIR);
      fileCount = files.filter(file => file.endsWith('.json')).length;
    }
  } catch (e) {}

  // 取最大值作为当前状态
  cachedRegistry = {
    userCount: Math.max(fileData.userCount, fileCount),
    lastRegistrationTime: fileData.lastRegistrationTime
  };
  
  console.log(`[System] 注册表已初始化 (用户数: ${cachedRegistry.userCount})`);
}

/**
 * 将内存中的注册表保存到磁盘
 * 应在程序退出时调用
 */
export function saveRegistryToDisk() {
  if (!cachedRegistry) return;
  
  try {
    ensureDir();
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(cachedRegistry, null, 2));
    console.log('[System] 注册表已保存到磁盘');
  } catch (error) {
    console.error('[System] 保存注册表失败:', error);
  }
}

/**
 * 检查是否允许注册
 * @returns {{allowed: boolean, reason?: string}}
 */
export function checkRegistrationLimits() {
  if (!cachedRegistry) initRegistry();
  
  const now = Date.now();

  // 1. 检查数量限制
  if (cachedRegistry.userCount >= MAX_USERS_PER_HOST) {
    return {
      allowed: false,
      reason: `达到本机用户数量上限 (${MAX_USERS_PER_HOST} 个)。`
    };
  }

  // 2. 检查时间限制
  const timeSinceLast = now - cachedRegistry.lastRegistrationTime;
  if (timeSinceLast < REGISTRATION_COOLDOWN_MS) {
    const minutesRemaining = Math.ceil((REGISTRATION_COOLDOWN_MS - timeSinceLast) / 60000);
    return {
      allowed: false,
      reason: `注册过于频繁。本机限制每小时只能注册一个新用户。\n   请等待 ${minutesRemaining} 分钟后再试。`
    };
  }

  return { allowed: true };
}

/**
 * 记录注册成功 (只更新内存)
 * @param {string} username 
 */
export function recordRegistration(username) {
  if (!cachedRegistry) initRegistry();
  
  cachedRegistry.userCount++;
  cachedRegistry.lastRegistrationTime = Date.now();
  
  console.log(`[System] 注册计数已更新 (当前: ${cachedRegistry.userCount})，将在退出时保存`);
}
