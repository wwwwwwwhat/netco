# 系统架构详解

## 整体设计思路

本项目实现了一个去中心化的安全社交网络,采用"用带宽换安全"的策略,通过 GossipSub 全网广播消息,只有持有密钥的节点才能解密。

## 三层架构

### 1. 身份层 (Identity Layer)

**目标**: 无需数据库的用户身份管理

**实现方案**:
- 输入: 用户名 + 密码
- 处理: Scrypt 密钥派生函数
- 输出: Ed25519 密钥对

```javascript
// 伪代码
seed = Scrypt(username + password, salt=username, N=16384, r=8, p=1)
keyPair = Ed25519.generateFromSeed(seed)
```

**关键特性**:
- 确定性生成: 相同凭证总是生成相同密钥
- 无状态: 不需要存储任何用户数据
- 安全性: Scrypt 算法抗暴力破解

**文件**: `src/crypto/identity.js`

### 2. 网络层 (Network Layer)

**目标**: 实现元数据隐私的 P2P 通信

**核心组件**:
- **libp2p**: 模块化的 P2P 网络框架
- **GossipSub**: 发布订阅消息传播协议
- **TCP**: 传输层协议
- **Noise**: 连接层加密
- **Mplex**: 流多路复用

**GossipSub 工作原理**:
```
节点A ──┐
        ├──> Topic: group/abc
节点B ──┤
        └──> 消息通过 Gossip 传播到所有订阅者
节点C ──┘
```

**参数调优**:
- `D=6`: 每个节点维护6个核心连接
- `Dlo=4`: 最少4个连接
- `Dhi=12`: 最多12个连接
- `heartbeatInterval=1000ms`: 1秒心跳

**文件**: `src/network/p2pNode.js`

### 3. 安全层 (Security Layer)

**目标**: 端到端加密通信

**加密方案**:

#### 非对称加密 (点对点消息)
- 算法: NaCl Box (Curve25519 + XSalsa20 + Poly1305)
- 流程:
  1. 发送方用接收方公钥加密
  2. 生成随机 nonce (24字节)
  3. 接收方用自己私钥解密

```javascript
encrypted = Box(message, nonce, recipientPublicKey, senderSecretKey)
```

#### 对称加密 (群组消息)
- 算法: NaCl SecretBox (XSalsa20 + Poly1305)
- 流程:
  1. 群组创建时生成共享密钥
  2. 发送方用共享密钥加密
  3. 接收方用相同密钥解密

```javascript
encrypted = SecretBox(message, nonce, sharedKey)
```

**文件**: `src/crypto/encryption.js`

## 应用层功能

### 群组聊天 (Group Chat)

**设计思路**: 群组 = Topic + 共享密钥

**实现步骤**:
1. 创建者生成随机共享密钥 (32字节)
2. 创建者生成群组ID (基于名称和时间戳哈希)
3. 生成 GossipSub Topic: `group/{groupId}`
4. 创建者通过外部渠道分享 (groupId + sharedKey)
5. 成员使用共享密钥订阅 Topic
6. 发送消息时用共享密钥对称加密
7. GossipSub 广播消息到所有订阅者
8. 只有持有密钥的成员能解密

**消息格式**:
```json
{
  "type": "group_message",
  "groupId": "abc123",
  "senderPublicKey": "base64...",
  "senderName": "alice",
  "encryptedContent": "base64...",
  "timestamp": 1234567890
}
```

**文件**: `src/messaging/groupChat.js`

### 点对点消息 (Direct Message)

**设计思路**: 私聊 = "两人群组"

**巧妙之处**:
- 不需要直接连接两个节点
- 通过共享频道ID实现私聊
- 频道ID对外界不可见

**实现步骤**:
1. Alice 和 Bob 交换公钥
2. 双方独立计算会话ID:
   ```javascript
   conversationId = Hash(sort(AlicePublicKey, BobPublicKey))
   ```
3. 生成 Topic: `dm/{conversationId}`
4. 双方订阅该 Topic
5. Alice 发送: 用 Bob 公钥加密消息
6. Bob 接收: 用 Bob 私钥解密消息

**为什么要排序公钥?**
- 确保 Alice 和 Bob 计算出相同的会话ID
- 无论谁先发起对话,频道ID都一致

**消息格式**:
```json
{
  "type": "direct_message",
  "conversationId": "xyz789",
  "senderPublicKey": "base64...",
  "senderName": "alice",
  "encryptedContent": "base64...",
  "timestamp": 1234567890
}
```

**文件**: `src/messaging/directMessage.js`

## 消息传播机制

### GossipSub 详解

GossipSub 是一个基于 Gossip 协议的发布订阅系统。

**核心概念**:

1. **Mesh (网格)**: 每个 Topic 的紧密连接节点集合
2. **Fanout (扇出)**: 用于向未订阅的 Topic 发送消息
3. **Gossip (流言)**: 定期交换消息元数据

**消息传播流程**:

```
时刻 T0: Alice 发布消息到 Topic A
    ↓
时刻 T1: 消息发送到 Alice 的 Mesh 节点 (B, C, D)
    ↓
时刻 T2: B, C, D 转发到各自的 Mesh 节点
    ↓
时刻 T3: 消息传播到整个网络
    ↓
时刻 T4: 后续通过 Gossip 确保所有节点收到
```

**去重机制**:
- 每条消息有唯一 ID
- 节点维护 `seenTTL=2分钟` 的缓存
- 收到重复消息时丢弃

**优势**:
- 高可靠性: 多路径传播
- 抗审查: 无中心节点
- 自愈能力: 节点失效自动恢复

**劣势**:
- 带宽消耗: 消息重复传输
- 延迟: 需要多跳传播
- 不适合大规模网络

## 安全分析

### 威胁模型

**假设**:
- 网络是公开的,任何人都能监听
- 存在恶意节点
- 攻击者可以分析流量

**防御措施**:

1. **消息机密性**
   - 威胁: 攻击者截获消息
   - 防御: 端到端加密,只有接收方能解密

2. **元数据隐私**
   - 威胁: 分析通信图谱 (谁和谁聊天)
   - 防御: 消息全网广播,无法判断真实接收者

3. **身份认证**
   - 威胁: 假冒身份发送消息
   - 防御: 消息包含发送方公钥,可验证身份

4. **消息完整性**
   - 威胁: 篡改消息内容
   - 防御: Poly1305 MAC 验证

5. **重放攻击**
   - 威胁: 重复发送旧消息
   - 防御: 随机 nonce + 时间戳

### 安全局限性

1. **密码强度依赖**
   - 密钥从密码派生
   - 弱密码容易被暴力破解

2. **无前向安全**
   - 私钥泄露会暴露所有历史消息
   - 改进: 实现 Signal 协议的 Ratchet 机制

3. **无消息否认性**
   - 发送方签名可作为证据
   - 改进: 使用 OTR 协议

4. **Sybil 攻击**
   - 恶意节点可大量创建身份
   - 改进: PoW 或声誉系统

## 性能优化

### 带宽优化

**当前策略**: 全网广播
- 优点: 元数据隐私
- 缺点: 带宽浪费

**可能改进**:
1. **DHT 路由**: 基于接收方公钥路由
2. **分片 Topic**: 按用户ID范围分片
3. **bloom filter**: 用标签过滤无关消息

### 连接优化

**参数调优**:
```javascript
connectionManager: {
  minConnections: 3,   // 最少连接数
  maxConnections: 100, // 最多连接数
  autoDial: true,      // 自动拨号
}
```

**策略**:
- 保持少量核心连接
- 按需建立临时连接
- 定期清理空闲连接

### 消息缓存

GossipSub 内置消息缓存:
- `mcacheLength=5`: 缓存5个时间窗口
- `mcacheGossip=3`: Gossip 使用3个窗口
- `seenTTL=120s`: 去重缓存2分钟

## 扩展功能

### 1. 离线消息

**方案**: 使用 IPFS + DHT

```javascript
// 发送离线消息
messageId = ipfs.add(encryptedMessage)
dht.put(recipientPublicKey, messageId)

// 接收离线消息
messageIds = dht.get(myPublicKey)
messages = messageIds.map(id => ipfs.get(id))
```

### 2. 文件分享

**方案**: IPFS 集成

```javascript
// 上传文件
cid = ipfs.add(file)
sendMessage(group, `文件: ${cid}`)

// 下载文件
file = ipfs.get(cid)
```

### 3. 多设备同步

**方案**: 设备链 + 同步协议

```javascript
// 主设备
deviceChain = [device1PublicKey, device2PublicKey]
syncTopic = `sync/${userPublicKey}`

// 新设备加入
newDevice.subscribe(syncTopic)
syncHistory()
```

## 实现细节

### 密钥管理

**密钥类型**:
- Ed25519 签名密钥: 用于节点身份
- Curve25519 加密密钥: 用于消息加密

**转换**:
```javascript
// Ed25519 -> Curve25519
signingKey = Ed25519.generateKeyPair()
encryptionKey = Curve25519.fromEd25519(signingKey)
```

### 消息序列化

**格式**: JSON
- 优点: 易读,调试方便
- 缺点: 体积较大

**可能改进**: 使用 Protobuf 或 MessagePack

### 错误处理

**策略**:
1. 解密失败 -> 静默丢弃 (可能不是发给自己)
2. 网络错误 -> 自动重连
3. 消息过大 -> 拒绝发送

## 部署建议

### 引导节点

生产环境需要稳定的引导节点:

```javascript
const bootstrapPeers = [
  '/ip4/1.2.3.4/tcp/9001/p2p/QmBootstrap1',
  '/ip4/5.6.7.8/tcp/9001/p2p/QmBootstrap2'
]
```

**要求**:
- 高可用性 (99.9% uptime)
- 公网可访问
- 充足带宽

### NAT 穿透

**方案**:
1. UPnP/NAT-PMP 自动端口映射
2. STUN 服务器获取公网地址
3. TURN 服务器中继流量 (备用)

### 监控

**关键指标**:
- 连接数
- 消息延迟
- 带宽使用
- 错误率

## 测试策略

### 单元测试
- 密钥派生正确性
- 加密/解密功能
- 消息序列化

### 集成测试
- 多节点通信
- 消息传播延迟
- 网络分区恢复

### 安全测试
- 中间人攻击
- 重放攻击
- DoS 攻击

## 参考资料

- [libp2p 文档](https://docs.libp2p.io/)
- [GossipSub 规范](https://github.com/libp2p/specs/blob/master/pubsub/gossipsub/)
- [NaCl 加密库](https://nacl.cr.yp.to/)
- [Scrypt 论文](https://www.tarsnap.com/scrypt/scrypt.pdf)
