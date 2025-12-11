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
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.checkSession();
    }

    setupEventListeners() {
        // 登录表单
        document.getElementById('loginForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        // 标签切换
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                this.switchTab(tab);
            });
        });

        // 创建群组
        document.getElementById('createGroupBtn').addEventListener('click', () => {
            this.showCreateGroupModal();
        });

        // 加入群组
        document.getElementById('joinGroupForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleJoinGroup();
        });

        // 新对话
        document.getElementById('newChatBtn').addEventListener('click', () => {
            this.showNewChatModal();
        });

        // 发送消息
        document.getElementById('sendBtn').addEventListener('click', () => {
            this.sendMessage();
        });

        document.getElementById('messageInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });

        // 离开聊天
        document.getElementById('leaveChatBtn').addEventListener('click', () => {
            this.leaveCurrentChat();
        });

        // 退出登录
        document.getElementById('logoutBtn').addEventListener('click', () => {
            this.logout();
        });

        // 模态框关闭
        document.querySelector('.close').addEventListener('click', () => {
            this.hideModal();
        });

        window.addEventListener('click', (e) => {
            const modal = document.getElementById('modal');
            if (e.target === modal) {
                this.hideModal();
            }
        });
    }

    checkSession() {
        // 检查是否有保存的会话
        const savedSession = localStorage.getItem('sessionId');
        if (savedSession) {
            this.sessionId = savedSession;
            this.showMainScreen();
            this.connectWebSocket();
            this.loadData();
        }
    }

    async handleLogin() {
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const port = document.getElementById('port').value || 0;

        const errorEl = document.getElementById('loginError');
        const statusEl = document.getElementById('loginStatus');
        
        errorEl.classList.remove('show');
        statusEl.classList.remove('show');
        statusEl.textContent = '正在初始化...';
        statusEl.classList.add('show');

        try {
            const response = await fetch('/api/initialize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, port })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || '初始化失败');
            }

            this.sessionId = data.sessionId;
            localStorage.setItem('sessionId', this.sessionId);
            localStorage.setItem('username', username);

            statusEl.textContent = '初始化成功！';
            setTimeout(() => {
                this.showMainScreen();
                this.connectWebSocket();
                this.loadData();
            }, 1000);

        } catch (error) {
            errorEl.textContent = error.message;
            errorEl.classList.add('show');
            statusEl.classList.remove('show');
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
        }
    }

    async loadData() {
        await Promise.all([
            this.loadGroups(),
            this.loadConversations(),
            this.loadNodeInfo()
        ]);
    }

    async loadGroups() {
        try {
            const response = await fetch(`/api/groups?sessionId=${this.sessionId}`);
            const groups = await response.json();
            
            this.groups.clear();
            groups.forEach(group => {
                this.groups.set(group.id, group);
            });
            
            this.renderGroupsList();
        } catch (error) {
            console.error('加载群组失败:', error);
        }
    }

    async loadConversations() {
        try {
            const response = await fetch(`/api/direct-messages?sessionId=${this.sessionId}`);
            const conversations = await response.json();
            
            this.conversations.clear();
            conversations.forEach(conv => {
                this.conversations.set(conv.id, conv);
            });
            
            this.renderConversationsList();
        } catch (error) {
            console.error('加载对话失败:', error);
        }
    }

    async loadNodeInfo() {
        try {
            const response = await fetch(`/api/node-info?sessionId=${this.sessionId}`);
            const info = await response.json();
            
            // 获取公钥
            const publicKeyResponse = await fetch(`/api/public-key?sessionId=${this.sessionId}`);
            const publicKeyData = await publicKeyResponse.json();
            
            const infoHtml = `
                <div><strong>节点ID:</strong> ${info.peerId.substring(0, 20)}...</div>
                <div><strong>连接数:</strong> ${info.connectedPeers.length}</div>
                <div><strong>地址:</strong> ${info.addresses[0] || 'N/A'}</div>
                <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e0e0e0;">
                    <strong>我的公钥:</strong>
                    <div style="background: #f0f0f0; padding: 8px; border-radius: 4px; margin-top: 5px; font-size: 11px; word-break: break-all; cursor: pointer;" onclick="navigator.clipboard.writeText('${publicKeyData.publicKey}'); alert('公钥已复制到剪贴板');">
                        ${publicKeyData.publicKey}
                    </div>
                    <div style="font-size: 11px; color: #666; margin-top: 5px;">点击复制</div>
                </div>
            `;
            document.getElementById('networkInfo').innerHTML = infoHtml;
        } catch (error) {
            console.error('加载节点信息失败:', error);
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
            <h2>开始新对话</h2>
            <form id="newChatForm">
                <div class="form-group">
                    <label>对方公钥</label>
                    <textarea id="peerPublicKey" required placeholder="粘贴对方的公钥" rows="3"></textarea>
                </div>
                <div class="form-group">
                    <label>对方用户名</label>
                    <input type="text" id="peerName" required placeholder="输入对方用户名">
                </div>
                <button type="submit" class="btn btn-primary">开始对话</button>
            </form>
        `;

        document.getElementById('modal').classList.remove('hidden');

        document.getElementById('newChatForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const peerPublicKey = document.getElementById('peerPublicKey').value.trim();
            const peerName = document.getElementById('peerName').value;
            await this.startConversation(peerPublicKey, peerName);
            this.hideModal();
        });
    }

    async startConversation(peerPublicKey, peerName) {
        try {
            const response = await fetch('/api/direct-messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: this.sessionId, peerPublicKey, peerName })
            });

            const data = await response.json();
            
            await this.loadConversations();
            this.openDirectChat(data.conversationId, peerName);
        } catch (error) {
            alert('开始对话失败: ' + error.message);
        }
    }

    openGroupChat(groupId, groupName) {
        this.currentChat = { type: 'group', id: groupId, name: groupName };
        this.showChatView();
        this.updateActiveListItem('groupsList', groupId);
    }

    openDirectChat(conversationId, peerName) {
        this.currentChat = { type: 'direct', id: conversationId, name: peerName };
        this.showChatView();
        this.updateActiveListItem('conversationsList', conversationId);
    }

    showChatView() {
        document.getElementById('emptyState').classList.add('hidden');
        document.getElementById('chatView').classList.remove('hidden');
        document.getElementById('chatTitle').textContent = this.currentChat.name;
        
        // 清空消息
        document.getElementById('messagesContainer').innerHTML = '';
    }

    updateActiveListItem(listId, activeId) {
        document.querySelectorAll(`#${listId} .list-item`).forEach(item => {
            item.classList.remove('active');
            if (item.dataset.groupId === activeId || item.dataset.convId === activeId) {
                item.classList.add('active');
            }
        });
    }

    async sendMessage() {
        if (!this.currentChat) return;

        const input = document.getElementById('messageInput');
        const content = input.value.trim();
        if (!content) return;

        try {
            if (this.currentChat.type === 'group') {
                const response = await fetch(`/api/groups/${this.currentChat.id}/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId: this.sessionId, content })
                });
            } else {
                const response = await fetch(`/api/direct-messages/${this.currentChat.id}/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId: this.sessionId, content })
                });
            }

            // 显示自己发送的消息
            this.displayMessage({
                senderName: localStorage.getItem('username'),
                content: content,
                timestamp: Date.now(),
                isOwn: true
            });

            input.value = '';
        } catch (error) {
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
        if (this.currentChat && this.currentChat.type === 'direct' && this.currentChat.id === message.conversationId) {
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
        localStorage.removeItem('username');
        this.sessionId = null;
        document.getElementById('mainScreen').classList.add('hidden');
        document.getElementById('loginScreen').classList.remove('hidden');
    }
}

// 启动应用
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new SocialNetworkApp();
});

