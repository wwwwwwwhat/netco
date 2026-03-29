import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '../../data/system');
const USER_DATA_DIR = path.join(__dirname, '../../data/user');
const REGISTRY_FILE = path.join(DATA_DIR, 'host_registry.json');

// 每台机器最多3个用户，1小时冷却
const MAX_USERS_PER_HOST = 3;
const REGISTRATION_COOLDOWN_MS = 60 * 60 * 1000;

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

// 启动时扫描实际文件数，取文件数和记录的最大值
export function initRegistry() {
  const fileData = loadRegistryFromFile();
  
  let fileCount = 0;
  try {
    if (fs.existsSync(USER_DATA_DIR)) {
      const files = fs.readdirSync(USER_DATA_DIR);
      fileCount = files.filter(file => file.endsWith('.json')).length;
    }
  } catch (e) {}

  cachedRegistry = {
    userCount: Math.max(fileData.userCount, fileCount),
    lastRegistrationTime: fileData.lastRegistrationTime
  };
}

export function saveRegistryToDisk() {
  if (!cachedRegistry) return;
  
  try {
    ensureDir();
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(cachedRegistry, null, 2));
  } catch (error) {
    // 忽略保存失败
  }
}

export function checkRegistrationLimits() {
  if (!cachedRegistry) initRegistry();
  
  const now = Date.now();

  if (cachedRegistry.userCount >= MAX_USERS_PER_HOST) {
    return {
      allowed: false,
      reason: `达到本机用户数量上限 (${MAX_USERS_PER_HOST} 个)。`
    };
  }

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

export function recordRegistration(username) {
  if (!cachedRegistry) initRegistry();
  
  cachedRegistry.userCount++;
  cachedRegistry.lastRegistrationTime = Date.now();
}
