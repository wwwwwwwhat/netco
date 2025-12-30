import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { hashData } from '../crypto/digest.js';
import { error } from 'console';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// src/data/user_storage.js -> ../../data/user
const DATA_DIR = path.join(__dirname, '../../data/user');

/**
 * 将用户信息保存为 Json 文件
 * @param {Object} userData 
 * @param {string} userData.username
 * @param {string} userData.password
 * @param {string} userData.publicKey
 * @param {string} userData.secretKey
 * @param {number} userData.port
 */
export function saveUser(userData) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const username = userData.username;

    const filePath = path.join(DATA_DIR, `${username}.json`);
    
    // 加载原来已经存在的用户数据信息
    let existingData = {};
    if (fs.existsSync(filePath)) {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        existingData = JSON.parse(fileContent);
      } catch (e) {
        console.warn(`Failed to read existing data for ${username}:`, e.message);
      }
    }

    // 存储密码哈希值
    let passwordHash = undefined;
    if (userData.password) {
      passwordHash = hashData(userData.password);
    }
    // 没有哈希值，没有原来的密码，直接抛出错误
    if (!passwordHash && !userData.password) {
      throw new error("密码摘要错误");
    }

    const dataToSave = {
      ...existingData,                                 // 保存原来存在的数据
      ...userData,                                     // 覆写新数据
      password: passwordHash || existingData.password, // 用户密码
      lastLogin: new Date().toISOString()              // 最新登录时间
    };

    fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2), 'utf8');
    // console.log(`用户数据已保存至 ${filePath}`);
  } catch (error) {
    // console.error('保存用户数据失败:', error);
  }
}

/**
 * 加载用户数据
 * @param {string} username
 * @returns {Object|null} 用户数据，没有返回 null
 */
export function loadUser(username) {
  try {
    const filePath = path.join(DATA_DIR, `${username}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const fileContent = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(fileContent);
  } catch (error) {
    // console.error('读取用户数据失败:', error);
    return null;
  }
}
