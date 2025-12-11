# 去中心化安全社交网络

基于 libp2p 的点对点加密社交网络系统,支持群组聊天和即时通讯。

## 项目特点

### 🔐 三层架构设计

1. **身份层 (Identity Layer)**
   - 使用 Scrypt 算法从用户名和密码派生密钥
   - 无需中心化数据库存储密码
   - 确定性密钥生成 (相同凭证总是生成相同密钥)

2. **网络层 (Network Layer)**
   - 基于 libp2p + GossipSub 实现 P2P 通信
   - 消息通过 Gossip 协议在网络中传播
   - 支持 NAT 穿透和多地址连接

3. **安全层 (Security Layer)**
   - 端到端加密 (NaCl Box: Curve25519 + XSalsa20 + Poly1305)
   - 群组使用对称加密 (NaCl SecretBox)
   - 点对点使用非对称加密
   - 用带宽换安全: 消息全网广播,只有持有密钥者能解密

## 核心功能

### 📱 群组聊天
- 创建加密群组
- 基于共享密钥的成员验证
- GossipSub 主题订阅机制
- 对称加密保证群组消息安全

### 💬 点对点即时通讯
- 两人私聊频道 (本质是"两人群组")
- 基于公钥哈希的频道ID生成
- 非对称加密保证消息私密性
- 元数据隐私保护

## 技术栈

- **libp2p**: P2P网络框架
- **GossipSub**: 发布订阅消息传播
- **Scrypt**: 密钥派生函数
- **TweetNaCl**: 加密算法库
- **Node.js**: 运行环境

## 安装依赖

```bash
npm install
```

## 快速开始

### 示例1: 基本使用

```javascript
import SecureSocialNetwork from './src/index.js';

// 创建客户端
const client = new SecureSocialNetwork();

// 初始化 (自动生成密钥对)
await client.initialize('alice', 'password123', 9001);

// 创建群组
const group = client.createGroup('我的群组');
console.log('群组ID:', group.groupId);
console.log('共享密钥:', group.sharedKey);

// 发送消息
await client.sendGroupMessage(group.groupId, 'Hello World!');
```

### 示例2: 运行演示

```bash
npm run test
```

该命令会启动两个节点 (Alice和Bob),演示群组聊天和点对点消息功能。

## API 文档

### 客户端初始化

```javascript
const client = new SecureSocialNetwork();
await client.initialize(username, password, port, bootstrapPeers);
```

**参数:**
- `username`: 用户名
- `password`: 密码
- `port`: P2P监听端口 (默认随机)
- `bootstrapPeers`: 引导节点地址数组 (可选)

### 群组功能

#### 创建群组
```javascript
const group = client.createGroup(groupName);
// 返回: { groupId, groupName, sharedKey, topic }
```

#### 加入群组
```javascript
client.joinGroup(groupId, groupName, sharedKey);
```

#### 发送群组消息
```javascript
await client.sendGroupMessage(groupId, content);
```

#### 离开群组
```javascript
client.leaveGroup(groupId);
```

#### 列出群组
```javascript
const groups = client.listGroups();
```

### 点对点消息功能

#### 开始对话
```javascript
const conversationId = client.startDirectMessage(peerPublicKey, peerName);
```

#### 发送私聊消息
```javascript
await client.sendDirectMessage(conversationId, content);
```

#### 结束对话
```javascript
client.endDirectMessage(conversationId);
```

#### 列出对话
```javascript
const conversations = client.listDirectMessages();
```

### 节点信息

#### 获取节点信息
```javascript
const info = client.getNodeInfo();
// 返回: { peerId, addresses, connectedPeers }
```

#### 获取公钥
```javascript
const publicKey = client.getPublicKey();
```

## 工作原理

### 密钥生成流程

```
用户名 + 密码
    ↓
Scrypt (N=16384, r=8, p=1)
    ↓
32字节种子
    ↓
Ed25519 密钥对 (公钥 + 私钥)
```

### 群组消息流程

```
1. 创建者生成随机共享密钥 (32字节)
2. 创建者通过外部渠道分享 (groupId + sharedKey)
3. 成员使用共享密钥订阅 GossipSub 主题
4. 发送消息时用共享密钥对称加密
5. GossipSub 将消息广播到所有订阅者
6. 只有持有密钥的成员能解密
```

### 点对点消息流程

```
1. Alice和Bob交换公钥
2. 生成会话ID = Hash(sort(AlicePK, BobPK))
3. 双方订阅 topic: dm/{conversationId}
4. Alice发送: 用Bob公钥加密消息
5. Bob接收: 用Bob私钥解密消息
```

## 安全特性

- ✅ **无密码存储**: 密钥从凭证实时派生
- ✅ **端到端加密**: 消息在传输和存储时都是加密的
- ✅ **元数据隐私**: 消息全网传播,隐藏通信图谱
- ✅ **前向安全**: 每条消息使用随机 nonce
- ✅ **抗篡改**: Poly1305 消息认证码验证完整性

## 系统架构

```
┌─────────────────────────────────────────┐
│          应用层 (Application)            │
│  - 群组聊天 (Group Chat)                 │
│  - 点对点消息 (Direct Message)           │
└────────────┬────────────────────────────┘
             │
┌────────────▼────────────────────────────┐
│          安全层 (Security)               │
│  - 对称加密 (NaCl SecretBox)             │
│  - 非对称加密 (NaCl Box)                 │
│  - 密钥派生 (Scrypt)                     │
└────────────┬────────────────────────────┘
             │
┌────────────▼────────────────────────────┐
│          网络层 (Network)                │
│  - libp2p (P2P框架)                      │
│  - GossipSub (发布订阅)                  │
│  - TCP传输 + Noise加密                   │
└──────────────────────────────────────────┘
```

## 项目结构

```
net_co/
├── src/
│   ├── crypto/              # 加密模块
│   │   ├── identity.js      # 身份和密钥管理
│   │   └── encryption.js    # 消息加密/解密
│   ├── network/             # 网络模块
│   │   └── p2pNode.js       # libp2p节点封装
│   ├── messaging/           # 消息模块
│   │   ├── groupChat.js     # 群组聊天
│   │   └── directMessage.js # 点对点消息
│   ├── examples/            # 示例代码
│   │   └── demo.js          # 完整演示
│   └── index.js             # 主入口
├── package.json
└── README.md
```

## 性能与权衡

### 带宽 vs 安全
- **策略**: 用带宽换安全
- **实现**: 消息全网 Gossip 传播
- **优势**:
  - 隐藏通信图谱
  - 无需中心路由
  - 抗审查和监控
- **劣势**:
  - 带宽消耗较高
  - 不适合大规模网络

### GossipSub 参数优化
- `D=6`: 维护6个紧密连接的对等节点
- `heartbeatInterval=1s`: 1秒心跳保证消息及时传递
- `seenTTL=2min`: 2分钟消息去重缓存

## 扩展方向

- 📁 文件分享 (IPFS集成)
- 🔔 离线消息存储 (DHT)
- 👥 群成员管理 (邀请/踢出)
- 🎨 前端UI (React/Vue)
- 📱 移动端适配 (React Native)
- 🔄 消息同步 (多设备)

## 注意事项

1. **密钥安全**: 私钥由密码派生,请使用强密码
2. **网络连接**: 确保防火墙允许 TCP 连接
3. **引导节点**: 生产环境需要稳定的引导节点
4. **消息大小**: 建议单条消息不超过 1MB
5. **对等节点**: 至少需要连接到1个对等节点才能通信

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request!

---

**警告**: 这是一个教育项目,未经过生产环境测试。在实际应用前请进行充分的安全审计。
