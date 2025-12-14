import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { hashData } from '../crypto/digest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define the data directory relative to the project root
// src/data/user_storage.js -> ../../data/user
const DATA_DIR = path.join(__dirname, '../../data/user');

/**
 * Save user data to a JSON file
 * @param {Object} userData - The user data to save
 * @param {string} userData.username - The username
 * @param {string} userData.password - The password (optional, but requested)
 * @param {string} userData.publicKey - The public key
 * @param {string} userData.secretKey - The secret key
 * @param {number} userData.port - The port used
 */
export function saveUser(userData) {
  try {
    // Ensure directory exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const { username } = userData;
    if (!username) {
      console.error('Username is required to save user data');
      return;
    }

    const filePath = path.join(DATA_DIR, `${username}.json`);
    
    // Load existing data to preserve fields like contacts
    let existingData = {};
    if (fs.existsSync(filePath)) {
      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        existingData = JSON.parse(fileContent);
      } catch (e) {
        console.warn(`Failed to read existing data for ${username}:`, e.message);
      }
    }

    // Hash password if present
    let passwordHash = undefined;
    if (userData.password) {
      passwordHash = hashData(userData.password);
    }

    // Add timestamp
    const dataToSave = {
      ...existingData, // Preserve existing data (like contacts)
      ...userData,     // Overwrite with new data
      password: passwordHash || userData.password || existingData.password,
      lastLogin: new Date().toISOString()
    };

    fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2), 'utf8');
    console.log(`💾 用户数据已保存至 ${filePath}`);
  } catch (error) {
    console.error('保存用户数据失败:', error);
  }
}

/**
 * Load user data from a JSON file
 * @param {string} username - The username to load
 * @returns {Object|null} The user data or null if not found
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
    console.error('读取用户数据失败:', error);
    return null;
  }
}
