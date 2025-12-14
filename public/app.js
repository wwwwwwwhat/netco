/**
 * 前端应用主逻辑
 */

class SocialNetworkApp {
    constructor() {
        this.sessionId = null;
        this.ws = null;
        this.currentChat = null; // { type: 'group'|'direct', id: string, name: string }
        this.groups = new Map();
        this.conversations = new Map();
        this.contacts = new Map(); // Initialize contacts map
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.checkSession();
    }

    setupEventListeners() {
        // log in
        document.getElementById('loginBtn').addEventListener('click', () => {
            this.handleAuth('login');
        });

        // sign up
        document.getElementById('registerBtn').addEventListener('click', () => {
            this.handleAuth('register');
        });

        // log ui to sign ui
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                this.switchTab(tab);
            });
        });

        // group btn
        document.getElementById('createGroupBtn').addEventListener('click', () => {
            this.showCreateGroupModal();
        });

        // participate in the group
        document.getElementById('joinGroupForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleJoinGroup();
        });

        // new session
        document.getElementById('newChatBtn').addEventListener('click', () => {
            this.showNewChatModal();
        });

        // send msg
        document.getElementById('sendBtn').addEventListener('click', () => {
            this.sendMessage();
        });

        document.getElementById('messageInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });

        // leave from the session
        document.getElementById('leaveChatBtn').addEventListener('click', () => {
            this.leaveCurrentChat();
        });

        // log out
        document.getElementById('logoutBtn').addEventListener('click', () => {
            this.logout();
        });
        
        document.querySelector('.close').addEventListener('click', () => {
            this.hideModal();
        });

        window.addEventListener('click', (e) => {
            const modal = document.getElementById('modal');
            if (e.target === modal) {
                this.hideModal();
            }
        });

        // Prevent form submission
        document.getElementById('loginForm').addEventListener('submit', (e) => {
            e.preventDefault();
        });
    }

    async checkSession() {
        // 检查是否有保存的会话
        const savedSession = localStorage.getItem('sessionId');
        const savedUser = localStorage.getItem('currentUser');

        if (savedSession && savedUser) {
            this.sessionId = savedSession;
            try {
                this.currentUser = JSON.parse(savedUser);
            } catch (e) {
                console.error('解析用户信息失败', e);
                this.logout();
                return;
            }

            // 验证 Session 是否有效
            try {
                const response = await fetch(`/api/node-info?sessionId=${this.sessionId}`);
                if (!response.ok) {
                    throw new Error('Session invalid');
                }
                
                this.showMainScreen();
                this.connectWebSocket();
                this.updateUserInfo();
                this.loadData(); // Load data after session check
            } catch (error) {
                console.log('Session 已失效或服务器已重启', error);
                this.logout();
            }
        }
    }

    async handleAuth(type) {
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const port = document.getElementById('port').value || 0;
        
        if (!username || !password) {
            this.showError('请输入用户名和密码');
            return;
        }

        this.showStatus(type === 'login' ? '正在登录...' : '正在注册...');
        
        try {
            const response = await fetch(`/api/${type}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    username,
                    password,
                    port: parseInt(port)
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || '操作失败');
            }

            this.sessionId = data.sessionId;
            this.currentUser = {
                username: data.username,
                publicKey: data.publicKey
            };

            // 保存会话
            localStorage.setItem('sessionId', this.sessionId);
            localStorage.setItem('currentUser', JSON.stringify(this.currentUser));

            this.showMainScreen();
            this.connectWebSocket();
            this.updateUserInfo();
            this.loadData(); // Load data after session restore
            
        } catch (error) {
            this.showError(error.message);
        }
    }

    showMainScreen() {
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('mainScreen').classList.remove('hidden');
        
        const username = localStorage.getItem('username');
        document.getElementById('currentUsername').textContent = username || '用户';
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('WebSocket连接已建立');
            // 注册会话
            this.ws.send(JSON.stringify({
                type: 'register',
                sessionId: this.sessionId
            }));
        };

        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            this.handleIncomingMessage(message);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket错误:', error);
        };

        this.ws.onclose = () => {
            console.log('WebSocket连接已关闭');
            // 尝试重连
            setTimeout(() => {
                if (this.sessionId) {
                    this.connectWebSocket();
                }
            }, 3000);
        };
    }

    handleIncomingMessage(message) {
        if (message.type === 'group_message') {
            this.displayGroupMessage(message);
        } else if (message.type === 'direct_message') {
            this.displayDirectMessage(message);
        } else if (message.type === 'contact_request') {
            this.showRequestModal(message);
        } else if (message.type === 'contact_added') {
            this.loadContacts();
        } else if (message.type === 'contact_status_change') {
            this.updateContactStatus(message.contact);
        }
    }

    updateContactStatus(contact) {
        // Update local map
        if (this.contacts) {
            this.contacts.set(contact.publicKey, contact);
        }
        // Re-render list
        this.renderContactsList();
        
        // If currently chatting with this contact, update input state
        if (this.currentChat && this.currentChat.type === 'direct' && this.currentChat.publicKey === contact.publicKey) {
            this.updateInputState(contact.status);
        }
    }

    async loadData() {
        await Promise.all([
            this.loadGroups(),
            this.loadContacts(),
            this.loadNodeInfo()
        ]);
    }
    
    async loadContacts() {
        try {
            const response = await fetch(`/api/contacts?sessionId=${this.sessionId}`);
            const contacts = await response.json();
            
            // Only clear if we got a valid array
            if (Array.isArray(contacts)) {
                this.contacts.clear();
                contacts.forEach(contact => {
                    this.contacts.set(contact.publicKey, contact);
                });
                this.renderContactsList();
            }
        } catch (error) {
            console.error('加载联系人失败:', error);
        }
    }

    renderContactsList() {
        const listEl = document.getElementById('conversationsList');
        if (!listEl) return;
        listEl.innerHTML = '';

        if (!this.contacts) {
            this.contacts = new Map();
        }

        this.contacts.forEach((contact) => {
            const item = document.createElement('div');
            item.className = 'list-item';
            // item.dataset.convId = convId; // We don't have convId yet maybe
            
            // Check status (mock logic for now, or based on p2p connection if we had it)
            const statusClass = contact.status === 'online' ? 'status-online' : 'status-offline';
            
            item.innerHTML = `
                <div class="list-item-title">
                    ${contact.username}
                    <span class="status-dot ${statusClass}"></span>
                </div>
                <div class="list-item-subtitle">ID: ${contact.peerId ? contact.peerId.substring(0, 10) + '...' : 'Unknown'}</div>
            `;
            item.addEventListener('click', () => {
                this.openDirectChat(contact.publicKey, contact.username);
            });
            listEl.appendChild(item);
        });
    }
    
    showRequestModal(request) {
        const modal = document.getElementById('requestModal');
        const infoEl = document.getElementById('requestInfo');
        
        infoEl.innerHTML = `
            <p><strong>用户名:</strong> ${request.sender.username}</p>
            <p><strong>ID:</strong> ${request.sender.peerId}</p>
            <p><strong>公钥:</strong> <span style="font-size: 10px; word-break: break-all;">${request.sender.publicKey}</span></p>
        `;
        
        modal.classList.remove('hidden');
        
        // Remove old listeners to avoid duplicates (simple way)
        const acceptBtn = document.getElementById('acceptRequestBtn');
        const rejectBtn = document.getElementById('rejectRequestBtn');
        
        const newAcceptBtn = acceptBtn.cloneNode(true);
        const newRejectBtn = rejectBtn.cloneNode(true);
        
        acceptBtn.parentNode.replaceChild(newAcceptBtn, acceptBtn);
        rejectBtn.parentNode.replaceChild(newRejectBtn, rejectBtn);
        
        newAcceptBtn.addEventListener('click', () => {
            this.respondToRequest(request, true);
            modal.classList.add('hidden');
        });
        
        newRejectBtn.addEventListener('click', () => {
            this.respondToRequest(request, false);
            modal.classList.add('hidden');
        });
    }
    
    async respondToRequest(request, accepted) {
        try {
            await fetch('/api/contacts/respond', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId: this.sessionId,
                    targetPublicKey: request.sender.publicKey,
                    targetUsername: request.sender.username,
                    targetPeerId: request.sender.peerId,
                    accepted
                })
            });
            
            if (accepted) {
                await this.loadContacts();
            }
        } catch (error) {
            console.error('响应请求失败:', error);
        }
    }

    // ...existing code...


    async loadNodeInfo() {
        try {
            const response = await fetch(`/api/node-info?sessionId=${this.sessionId}`);
            if (!response.ok) throw new Error('Failed to fetch node info');
            const info = await response.json();
            
            // 获取公钥
            const publicKeyResponse = await fetch(`/api/public-key?sessionId=${this.sessionId}`);
            if (!publicKeyResponse.ok) throw new Error('Failed to fetch public key');
            const publicKeyData = await publicKeyResponse.json();
            
            const peerIdDisplay = info.peerId ? info.peerId : 'Unknown';
            
            let addressesHtml = '';
            if (info.addresses && info.addresses.length > 0) {
                addressesHtml = info.addresses.map(addr => `<div style="font-size: 11px; word-break: break-all; margin-bottom: 4px;">${addr}</div>`).join('');
            } else {
                addressesHtml = '<div>N/A</div>';
            }

            const connectedPeersCount = info.connectedPeers ? info.connectedPeers.length : 0;

            const infoHtml = `
                <div style="margin-bottom: 15px;">
                    <strong>节点ID:</strong>
                    <div style="font-size: 11px; word-break: break-all; background: #f0f0f0; padding: 5px; border-radius: 4px;">${peerIdDisplay}</div>
                </div>
                <div style="margin-bottom: 15px;">
                    <strong>连接数:</strong> ${connectedPeersCount}
                </div>
                <div style="margin-bottom: 15px;">
                    <strong>监听地址:</strong>
                    <div style="background: #f0f0f0; padding: 5px; border-radius: 4px; max-height: 100px; overflow-y: auto;">
                        ${addressesHtml}
                    </div>
                </div>
                
                <div style="margin-bottom: 15px; padding-top: 15px; border-top: 1px solid #e0e0e0;">
                    <strong>手动连接节点:</strong>
                    <form id="manualConnectForm" style="margin-top: 10px;">
                        <input type="text" id="peerMultiaddr" placeholder="/ip4/..." style="width: 100%; padding: 8px; margin-bottom: 8px; border: 1px solid #ddd; border-radius: 4px;">
                        <button type="submit" class="btn btn-primary btn-small" style="width: 100%;">连接</button>
                    </form>
                </div>

                <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e0e0e0;">
                    <strong>我的公钥:</strong>
                    <div style="background: #f0f0f0; padding: 8px; border-radius: 4px; margin-top: 5px; font-size: 11px; word-break: break-all; cursor: pointer;" onclick="navigator.clipboard.writeText('${publicKeyData.publicKey}'); alert('公钥已复制到剪贴板');">
                        ${publicKeyData.publicKey}
                    </div>
                    <div style="font-size: 11px; color: #666; margin-top: 5px;">点击复制</div>
                </div>
            `;
            const networkInfoEl = document.getElementById('networkInfo');
            if (networkInfoEl) {
                networkInfoEl.innerHTML = infoHtml;
                
                // Add event listener for manual connect form
                const form = document.getElementById('manualConnectForm');
                if (form) {
                    form.addEventListener('submit', async (e) => {
                        e.preventDefault();
                        const multiaddr = document.getElementById('peerMultiaddr').value.trim();
                        if (!multiaddr) return;
                        
                        try {
                            const btn = form.querySelector('button');
                            const originalText = btn.textContent;
                            btn.textContent = '连接中...';
                            btn.disabled = true;
                            
                            const res = await fetch('/api/network/connect', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ sessionId: this.sessionId, multiaddr })
                            });
                            
                            if (!res.ok) {
                                const data = await res.json();
                                throw new Error(data.error || '连接失败');
                            }
                            
                            alert('连接成功!');
                            document.getElementById('peerMultiaddr').value = '';
                            this.loadNodeInfo(); // Refresh info
                        } catch (err) {
                            alert('连接失败: ' + err.message);
                        } finally {
                            const btn = form.querySelector('button');
                            btn.textContent = '连接';
                            btn.disabled = false;
                        }
                    });
                }
            }
        } catch (error) {
            console.error('加载节点信息失败:', error);
            const networkInfoEl = document.getElementById('networkInfo');
            if (networkInfoEl) {
                networkInfoEl.innerHTML = `<div style="color: red;">加载失败: ${error.message}</div>`;
            }
        }
    }

    renderGroupsList() {
        const listEl = document.getElementById('groupsList');
        listEl.innerHTML = '';

        this.groups.forEach((group, groupId) => {
            const item = document.createElement('div');
            item.className = 'list-item';
            item.dataset.groupId = groupId;
            item.innerHTML = `
                <div class="list-item-title">${group.name}</div>
                <div class="list-item-subtitle">ID: ${groupId}</div>
            `;
            item.addEventListener('click', () => {
                this.openGroupChat(groupId, group.name);
            });
            listEl.appendChild(item);
        });
    }

    renderConversationsList() {
        const listEl = document.getElementById('conversationsList');
        listEl.innerHTML = '';

        this.conversations.forEach((conv, convId) => {
            const item = document.createElement('div');
            item.className = 'list-item';
            item.dataset.convId = convId;
            item.innerHTML = `
                <div class="list-item-title">${conv.peerName}</div>
                <div class="list-item-subtitle">ID: ${convId}</div>
            `;
            item.addEventListener('click', () => {
                this.openDirectChat(convId, conv.peerName);
            });
            listEl.appendChild(item);
        });
    }

    switchTab(tab) {
        // 更新按钮状态
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tab}"]`).classList.add('active');

        // 更新内容
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(`${tab}Tab`).classList.add('active');

        // 如果切换到网络标签，刷新节点信息
        if (tab === 'network') {
            this.loadNodeInfo();
        }
    }

    showCreateGroupModal() {
        const modalBody = document.getElementById('modalBody');
        modalBody.innerHTML = `
            <h2>创建群组</h2>
            <form id="createGroupForm">
                <div class="form-group">
                    <label>群组名称</label>
                    <input type="text" id="newGroupName" required placeholder="输入群组名称">
                </div>
                <button type="submit" class="btn btn-primary">创建</button>
            </form>
        `;

        document.getElementById('modal').classList.remove('hidden');

        document.getElementById('createGroupForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const groupName = document.getElementById('newGroupName').value;
            await this.createGroup(groupName);
            this.hideModal();
        });
    }

    async createGroup(groupName) {
        try {
            const response = await fetch('/api/groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.sessionId, groupName })
            });

            const group = await response.json();
            
            // 显示群组信息
            alert(`群组创建成功！\n\n群组ID: ${group.groupId}\n共享密钥: ${group.sharedKey}\n\n请保存这些信息，以便其他人加入群组。`);
            
            await this.loadGroups();
            this.openGroupChat(group.groupId, group.groupName);
        } catch (error) {
            alert('创建群组失败: ' + error.message);
        }
    }

    async handleJoinGroup() {
        const groupId = document.getElementById('joinGroupId').value;
        const groupName = document.getElementById('joinGroupName').value;
        const sharedKey = document.getElementById('joinGroupKey').value;

        try {
            const response = await fetch('/api/groups/join', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.sessionId, groupId, groupName, sharedKey })
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || '加入失败');
            }

            await this.loadGroups();
            this.openGroupChat(groupId, groupName);
            
            // 清空表单
            document.getElementById('joinGroupForm').reset();
        } catch (error) {
            alert('加入群组失败: ' + error.message);
        }
    }

    showNewChatModal() {
        const modalBody = document.getElementById('modalBody');
        modalBody.innerHTML = `
            <h2>添加好友</h2>
            <form id="newChatForm">
                <div class="form-group">
                    <label>对方公钥</label>
                    <textarea id="peerPublicKey" required placeholder="粘贴对方的公钥" rows="3"></textarea>
                </div>
                <button type="submit" class="btn btn-primary">发送好友请求</button>
            </form>
        `;

        document.getElementById('modal').classList.remove('hidden');

        document.getElementById('newChatForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const peerPublicKey = document.getElementById('peerPublicKey').value.trim();
            
            await this.sendContactRequest(peerPublicKey);
            this.hideModal();
        });
    }

    async sendContactRequest(targetPublicKey) {
        try {
            const response = await fetch('/api/contacts/request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    sessionId: this.sessionId, 
                    targetPublicKey
                })
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || '请求失败');
            }
            
            alert('好友请求已发送！等待对方确认。');
        } catch (error) {
            alert('发送请求失败: ' + error.message);
        }
    }

    async openDirectChat(peerPublicKey, peerName) {
        try {
            // Get or create conversation ID
            const response = await fetch('/api/direct-messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    sessionId: this.sessionId, 
                    peerPublicKey, 
                    peerName 
                })
            });
            
            if (!response.ok) throw new Error('Failed to start chat');
            
            const data = await response.json();
            const conversationId = data.conversationId;

            this.currentChat = {
                type: 'direct',
                id: conversationId,
                name: peerName,
                publicKey: peerPublicKey
            };

            this.updateChatHeader(peerName, '私聊');
            this.clearMessages();
            
            // Check contact status and update input
            const contact = this.contacts.get(peerPublicKey);
            this.updateInputState(contact ? contact.status : 'offline');

            await this.loadHistory(peerPublicKey, 'direct');
        } catch (error) {
            console.error('打开对话失败:', error);
            alert('无法打开对话: ' + error.message);
        }
    }

    updateInputState(status) {
        const input = document.getElementById('messageInput');
        const btn = document.getElementById('sendBtn');
        
        if (status === 'online') {
            input.disabled = false;
            input.placeholder = "输入消息...";
            btn.disabled = false;
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-primary');
        } else {
            input.disabled = true;
            input.placeholder = "对方不在线，无法发送消息";
            btn.disabled = true;
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-secondary');
        }
    }

    async openGroupChat(groupId, groupName) {
        this.currentChat = {
            type: 'group',
            id: groupId,
            name: groupName
        };

        this.updateChatHeader(groupName, '群组');
        this.clearMessages();
        this.updateActiveListItem('groupsList', groupId);
        
        await this.loadHistory(groupId, 'group');
    }

    async loadHistory(targetId, type) {
        try {
            const response = await fetch(`/api/history?sessionId=${this.sessionId}&targetId=${encodeURIComponent(targetId)}&type=${type}`);
            if (response.ok) {
                const history = await response.json();
                history.forEach(msg => {
                    this.displayMessage({
                        senderName: msg.senderName,
                        content: msg.content,
                        timestamp: new Date(msg.date).getTime(),
                        isOwn: msg.senderName === this.currentUser.username
                    });
                });
            }
        } catch (error) {
            console.error('Failed to load history:', error);
        }
    }

    async openGroupChat(groupId, groupName) {
        this.currentChat = {
            type: 'group',
            id: groupId,
            name: groupName
        };

        this.updateChatHeader(groupName, '群组');
        this.clearMessages();
        this.updateActiveListItem('groupsList', groupId);
        
        await this.loadHistory(groupId, 'group');
    }

    async loadHistory(targetId, type) {
        try {
            const response = await fetch(`/api/history?sessionId=${this.sessionId}&targetId=${encodeURIComponent(targetId)}&type=${type}`);
            if (response.ok) {
                const history = await response.json();
                history.forEach(msg => {
                    this.displayMessage({
                        senderName: msg.senderName,
                        content: msg.content,
                        timestamp: new Date(msg.date).getTime(),
                        isOwn: msg.senderName === this.currentUser.username
                    });
                });
            }
        } catch (error) {
            console.error('Failed to load history:', error);
        }
    }

    async sendMessage() {
        const input = document.getElementById('messageInput');
        const content = input.value.trim();
        
        if (!content || !this.currentChat) return;
        
        try {
            let url;
            if (this.currentChat.type === 'group') {
                url = `/api/groups/${this.currentChat.id}/messages`;
            } else {
                url = `/api/direct-messages/${this.currentChat.id}/messages`;
            }
            
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    sessionId: this.sessionId, 
                    content 
                })
            });
            
            if (!response.ok) {
                throw new Error('发送失败');
            }
            
            // 清空输入框
            input.value = '';
            
            // 手动添加到UI
            this.displayMessage({
                senderName: this.currentUser.username,
                content: content,
                timestamp: Date.now(),
                isOwn: true
            });
            
        } catch (error) {
            console.error('发送消息错误:', error);
            alert('发送消息失败: ' + error.message);
        }
    }

    displayGroupMessage(message) {
        if (this.currentChat && this.currentChat.type === 'group' && this.currentChat.id === message.groupId) {
            this.displayMessage({
                senderName: message.senderName,
                content: message.content,
                timestamp: message.timestamp,
                isOwn: false
            });
        }
    }

    displayDirectMessage(message) {
        // Check if the message belongs to the current chat
        // The message might not have conversationId if it comes from P2P directly
        // So we check if the sender matches the current chat's public key
        const isCurrentChat = this.currentChat && 
                              this.currentChat.type === 'direct' && 
                              (this.currentChat.id === message.conversationId || 
                               this.currentChat.publicKey === message.senderPublicKey);

        if (isCurrentChat) {
            this.displayMessage({
                senderName: message.senderName,
                content: message.content,
                timestamp: message.timestamp,
                isOwn: false
            });
        }
    }

    displayMessage(message) {
        const container = document.getElementById('messagesContainer');
        const messageEl = document.createElement('div');
        messageEl.className = `message ${message.isOwn ? 'own' : 'other'}`;
        
        const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
        });

        messageEl.innerHTML = `
            <div class="message-sender">${message.senderName}</div>
            <div class="message-content">${this.escapeHtml(message.content)}</div>
            <div class="message-time">${time}</div>
        `;

        container.appendChild(messageEl);
        container.scrollTop = container.scrollHeight;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async leaveCurrentChat() {
        if (!this.currentChat) return;

        if (this.currentChat.type === 'group') {
            try {
                await fetch(`/api/groups/${this.currentChat.id}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId: this.sessionId })
                });
                await this.loadGroups();
            } catch (error) {
                console.error('离开群组失败:', error);
            }
        }

        this.currentChat = null;
        document.getElementById('emptyState').classList.remove('hidden');
        document.getElementById('chatView').classList.add('hidden');
    }

    hideModal() {
        document.getElementById('modal').classList.add('hidden');
    }

    logout() {
        if (this.ws) {
            this.ws.close();
        }
        localStorage.removeItem('sessionId');
        localStorage.removeItem('currentUser'); // Remove currentUser as well
        this.sessionId = null;
        this.currentUser = null;
        document.getElementById('mainScreen').classList.add('hidden');
        document.getElementById('loginScreen').classList.remove('hidden');
        
        // Clear input fields
        document.getElementById('username').value = '';
        document.getElementById('password').value = '';
        document.getElementById('port').value = '';
        
        // Clear status messages
        const errorEl = document.getElementById('loginError');
        const statusEl = document.getElementById('loginStatus');
        if (errorEl) errorEl.classList.remove('show');
        if (statusEl) statusEl.classList.remove('show');
    }

    showError(message) {
        const errorEl = document.getElementById('loginError');
        const statusEl = document.getElementById('loginStatus');
        
        errorEl.textContent = message;
        errorEl.classList.add('show');
        statusEl.classList.remove('show');
    }

    showStatus(message) {
        const errorEl = document.getElementById('loginError');
        const statusEl = document.getElementById('loginStatus');
        
        statusEl.textContent = message;
        statusEl.classList.add('show');
        errorEl.classList.remove('show');
    }

    updateUserInfo() {
        if (this.currentUser) {
            document.getElementById('currentUsername').textContent = this.currentUser.username;
            
            const pubKey = this.currentUser.publicKey;
            const idEl = document.getElementById('currentUserId');
            
            idEl.textContent = `ID: ${pubKey}`;
            idEl.title = "点击复制完整公钥";
            idEl.style.cursor = "pointer";
            
            // 移除旧的事件监听器（如果有）
            const newIdEl = idEl.cloneNode(true);
            idEl.parentNode.replaceChild(newIdEl, idEl);
            
            newIdEl.onclick = () => {
                navigator.clipboard.writeText(pubKey).then(() => {
                    alert('公钥已复制到剪贴板');
                });
            };
            
            this.loadData();
        }
    }

    updateChatHeader(name, type) {
        document.getElementById('chatView').classList.remove('hidden');
        document.getElementById('chatTitle').textContent = `${name} (${type})`;
        document.getElementById('emptyState').classList.add('hidden');
    }

    clearMessages() {
        document.getElementById('messagesContainer').innerHTML = '';
    }
}

// 启动应用
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new SocialNetworkApp();
});

