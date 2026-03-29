import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { hashData } from '../crypto/digest.js';
import { error } from 'console';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../../data/user');

// 保存时合并已有数据，密码存哈希
export function saveUser(userData) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const username = userData.username;
    const filePath = path.join(DATA_DIR, `${username}.json`);
    
    let existingData = {};
    if (fs.existsSync(filePath)) {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        existingData = JSON.parse(fileContent);
      } catch (e) {
        console.warn(`Failed to read existing data for ${username}:`, e.message);
      }
    }

    let passwordHash = undefined;
    if (userData.password) {
      passwordHash = hashData(userData.password);
    }
    if (!passwordHash && !userData.password) {
      throw new error("密码摘要错误");
    }

    const dataToSave = {
      ...existingData,
      ...userData,
      password: passwordHash || existingData.password,
      lastLogin: new Date().toISOString()
    };

    fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2), 'utf8');
  } catch (error) {
    // 忽略错误
  }
}

export function loadUser(username) {
  try {
    const filePath = path.join(DATA_DIR, `${username}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const fileContent = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(fileContent);
  } catch (error) {
    return null;
  }
}
