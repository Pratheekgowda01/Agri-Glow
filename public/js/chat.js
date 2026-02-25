/**
 * Chat component for real-time messaging between users
 */
class Chat {
  constructor(options = {}) {
    this.containerId = options.containerId;
    this.socket = null;
    this.currentUser = null;
    this.currentConversation = null;
    this.conversations = new Map();
    this.messages = new Map();
    this.typingTimeout = null;
    this.messageObserver = null;
    this.unreadCount = 0;
    
    this.options = {
      messagePageSize: 50,
      typingDebounce: 1000,
      ...options
    };

    this.initialize();
  }

  async initialize() {
    try {
      // Initialize container
      this.container = document.getElementById(this.containerId);
      if (!this.container) {
        throw new Error(`Container with id '${this.containerId}' not found`);
      }

      // Setup UI
      await this.setupUI();

      // Get current user
      const response = await fetch('/api/auth/check');
      const data = await response.json();
      if (!data.user) {
        throw new Error('User not authenticated');
      }
      this.currentUser = data.user;

      // Initialize socket connection
      this.initializeSocket();

      // Load conversations
      await this.loadConversations();
    } catch (error) {
      console.error('Chat initialization failed:', error);
      this.showError('Failed to initialize chat');
    }
  }

  setupUI() {
    this.container.innerHTML = `
      <div class="chat-container">
        <div class="chat-sidebar">
          <div class="chat-sidebar-header">
            <h3>Messages</h3>
            <button class="btn btn-sm btn-outline-primary new-conversation-btn">
              <i class="fas fa-plus"></i>
            </button>
          </div>
          <div class="chat-search">
            <input type="text" class="form-control" placeholder="Search conversations...">
          </div>
          <div class="conversations-list"></div>
        </div>
        <div class="chat-main">
          <div class="chat-header"></div>
          <div class="chat-messages"></div>
          <div class="chat-input">
            <div class="input-group">
              <input type="text" class="form-control message-input" placeholder="Type a message...">
              <button class="btn btn-primary send-button">
                <i class="fas fa-paper-plane"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Add event listeners
    this.container.querySelector('.message-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.container.querySelector('.message-input').addEventListener('input', () => {
      this.handleTyping();
    });

    this.container.querySelector('.send-button').addEventListener('click', () => {
      this.sendMessage();
    });

    this.container.querySelector('.new-conversation-btn').addEventListener('click', () => {
      this.showNewConversationDialog();
    });

    this.container.querySelector('.chat-search input').addEventListener('input', (e) => {
      this.filterConversations(e.target.value);
    });

    // Setup message observer for infinite scroll
    this.setupMessageObserver();
  }

  initializeSocket() {
    // Get auth token
    const token = localStorage.getItem('token');
    if (!token) {
      throw new Error('Authentication token not found');
    }

    // Initialize socket with auth
    this.socket = io(window.location.origin, {
      auth: { token }
    });

    // Handle socket events
    this.socket.on('connect', () => {
      console.log('Chat connected');
      this.updateConnectionStatus(true);
    });

    this.socket.on('disconnect', () => {
      console.log('Chat disconnected');
      this.updateConnectionStatus(false);
    });

    this.socket.on('new_message', (message) => {
      this.handleNewMessage(message);
    });

    this.socket.on('message_read', (data) => {
      this.handleMessageRead(data);
    });

    this.socket.on('typing_status', (data) => {
      this.handleTypingStatus(data);
    });

    this.socket.on('error', (error) => {
      console.error('Socket error:', error);
      this.showError(error.message);
    });
  }

  async loadConversations() {
    try {
      const response = await fetch('/api/chat/conversations');
      const conversations = await response.json();
      
      // Clear existing conversations
      this.conversations.clear();
      const conversationsList = this.container.querySelector('.conversations-list');
      conversationsList.innerHTML = '';

      // Add conversations
      conversations.forEach(conversation => {
        this.conversations.set(conversation._id, conversation);
        this.addConversationToList(conversation);
      });

      // If there are conversations, open the first one
      if (conversations.length > 0) {
        this.openConversation(conversations[0]._id);
      }
    } catch (error) {
      console.error('Failed to load conversations:', error);
      this.showError('Failed to load conversations');
    }
  }

  async openConversation(conversationId) {
    try {
      const conversation = this.conversations.get(conversationId);
      if (!conversation) return;

      // Update UI
      this.currentConversation = conversation;
      this.updateConversationHeader(conversation);
      
      // Clear messages
      this.messages.clear();
      const messagesContainer = this.container.querySelector('.chat-messages');
      messagesContainer.innerHTML = '';

      // Join conversation room
      this.socket.emit('join_conversation', { conversationId });

      // Load messages
      await this.loadMessages(conversationId);

      // Update active conversation in list
      this.updateActiveConversation(conversationId);
    } catch (error) {
      console.error('Failed to open conversation:', error);
      this.showError('Failed to open conversation');
    }
  }

  async loadMessages(conversationId, page = 1) {
    try {
      const response = await fetch(
        `/api/chat/conversations/${conversationId}/messages?page=${page}&limit=${this.options.messagePageSize}`
      );
      const messages = await response.json();

      // Add messages to state and UI
      messages.reverse().forEach(message => {
        if (!this.messages.has(message._id)) {
          this.messages.set(message._id, message);
          this.addMessageToUI(message);
        }
      });

      // Update scroll position if this is the first page
      if (page === 1) {
        this.scrollToBottom();
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
      this.showError('Failed to load messages');
    }
  }

  setupMessageObserver() {
    const messagesContainer = this.container.querySelector('.chat-messages');
    
    this.messageObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting && this.currentConversation) {
            const firstMessage = Array.from(this.messages.values())[0];
            if (firstMessage) {
              const page = Math.floor(this.messages.size / this.options.messagePageSize) + 1;
              this.loadMessages(this.currentConversation._id, page);
            }
          }
        });
      },
      { threshold: 0.1 }
    );

    // Add sentinel element
    const sentinel = document.createElement('div');
    sentinel.className = 'message-sentinel';
    messagesContainer.insertBefore(sentinel, messagesContainer.firstChild);
    this.messageObserver.observe(sentinel);
  }

  async sendMessage() {
    if (!this.currentConversation) return;

    const input = this.container.querySelector('.message-input');
    const content = input.value.trim();
    if (!content) return;

    try {
      const response = await fetch(
        `/api/chat/conversations/${this.currentConversation._id}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ content })
        }
      );

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      // Clear input
      input.value = '';

      // Socket will handle message display through new_message event
    } catch (error) {
      console.error('Failed to send message:', error);
      this.showError('Failed to send message');
    }
  }

  handleNewMessage(message) {
    // Add message to state and UI
    this.messages.set(message._id, message);
    this.addMessageToUI(message);

    // Update conversation last message
    const conversation = this.conversations.get(message.conversationId);
    if (conversation) {
      conversation.lastMessage = message;
      this.updateConversationInList(conversation);
    }

    // Scroll to bottom if we're at the bottom
    if (this.isAtBottom()) {
      this.scrollToBottom();
    }

    // Mark as read if this is the active conversation
    if (this.currentConversation?._id === message.conversationId) {
      this.markMessageAsRead(message._id);
    }
  }

  handleTyping() {
    if (!this.currentConversation) return;

    // Clear existing timeout
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }

    // Emit typing status
    this.socket.emit('typing', {
      conversationId: this.currentConversation._id,
      isTyping: true
    });

    // Set timeout to clear typing status
    this.typingTimeout = setTimeout(() => {
      this.socket.emit('typing', {
        conversationId: this.currentConversation._id,
        isTyping: false
      });
    }, this.options.typingDebounce);
  }

  handleTypingStatus(data) {
    if (!this.currentConversation) return;

    const typingIndicator = this.container.querySelector('.typing-indicator');
    if (data.isTyping) {
      if (!typingIndicator) {
        const indicator = document.createElement('div');
        indicator.className = 'typing-indicator';
        indicator.textContent = `${data.name} is typing...`;
        this.container.querySelector('.chat-messages').appendChild(indicator);
      }
    } else if (typingIndicator) {
      typingIndicator.remove();
    }
  }

  async markMessageAsRead(messageId) {
    try {
      this.socket.emit('read', {
        conversationId: this.currentConversation._id,
        messageId
      });
    } catch (error) {
      console.error('Failed to mark message as read:', error);
    }
  }

  handleMessageRead(data) {
    const message = this.messages.get(data.messageId);
    if (message) {
      const readBy = message.readBy || [];
      if (!readBy.some(read => read.user === data.userId)) {
        readBy.push({
          user: data.userId,
          readAt: new Date()
        });
        message.readBy = readBy;
        this.updateMessageReadStatus(message);
      }
    }
  }

  addConversationToList(conversation) {
    const conversationsList = this.container.querySelector('.conversations-list');
    const otherParticipant = conversation.participants.find(p => p._id !== this.currentUser._id);
    
    const element = document.createElement('div');
    element.className = 'conversation-item';
    element.dataset.id = conversation._id;
    element.innerHTML = `
      <div class="conversation-avatar">
        <img src="${otherParticipant.avatar || '/img/default-avatar.png'}" alt="Avatar">
        <span class="status-indicator"></span>
      </div>
      <div class="conversation-info">
        <div class="conversation-name">${otherParticipant.name}</div>
        <div class="conversation-last-message">
          ${conversation.lastMessage ? conversation.lastMessage.content : 'No messages yet'}
        </div>
      </div>
      <div class="conversation-meta">
        <span class="conversation-time">
          ${conversation.lastMessage ? formatTime(conversation.lastMessage.createdAt) : ''}
        </span>
        <span class="unread-count">${conversation.unreadCount?.get(this.currentUser._id) || ''}</span>
      </div>
    `;

    element.addEventListener('click', () => {
      this.openConversation(conversation._id);
    });

    conversationsList.appendChild(element);
  }

  updateConversationInList(conversation) {
    const element = this.container.querySelector(`.conversation-item[data-id="${conversation._id}"]`);
    if (!element) return;

    const otherParticipant = conversation.participants.find(p => p._id !== this.currentUser._id);
    
    element.querySelector('.conversation-last-message').textContent = 
      conversation.lastMessage ? conversation.lastMessage.content : 'No messages yet';
    
    element.querySelector('.conversation-time').textContent = 
      conversation.lastMessage ? formatTime(conversation.lastMessage.createdAt) : '';
    
    element.querySelector('.unread-count').textContent = 
      conversation.unreadCount?.get(this.currentUser._id) || '';

    // Move to top of list
    const parent = element.parentNode;
    parent.insertBefore(element, parent.firstChild);
  }

  addMessageToUI(message) {
    const messagesContainer = this.container.querySelector('.chat-messages');
    const messageElement = document.createElement('div');
    messageElement.className = `message ${message.sender._id === this.currentUser._id ? 'own' : ''}`;
    messageElement.dataset.id = message._id;
    
    messageElement.innerHTML = `
      <div class="message-avatar">
        <img src="${message.sender.avatar || '/img/default-avatar.png'}" alt="Avatar">
      </div>
      <div class="message-content">
        <div class="message-header">
          <span class="message-author">${message.sender.name}</span>
          <span class="message-time">${formatTime(message.createdAt)}</span>
        </div>
        <div class="message-text">${message.content}</div>
        <div class="message-status">
          ${this.getMessageStatusHtml(message)}
        </div>
      </div>
    `;

    // Add to container
    messagesContainer.appendChild(messageElement);
  }

  getMessageStatusHtml(message) {
    if (message.sender._id === this.currentUser._id) {
      const readBy = message.readBy || [];
      if (readBy.length > 0) {
        return '<i class="fas fa-check-double text-primary"></i>';
      } else {
        return '<i class="fas fa-check"></i>';
      }
    }
    return '';
  }

  updateMessageReadStatus(message) {
    const element = this.container.querySelector(`.message[data-id="${message._id}"]`);
    if (element) {
      element.querySelector('.message-status').innerHTML = this.getMessageStatusHtml(message);
    }
  }

  showNewConversationDialog() {
    // TODO: Implement new conversation dialog
  }

  filterConversations(query) {
    query = query.toLowerCase();
    const items = this.container.querySelectorAll('.conversation-item');
    
    items.forEach(item => {
      const name = item.querySelector('.conversation-name').textContent.toLowerCase();
      const message = item.querySelector('.conversation-last-message').textContent.toLowerCase();
      
      if (name.includes(query) || message.includes(query)) {
        item.style.display = '';
      } else {
        item.style.display = 'none';
      }
    });
  }

  updateConnectionStatus(connected) {
    const header = this.container.querySelector('.chat-header');
    const statusElement = header.querySelector('.connection-status') || document.createElement('div');
    statusElement.className = `connection-status ${connected ? 'connected' : 'disconnected'}`;
    statusElement.textContent = connected ? 'Connected' : 'Disconnected';
    
    if (!header.contains(statusElement)) {
      header.appendChild(statusElement);
    }
  }

  updateConversationHeader(conversation) {
    const header = this.container.querySelector('.chat-header');
    const otherParticipant = conversation.participants.find(p => p._id !== this.currentUser._id);
    
    header.innerHTML = `
      <div class="conversation-info">
        <div class="conversation-avatar">
          <img src="${otherParticipant.avatar || '/img/default-avatar.png'}" alt="Avatar">
          <span class="status-indicator"></span>
        </div>
        <div class="conversation-details">
          <div class="conversation-name">${otherParticipant.name}</div>
          <div class="conversation-status">Online</div>
        </div>
      </div>
    `;
  }

  updateActiveConversation(conversationId) {
    const items = this.container.querySelectorAll('.conversation-item');
    items.forEach(item => {
      item.classList.toggle('active', item.dataset.id === conversationId);
    });
  }

  showError(message) {
    // TODO: Implement error display
    console.error(message);
  }

  scrollToBottom() {
    const messagesContainer = this.container.querySelector('.chat-messages');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  isAtBottom() {
    const messagesContainer = this.container.querySelector('.chat-messages');
    const threshold = 100; // pixels from bottom
    return messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < threshold;
  }
}

function formatTime(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (days === 1) {
    return 'Yesterday';
  } else if (days < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}

// Export the Chat class
window.Chat = Chat;