// Firebase Initialization
const firebaseConfig = {
    apiKey: "AIzaSyBclTC8gK3QKi1X6Q-YCK2jT38yJ83xOcQ",
    authDomain: "chat-app-a0f95.firebaseapp.com",
    projectId: "chat-app-a0f95",
    storageBucket: "chat-app-a0f95.appspot.com",
    messagingSenderId: "754786153113",
    appId: "1:754786153113:web:7543bfb097732ad229fe08",
    measurementId: "G-JFKWR83KYJ"
};

console.log('Initializing Firebase...');
try {
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    } else {
        firebase.app();
    }
    console.log('Firebase initialized successfully');
} catch (error) {
    console.error('Firebase initialization error:', error);
}

const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let currentUserData = null;
let chatWithUID = null;
let groupChatID = null;
let unreadMap = {};
let activeTab = 'chats';
let notificationPermissionRequested = false;
let isGroupInfoOpen = false;
let unsubscribeDirectMessages = null;
let unsubscribeGroupMessages = null;

// WebRTC Managers
let webRTCManager = null;
let signalingManager = null;

function escapeHTML(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeAttribute(value) {
    return escapeHTML(value);
}

// Modal System
const modalManager = {
    showModal(title, message, type = 'info', confirmText = 'OK', cancelText = null) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            const safeTitle = escapeHTML(title);
            const safeMessage = escapeHTML(message);
            const safeConfirmText = escapeHTML(confirmText);
            const safeCancelText = cancelText ? escapeHTML(cancelText) : null;
            modal.innerHTML = `
                <div class="modal">
                    <div class="modal-header">
                        <h3>${safeTitle}</h3>
                        <button class="modal-close">&times;</button>
                    </div>
                    <div class="modal-body">
                        <p>${safeMessage}</p>
                    </div>
                    <div class="modal-footer">
                        ${safeCancelText ? `<button class="btn-secondary modal-cancel">${safeCancelText}</button>` : ''}
                        <button class="btn-primary modal-confirm">${safeConfirmText}</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            const confirmBtn = modal.querySelector('.modal-confirm');
            const cancelBtn = modal.querySelector('.modal-cancel');
            const closeBtn = modal.querySelector('.modal-close');
            
            const closeModal = (result) => {
                if (document.body.contains(modal)) {
                    document.body.removeChild(modal);
                }
                resolve(result);
            };
            
            confirmBtn.onclick = () => closeModal(true);
            if (cancelBtn) cancelBtn.onclick = () => closeModal(false);
            closeBtn.onclick = () => closeModal(false);
            
            modal.onclick = (e) => {
                if (e.target === modal) closeModal(false);
            };
        });
    },
    
    showPrompt(title, defaultValue = '') {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'modal-overlay';
            const safeTitle = escapeHTML(title);
            const safeDefaultValue = escapeAttribute(defaultValue);
            modal.innerHTML = `
                <div class="modal">
                    <div class="modal-header">
                        <h3>${safeTitle}</h3>
                        <button class="modal-close">&times;</button>
                    </div>
                    <div class="modal-body">
                        <input type="text" class="modal-input" value="${safeDefaultValue}" placeholder="Enter message...">
                    </div>
                    <div class="modal-footer">
                        <button class="btn-secondary modal-cancel">Cancel</button>
                        <button class="btn-primary modal-confirm">OK</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            const input = modal.querySelector('.modal-input');
            const confirmBtn = modal.querySelector('.modal-confirm');
            const cancelBtn = modal.querySelector('.modal-cancel');
            const closeBtn = modal.querySelector('.modal-close');
            
            const closeModal = (result) => {
                if (document.body.contains(modal)) {
                    document.body.removeChild(modal);
                }
                resolve(result);
            };
            
            confirmBtn.onclick = () => closeModal(input.value);
            cancelBtn.onclick = () => closeModal(null);
            closeBtn.onclick = () => closeModal(null);
            
            modal.onclick = (e) => {
                if (e.target === modal) closeModal(null);
            };
            
            if (input) {
                input.focus();
                input.select();
            }
        });
    }
};

// Enhanced cache system with TTL
const enhancedCache = {
    set(key, data, ttl = 60 * 60 * 1000) {
        try {
            const item = {
                data,
                expiry: Date.now() + ttl
            };
            localStorage.setItem(key, JSON.stringify(item));
        } catch (e) {
            console.log('LocalStorage set error:', e);
        }
    },
    
    get(key) {
        try {
            const item = localStorage.getItem(key);
            if (!item) return null;

            const parsed = JSON.parse(item);
            if (Date.now() > parsed.expiry) {
                this.remove(key);
                return null;
            }

            return parsed.data;
        } catch (e) {
            console.log('LocalStorage get error:', e);
            return null;
        }
    },
    
    remove(key) {
        try {
            localStorage.removeItem(key);
        } catch (e) {
            console.log('LocalStorage remove error:', e);
        }
    },
    
    cleanup() {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            this.get(key);
        });
    }
};

// Badge management system - FIXED
const badgeManager = {
    counts: {
        friends: 0,
        groups: 0,
        requests: 0,
        total: 0
    },
    
    updateBadge(type, count) {
        this.counts[type] = count;
        this.counts.total = Object.values(this.counts).reduce((a, b) => a + b, 0);
        this.updateUI();
    },
    
    incrementBadge(type) {
        this.counts[type]++;
        this.counts.total++;
        this.updateUI();
        this.playNotificationSound();
    },
    
    resetBadge(type) {
        this.counts[type] = 0;
        this.counts.total = Object.values(this.counts).reduce((a, b) => a + b, 0);
        this.updateUI();
    },
    
    updateUI() {
        // Friend requests badge
        const requestsBadge = document.getElementById('requestsBadge');
        if (requestsBadge) {
            requestsBadge.textContent = this.counts.requests > 0 ? this.counts.requests : '';
            requestsBadge.style.display = this.counts.requests > 0 ? 'inline-block' : 'none';
        }
        
        // Update all tab badges
        this.updateTabBadge('chats', this.counts.friends);
        this.updateTabBadge('friends', this.counts.requests);
        this.updateTabBadge('groups', this.counts.groups);
        
        // Main notification badge
        const mainBadge = document.getElementById('notifBadge');
        if (mainBadge) {
            mainBadge.textContent = this.counts.total > 0 ? this.counts.total : '';
            mainBadge.style.display = this.counts.total > 0 ? 'inline-block' : 'none';
        }
        
        console.log('Badges updated:', this.counts);
    },
    
    updateTabBadge(tabName, count) {
        const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
        if (tabBtn) {
            let badge = tabBtn.querySelector('.tab-badge');
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'tab-badge';
                tabBtn.appendChild(badge);
            }
            badge.textContent = count > 0 ? count : '';
            badge.style.display = count > 0 ? 'inline-block' : 'none';
        }
    },
    
    playNotificationSound() {
        try {
            const sound = document.getElementById('notifSound');
            if (sound) {
                sound.volume = 0.3;
                sound.play().catch(e => {
                    console.log('Sound play failed, trying fallback:', e);
                    this.fallbackBeep();
                });
            } else {
                this.fallbackBeep();
            }
        } catch (error) {
            console.log('Notification sound error:', error);
            this.fallbackBeep();
        }
    },

    fallbackBeep() {
        try {
            const context = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = context.createOscillator();
            const gainNode = context.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(context.destination);
            
            oscillator.frequency.value = 800;
            oscillator.type = 'sine';
            gainNode.gain.value = 0.1;
            
            oscillator.start();
            setTimeout(() => {
                oscillator.stop();
            }, 200);
        } catch (e) {
            console.log('Fallback beep failed:', e);
        }
    }
};

// Chat ID Generator
function generateChatId(uid1, uid2) {
    return [uid1, uid2].sort().join('_');
}

// --------------------
// Authentication Check
// --------------------
auth.onAuthStateChanged(async (user) => {
    console.log('Auth state changed:', user ? 'User logged in' : 'No user');
    if (!user) {
        window.location.href = 'index.html';
        return;
    }
    currentUser = user;
    window.currentUser = currentUser;
    await initializeApp();
});

// --------------------
// App Initialization
// --------------------
async function initializeApp() {
    console.log('Starting app initialization...');
    try {
        await loadUserData();
        initializeDarkMode();
        requestNotificationPermission();
        setupEventListeners();
        
        // Initialize WebRTC managers
        await initializeWebRTCManagers();
        
        startListeners();
        updateUI();
        setupPresence();
        
        enhancedCache.cleanup();
        
        console.log('App initialized successfully');
    } catch (error) {
        console.error('Error initializing app:', error);
        modalManager.showModal('Error', 'Error initializing app: ' + error.message, 'error');
    }
}

// --------------------
// Real-time Presence System
// --------------------
function setupPresence() {
    if (!currentUser) return;
    const userRef = db.collection('users').doc(currentUser.uid);
    userRef.update({ status: 'online', lastSeen: new Date() }).catch(console.error);

    window.addEventListener('beforeunload', () => {
        userRef.update({ status: 'offline', lastSeen: new Date() }).catch(() => {});
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            userRef.update({ status: 'away', lastSeen: new Date() }).catch(console.error);
        } else {
            userRef.update({ status: 'online', lastSeen: new Date() }).catch(console.error);
        }
    });

    startFriendsPresenceListener();
}

let friendsPresenceUnsubscribers = [];

function startFriendsPresenceListener() {
    friendsPresenceUnsubscribers.forEach(unsub => unsub());
    friendsPresenceUnsubscribers = [];
    const friends = currentUserData?.friends || [];
    if (friends.length === 0) return;
    const chunks = [];
    for (let i = 0; i < friends.length; i += 10) chunks.push(friends.slice(i, i + 10));
    chunks.forEach(chunk => {
        const unsub = db.collection('users')
            .where(firebase.firestore.FieldPath.documentId(), 'in', chunk)
            .onSnapshot(snapshot => {
                snapshot.forEach(doc => {
                    const uid = doc.id;
                    const data = doc.data();
                    const cacheKey = 'user_' + uid;
                    const cached = enhancedCache.get(cacheKey);
                    if (cached) {
                        cached.status = data.status;
                        cached.lastSeen = data.lastSeen;
                        enhancedCache.set(cacheKey, cached, 30 * 60 * 1000);
                    }
                    if (uid === chatWithUID) {
                        const statusEl = document.getElementById('chatPartnerStatus');
                        if (statusEl) {
                            statusEl.textContent = formatStatus(data.status, data.lastSeen);
                            statusEl.className = data.status === 'online' ? 'status-online' : 'status-offline';
                        }
                    }
                });
                if (activeTab === 'chats') loadFriendsList();
                if (activeTab === 'friends') loadAllFriends();
            }, console.error);
        friendsPresenceUnsubscribers.push(unsub);
    });
}

function formatStatus(status, lastSeen) {
    if (status === 'online') return '\u{1F7E2} Online';
    if (status === 'away') return '\u{1F7E1} Away';
    if (lastSeen) {
        const date = lastSeen?.toDate ? lastSeen.toDate() : new Date(lastSeen);
        const diff = Math.floor((Date.now() - date.getTime()) / 60000);
        if (diff < 1) return '\u26AB Just now';
        if (diff < 60) return '\u26AB ' + diff + 'm ago';
        if (diff < 1440) return '\u26AB ' + Math.floor(diff / 60) + 'h ago';
    }
    return '\u26AB Offline';
}

function initializeWebRTCManagers() {
    return new Promise((resolve) => {
        console.log('🔄 Initializing WebRTC managers...');
        
        const checkManagers = () => {
            if (typeof window.webRTCManager !== 'undefined' && 
                typeof window.signalingManager !== 'undefined') {
                
                webRTCManager = window.webRTCManager;
                signalingManager = window.signalingManager;
                
                console.log('✅ WebRTC managers loaded:', {
                    webRTCManager: !!webRTCManager,
                    signalingManager: !!signalingManager
                });
                
                // Initialize signaling with retry
                if (signalingManager && typeof signalingManager.initialize === 'function') {
                    signalingManager.initialize();
                    console.log('🎉 WebRTC system ready for calls');
                }
                
                resolve();
            } else {
                setTimeout(checkManagers, 200);
            }
        };
        
        checkManagers();
        
        // Timeout after 10 seconds
        setTimeout(() => {
            console.log('⚠️ WebRTC managers loading timeout - calls may not work');
            resolve();
        }, 10000);
    });
}

async function loadUserData() {
    console.log('Loading user data for:', currentUser.uid);
    
    const cacheKey = `user_${currentUser.uid}`;
    const cached = enhancedCache.get(cacheKey);
    
    if (cached) {
        currentUserData = cached;
        window.currentUserData = currentUserData;
        updateUserInfo();
        return;
    }
    
    try {
        const userRef = db.collection('users').doc(currentUser.uid);
        const snap = await userRef.get();

        if (!snap.exists) {
            console.log('Creating new user document...');
            const username = generateUsername(currentUser.displayName || "user");
            await userRef.set({
                name: currentUser.displayName || "User",
                email: currentUser.email || null,
                username,
                usernameChangedAt: null,
                status: "online",
                friends: [],
                photoURL: currentUser.photoURL || null,
                unreadCounts: {}
            });
        }

        currentUserData = (await userRef.get()).data();
        window.currentUserData = currentUserData;
        enhancedCache.set(cacheKey, currentUserData, 30 * 60 * 1000);
        console.log('User data loaded:', currentUserData);
        updateUserInfo();
        
        if (currentUserData.unreadCounts) {
            Object.keys(currentUserData.unreadCounts).forEach(chatId => {
                unreadMap[chatId] = currentUserData.unreadCounts[chatId];
            });
        }
        
    } catch (error) {
        console.error('Error in loadUserData:', error);
        throw error;
    }
}

function generateUsername(name) {
    return name.toLowerCase().replace(/\s/g, "") + Math.floor(Math.random() * 1000);
}

function updateUserInfo() {
    const userNameElement = document.getElementById('userName');
    const userStatusElement = document.getElementById('userStatus');
    const userAvatarElement = document.getElementById('userAvatar');
    const avatarFallbackElement = document.getElementById('avatarFallback');
    
    if (userNameElement) {
        userNameElement.textContent = currentUserData.name;
    }
    
    if (userStatusElement) {
        userStatusElement.textContent = 'Online';
    }
    
    if (currentUser.photoURL && userAvatarElement && avatarFallbackElement) {
        userAvatarElement.src = currentUser.photoURL;
        userAvatarElement.style.display = 'block';
        avatarFallbackElement.style.display = 'none';
    }
}

// --------------------
// Call Functions - FIXED
// --------------------
function addCallButtonsToChat() {
    document.querySelectorAll('.call-buttons').forEach(buttons => buttons.remove());

    const activeContainer = chatWithUID
        ? document.getElementById('individualChat')
        : document.getElementById('groupChatContainer');
    const chatHeader = activeContainer?.querySelector('.chat-header');

    if (chatHeader && (chatWithUID || groupChatID)) {
        const callButtons = document.createElement('div');
        callButtons.className = 'call-buttons';
        
        if (chatWithUID) {
            // Individual chat - show voice and video call buttons
            callButtons.innerHTML = `
                <button class="chat-call-btn voice-call" title="Voice Call">📞</button>
                <button class="chat-call-btn video-call" title="Video Call">📹</button>
            `;
            
            // Add event listeners
            const voiceCallBtn = callButtons.querySelector('.voice-call');
            const videoCallBtn = callButtons.querySelector('.video-call');
            
            if (voiceCallBtn) {
                voiceCallBtn.addEventListener('click', startVoiceCall);
            }
            if (videoCallBtn) {
                videoCallBtn.addEventListener('click', startVideoCall);
            }
        } else if (groupChatID) {
            // Group chat - show group call button (future feature)
            callButtons.innerHTML = `
                <button class="chat-call-btn group-call" title="Group Call (Coming Soon)" disabled>👥</button>
            `;
        }
        
        chatHeader.appendChild(callButtons);
    }
}

async function startVoiceCall() {
    if (!webRTCManager) {
        modalManager.showModal('Error', 'Call system not initialized. Please refresh the page.', 'error');
        return;
    }
    
    if (!chatWithUID) {
        modalManager.showModal('Info', 'Please select a chat to start a call', 'info');
        return;
    }
    
    try {
        await webRTCManager.startCall(chatWithUID, false);
    } catch (error) {
        console.error('Failed to start voice call:', error);
        modalManager.showModal('Error', 'Failed to start voice call: ' + error.message, 'error');
    }
}

async function startVideoCall() {
    if (!webRTCManager) {
        modalManager.showModal('Error', 'Call system not initialized. Please refresh the page.', 'error');
        return;
    }
    
    if (!chatWithUID) {
        modalManager.showModal('Info', 'Please select a chat to start a call', 'info');
        return;
    }
    
    try {
        await webRTCManager.startCall(chatWithUID, true);
    } catch (error) {
        console.error('Failed to start video call:', error);
        modalManager.showModal('Error', 'Failed to start video call: ' + error.message, 'error');
    }
}

// --------------------
// Event Listeners & UI Setup
// --------------------
function setupEventListeners() {
    // Tab switching — use closest() so clicks on child spans (icons/text) still work
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tabBtn = e.target.closest('.tab-btn');
            const tabName = tabBtn?.dataset.tab;
            if (tabName) {
                switchTab(tabName);
            }
        });
    });

    // Mobile sidebar: back buttons show sidebar
    function showSidebar() {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;
        sidebar.classList.remove('mobile-hidden');
        // Add backdrop
        let backdrop = document.getElementById('sidebarBackdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.id = 'sidebarBackdrop';
            backdrop.className = 'sidebar-backdrop';
            backdrop.addEventListener('click', hideSidebar);
            document.body.appendChild(backdrop);
        }
        backdrop.style.display = 'block';
    }

    function hideSidebar() {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;
        // Only hide on mobile
        if (window.innerWidth <= 599) {
            sidebar.classList.add('mobile-hidden');
        }
        const backdrop = document.getElementById('sidebarBackdrop');
        if (backdrop) backdrop.style.display = 'none';
    }

    // On mobile, hide sidebar when a chat is opened
    window._hideSidebarOnMobile = hideSidebar;

    document.getElementById('backToSidebarBtn1')?.addEventListener('click', showSidebar);
    document.getElementById('backToSidebarBtn2')?.addEventListener('click', showSidebar);
    document.getElementById('openSidebarBtn')?.addEventListener('click', showSidebar);

    // Handle resize: show sidebar again if going back to desktop
    window.addEventListener('resize', () => {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;
        if (window.innerWidth > 599) {
            sidebar.classList.remove('mobile-hidden');
            const backdrop = document.getElementById('sidebarBackdrop');
            if (backdrop) backdrop.style.display = 'none';
        }
    });

    // Search functionality
    const searchBtn = document.getElementById('searchBtn');
    const searchUser = document.getElementById('searchUser');
    
    if (searchBtn) {
        searchBtn.addEventListener('click', searchUsers);
    }
    if (searchUser) {
        searchUser.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchUsers();
        });
    }

    // Message sending
    const sendBtn = document.getElementById('sendBtn');
    const msgInput = document.getElementById('msg');
    
    if (sendBtn) {
        sendBtn.addEventListener('click', sendMessage);
    }
    if (msgInput) {
        msgInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendMessage();
        });
    }

    const sendGroupBtn = document.getElementById('sendGroupBtn');
    const groupMsgInput = document.getElementById('groupMsg');
    
    if (sendGroupBtn) {
        sendGroupBtn.addEventListener('click', sendGroupMessage);
    }
    if (groupMsgInput) {
        groupMsgInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendGroupMessage();
        });
    }

    // Group creation
    const createGroupBtn = document.getElementById('createGroupBtn');
    if (createGroupBtn) {
        createGroupBtn.addEventListener('click', createGroup);
    }

    // Toggle create group panel
    const toggleCreateGroup = document.getElementById('toggleCreateGroup');
    if (toggleCreateGroup) {
        toggleCreateGroup.addEventListener('click', () => {
            const body = document.getElementById('createGroupBody');
            const arrow = document.getElementById('createGroupArrow');
            if (body && arrow) {
                body.classList.toggle('open');
                arrow.classList.toggle('open');
            }
        });
    }

    // Add Member button
    const addMemberBtn = document.getElementById('addMemberBtn');
    if (addMemberBtn) {
        addMemberBtn.addEventListener('click', openAddMemberModal);
    }

    // Leave Group button
    const leaveGroupBtn = document.getElementById('leaveGroupBtn');
    if (leaveGroupBtn) {
        leaveGroupBtn.addEventListener('click', openLeaveGroupModal);
    }

    // Add Member modal controls
    document.getElementById('closeAddMemberModal')?.addEventListener('click', () => {
        document.getElementById('addMemberModal').style.display = 'none';
    });
    document.getElementById('cancelAddMember')?.addEventListener('click', () => {
        document.getElementById('addMemberModal').style.display = 'none';
    });
    document.getElementById('confirmAddMember')?.addEventListener('click', confirmAddMembers);

    // Leave modal controls
    document.getElementById('closeLeaveModal')?.addEventListener('click', () => {
        document.getElementById('leaveGroupModal').style.display = 'none';
    });
    document.getElementById('cancelLeave')?.addEventListener('click', () => {
        document.getElementById('leaveGroupModal').style.display = 'none';
    });
    document.getElementById('confirmLeave')?.addEventListener('click', confirmLeaveGroup);

    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }

    // Dark mode toggle
    const toggleDarkBtn = document.getElementById('toggleDark');
    if (toggleDarkBtn) {
        toggleDarkBtn.addEventListener('click', toggleDarkMode);
    }

    // Emoji picker - stopPropagation prevents the document click listener from closing it immediately
    document.querySelectorAll('.emoji-toggle').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const input = e.target.closest('.message-input-container')?.querySelector('input');
            if (input && window.emojiPicker) {
                window.emojiPicker.toggle(input);
            }
        });
    });
}

function switchTab(tabName) {
    // Update active tab button
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeTabBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (activeTabBtn) {
        activeTabBtn.classList.add('active');
    }

    // Update active tab content
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.remove('active');
    });
    const activePane = document.getElementById(`${tabName}-tab`);
    if (activePane) {
        activePane.classList.add('active');
    }

    activeTab = tabName;
    
    // Load appropriate data
    switch(tabName) {
        case 'chats':
            loadFriendsList();
            break;
        case 'friends':
            loadFriendRequests();
            loadAllFriends();
            break;
        case 'groups':
            loadGroupsList();
            loadFriendsForGroup();
            break;
    }
}

function startListeners() {
    let prevRequestCount = 0;
    let firstRequestSnapshot = true;

    // Listen for friend requests — play ping on new ones
    db.collection('friendRequests')
        .where('to', '==', currentUser.uid)
        .where('status', '==', 'pending')
        .onSnapshot(snapshot => {
            const newCount = snapshot.size;
            badgeManager.updateBadge('requests', newCount);

            if (!firstRequestSnapshot && newCount > prevRequestCount) {
                badgeManager.playNotificationSound();

                // Get sender info for toast
                snapshot.docChanges().forEach(change => {
                    if (change.type === 'added') {
                        const req = change.doc.data();
                        getUserData(req.from).then(senderData => {
                            toastManager.show({
                                icon: '🤝',
                                title: 'Friend Request',
                                body: `${senderData?.name || 'Someone'} sent you a friend request`,
                                type: 'request',
                                onClick: () => switchTab('friends')
                            });
                        });

                        if (Notification.permission === 'granted') {
                            new Notification('EduChat — Friend Request', {
                                body: 'You have a new friend request!',
                                icon: '/favicon.ico'
                            });
                        }
                    }
                });
            }
            firstRequestSnapshot = false;
            prevRequestCount = newCount;

            if (activeTab === 'friends') {
                loadFriendRequests();
            }
        });

    // Listen for friends list changes + restart presence listeners when friends list changes
    db.collection('users').doc(currentUser.uid)
        .onSnapshot(doc => {
            if (doc.exists) {
                const prevFriends = currentUserData?.friends || [];
                currentUserData = doc.data();
                window.currentUserData = currentUserData;

                // Restart presence listeners if friends list changed
                const newFriends = currentUserData.friends || [];
                if (JSON.stringify(prevFriends.sort()) !== JSON.stringify(newFriends.sort())) {
                    startFriendsPresenceListener();
                }

                if (activeTab === 'chats') {
                    loadFriendsList();
                } else if (activeTab === 'friends') {
                    loadAllFriends();
                }
            }
        });
}

function updateUI() {
    loadFriendsList();
    loadFriendRequests();
    loadAllFriends();
    loadGroupsList();
}

// --------------------
// Chat Functions
// --------------------
async function loadFriendsList() {
    const friendsList = document.getElementById('friendsList');
    if (!friendsList) return;

    try {
        const friends = currentUserData.friends || [];
        
        if (friends.length === 0) {
            friendsList.innerHTML = '<div class="no-chats">No chats yet</div>';
            return;
        }

        let html = '';
        for (const friendUID of friends) {
            const friendData = await getUserData(friendUID);
            if (friendData) {
                const unreadCount = unreadMap[generateChatId(currentUser.uid, friendUID)] || 0;
                const safeFriendUID = escapeAttribute(friendUID);
                const safeName = escapeHTML(friendData.name);
                const statusText = formatStatus(friendData.status, friendData.lastSeen);
                const safeInitial = escapeHTML(friendData.name?.charAt(0)?.toUpperCase() || 'U');
                const isOnline = friendData.status === 'online';
                html += `
                    <button class="chat-item" data-uid="${safeFriendUID}">
                        <div class="chat-avatar" style="position:relative;">
                            ${safeInitial}
                            <span style="position:absolute;bottom:0;right:0;width:10px;height:10px;border-radius:50%;background:${isOnline ? '#48bb78' : '#a0aec0'};border:2px solid var(--bg-primary, #fff);"></span>
                        </div>
                        <div class="chat-info">
                            <h4>${safeName}</h4>
                            <p style="font-size:0.75rem;">${statusText}</p>
                        </div>
                        ${unreadCount > 0 ? `<span class="unread-badge">${unreadCount}</span>` : ''}
                    </button>
                `;
            }
        }

        friendsList.innerHTML = html;

        // Add click listeners
        friendsList.querySelectorAll('.chat-item').forEach(item => {
            item.addEventListener('click', () => {
                const uid = item.dataset.uid;
                openChat(uid);
            });
        });

    } catch (error) {
        console.error('Error loading friends list:', error);
        friendsList.innerHTML = '<div class="no-chats">Error loading chats</div>';
    }
}

async function openChat(friendUID) {
    chatWithUID = friendUID;
    groupChatID = null;
    if (unsubscribeGroupMessages) {
        unsubscribeGroupMessages();
        unsubscribeGroupMessages = null;
    }

    // Update UI
    const defaultChat = document.getElementById('defaultChat');
    const individualChat = document.getElementById('individualChat');
    const groupChatContainer = document.getElementById('groupChatContainer');
    
    if (defaultChat) defaultChat.style.display = 'none';
    if (individualChat) individualChat.style.display = 'flex';
    if (groupChatContainer) groupChatContainer.style.display = 'none';

    // Hide sidebar on mobile when chat opens
    if (window._hideSidebarOnMobile) window._hideSidebarOnMobile();

    // Update chat header
    const friendData = await getUserData(friendUID);
    const chatPartnerName = document.getElementById('chatPartnerName');
    const chatPartnerStatus = document.getElementById('chatPartnerStatus');
    
    if (chatPartnerName) chatPartnerName.textContent = friendData.name;
    if (chatPartnerStatus) {
        chatPartnerStatus.textContent = formatStatus(friendData.status, friendData.lastSeen);
        chatPartnerStatus.className = friendData.status === 'online' ? 'status-online' : 'status-offline';
    }

    // Load messages
    loadMessages();

    // Add call buttons
    addCallButtonsToChat();

    // Mark as read
    markChatAsRead(generateChatId(currentUser.uid, friendUID));
}

async function loadMessages() {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer) return;

    try {
        const chatId = generateChatId(currentUser.uid, chatWithUID);
        if (unsubscribeDirectMessages) {
            unsubscribeDirectMessages();
            unsubscribeDirectMessages = null;
        }
        
        // Try cache first
        const cachedMessages = await hybridCache.getMessages(chatId);
        if (cachedMessages) {
            displayMessages(cachedMessages);
        }

        let prevMessageCount = 0;
        let firstMsgSnapshot = true;

        // Listen for new messages
        unsubscribeDirectMessages = db.collection('messages')
            .where('chatId', '==', chatId)
            .onSnapshot(snapshot => {
                const messages = [];
                snapshot.forEach(doc => {
                    messages.push({ id: doc.id, ...doc.data() });
                });
                
                // Sort messages by time on the client side
                messages.sort((a, b) => {
                    const timeA = a.time?.toDate ? a.time.toDate().getTime() : new Date(a.time).getTime();
                    const timeB = b.time?.toDate ? b.time.toDate().getTime() : new Date(b.time).getTime();
                    return timeA - timeB;
                });

                // Detect new incoming message
                if (!firstMsgSnapshot && messages.length > prevMessageCount) {
                    const newest = messages[messages.length - 1];
                    if (newest && newest.sender !== currentUser.uid) {
                        badgeManager.playNotificationSound();

                        // Show toast if tab not focused or chat scrolled up
                        if (document.visibilityState !== 'visible') {
                            // Browser notification
                            if (Notification.permission === 'granted') {
                                new Notification('EduChat — New Message', {
                                    body: newest.text,
                                    icon: '/favicon.ico'
                                });
                            }
                        }
                        // Always show toast
                        getUserData(newest.sender).then(senderData => {
                            toastManager.show({
                                icon: '💬',
                                title: senderData?.name || 'New Message',
                                body: newest.text,
                                type: 'message',
                                onClick: () => { /* already in chat */ }
                            });
                        });
                    }
                }
                firstMsgSnapshot = false;
                prevMessageCount = messages.length;
                
                displayMessages(messages);
                hybridCache.setMessages(chatId, messages);
                
                // Scroll to bottom
                setTimeout(() => {
                    chatContainer.scrollTop = chatContainer.scrollHeight;
                }, 100);
            });

    } catch (error) {
        console.error('Error loading messages:', error);
    }
}

function displayMessages(messages) {
    const chatContainer = document.getElementById('chat');
    if (!chatContainer) return;

    let html = '';
    messages.forEach(msg => {
        const isSent = msg.sender === currentUser.uid;
        const rawTime = msg.time || msg.timestamp || Date.now();
        const time = rawTime?.toDate ? rawTime.toDate() : new Date(rawTime);
        const timeString = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const bodyHtml = msg.type === 'file' && window.driveShare
            ? window.driveShare.renderFileMessage(msg, isSent)
            : `<div class="message-text">${escapeHTML(msg.text)}</div>`;

        html += `
            <div class="message ${isSent ? 'sent' : 'received'}">
                ${bodyHtml}
                <div class="message-time">${timeString}</div>
            </div>
        `;
    });

    chatContainer.innerHTML = html;
}

async function sendMessage() {
    const input = document.getElementById('msg');
    if (!input) return;
    
    const text = input.value.trim();
    
    if (!text || !chatWithUID) return;

    try {
        const chatId = generateChatId(currentUser.uid, chatWithUID);
        
        await db.collection('messages').add({
            chatId,
            participants: [currentUser.uid, chatWithUID],
            sender: currentUser.uid,
            text,
            time: new Date(),
            type: 'text'
        });

        input.value = '';
        
        // Update unread count for recipient
        await db.collection('users').doc(chatWithUID).update({
            [`unreadCounts.${chatId}`]: firebase.firestore.FieldValue.increment(1)
        });

    } catch (error) {
        console.error('Error sending message:', error);
        modalManager.showModal('Error', 'Failed to send message', 'error');
    }
}

// --------------------
// Friend Functions
// --------------------
async function searchUsers() {
    const searchInput = document.getElementById('searchUser');
    const searchTerm = searchInput?.value.trim();
    const resultsDiv = document.getElementById('searchedUser');

    if (!searchTerm || !resultsDiv) {
        if (resultsDiv) resultsDiv.innerHTML = '';
        return;
    }

    try {
        resultsDiv.innerHTML = '<div class="no-results">Searching...</div>';
        let allResults = new Map();

        // Strategy 1: Search by username (case-insensitive) - Check if field exists
        try {
            const snapshot1 = await db.collection('users')
                .where('usernameLower', '>=', searchTerm.toLowerCase())
                .where('usernameLower', '<=', searchTerm.toLowerCase() + '\uf8ff')
                .limit(10)
                .get();

            snapshot1.forEach(doc => {
                if (doc.id !== currentUser.uid && !allResults.has(doc.id)) {
                    allResults.set(doc.id, doc.data());
                }
            });
        } catch (err) {
            console.log('usernameLower index not available, trying original field:', err.message);
            // Fallback: Try exact username search
            try {
                const snapshot1b = await db.collection('users')
                    .where('username', '>=', searchTerm)
                    .where('username', '<=', searchTerm + '\uf8ff')
                    .limit(10)
                    .get();
                
                snapshot1b.forEach(doc => {
                    if (doc.id !== currentUser.uid && !allResults.has(doc.id)) {
                        allResults.set(doc.id, doc.data());
                    }
                });
            } catch (err2) {
                console.log('Fallback search also failed:', err2.message);
            }
        }

        // Strategy 2: Search by email (case-insensitive)
        try {
            const snapshot2 = await db.collection('users')
                .where('emailLower', '>=', searchTerm.toLowerCase())
                .where('emailLower', '<=', searchTerm.toLowerCase() + '\uf8ff')
                .limit(10)
                .get();

            snapshot2.forEach(doc => {
                if (doc.id !== currentUser.uid && !allResults.has(doc.id)) {
                    allResults.set(doc.id, doc.data());
                }
            });
        } catch (err) {
            console.log('emailLower search failed:', err.message);
        }

        // Strategy 3: Client-side search through recently accessed users (lightweight)
        try {
            const allUsers = await db.collection('users').limit(50).get();
            const searchLower = searchTerm.toLowerCase();
            
            allUsers.forEach(doc => {
                const user = doc.data();
                if (doc.id !== currentUser.uid) {
                    const username = (user.username || '').toLowerCase();
                    const name = (user.name || '').toLowerCase();
                    const email = (user.email || '').toLowerCase();
                    
                    if (username.includes(searchLower) || 
                        name.includes(searchLower) || 
                        email.includes(searchLower)) {
                        if (!allResults.has(doc.id)) {
                            allResults.set(doc.id, user);
                        }
                    }
                }
            });
        } catch (err) {
            console.log('Client-side search failed:', err.message);
        }

        resultsDiv.innerHTML = '';

        if (allResults.size === 0) {
            resultsDiv.innerHTML = '<div class="no-results">No users found</div>';
            return;
        }

        // Display results (limit to 10)
        const idsToDisplay = Array.from(allResults.keys()).slice(0, 10);
        
        idsToDisplay.forEach(userId => {
            const user = allResults.get(userId);
            const div = document.createElement('div');
            div.className = 'search-result';
            const safeName = escapeHTML(user.name || 'Unknown');
            const safeUsername = escapeHTML(user.username || 'No username');
            const safeUID = escapeAttribute(userId);
            
            div.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <div>
                        <strong>${safeName}</strong>
                        <div style="font-size: 0.8rem; color: #718096;">@${safeUsername}</div>
                    </div>
                    <button class="primary-btn add-friend-btn" data-uid="${safeUID}">
                        Add Friend
                    </button>
                </div>
            `;
            resultsDiv.appendChild(div);
        });

        // Add event listeners to add friend buttons
        resultsDiv.querySelectorAll('.add-friend-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                sendFriendRequest(btn.dataset.uid);
            });
        });

    } catch (error) {
        console.error('Error searching users:', error);
        if (resultsDiv) {
            resultsDiv.innerHTML = '<div class="no-results">Error searching users. Please try again.</div>';
        }
    }
}

async function sendFriendRequest(toUID) {
    try {
        const requestId = generateChatId(currentUser.uid, toUID);
        
        await db.collection('friendRequests').doc(requestId).set({
            from: currentUser.uid,
            to: toUID,
            status: 'pending',
            timestamp: new Date()
        });

        modalManager.showModal('Success', 'Friend request sent!', 'success');
        
    } catch (error) {
        console.error('Error sending friend request:', error);
        modalManager.showModal('Error', 'Failed to send friend request', 'error');
    }
}

async function loadFriendRequests() {
    const requestsDiv = document.getElementById('friendRequests');
    if (!requestsDiv) return;

    try {
        const snapshot = await db.collection('friendRequests')
            .where('to', '==', currentUser.uid)
            .where('status', '==', 'pending')
            .get();

        if (snapshot.empty) {
            requestsDiv.innerHTML = '<div class="no-requests">No pending requests</div>';
            return;
        }

        let html = '';
        for (const doc of snapshot.docs) {
            const request = doc.data();
            const fromUser = await getUserData(request.from);
            
            if (fromUser) {
                const safeInitial = escapeHTML(fromUser.name?.charAt(0)?.toUpperCase() || 'U');
                const safeName = escapeHTML(fromUser.name);
                const safeUsername = escapeHTML(fromUser.username);
                const safeRequestId = escapeAttribute(doc.id);
                html += `
                    <div class="request-item">
                        <div class="friend-avatar">${safeInitial}</div>
                        <div class="friend-info">
                            <h4>${safeName}</h4>
                            <p>@${safeUsername}</p>
                        </div>
                        <div class="request-actions">
                            <button class="accept-btn" data-requestid="${safeRequestId}">Accept</button>
                            <button class="decline-btn" data-requestid="${safeRequestId}">Decline</button>
                        </div>
                    </div>
                `;
            }
        }

        requestsDiv.innerHTML = html;

        // Add event listeners
        requestsDiv.querySelectorAll('.accept-btn').forEach(btn => {
            btn.addEventListener('click', () => acceptFriendRequest(btn.dataset.requestid));
        });

        requestsDiv.querySelectorAll('.decline-btn').forEach(btn => {
            btn.addEventListener('click', () => declineFriendRequest(btn.dataset.requestid));
        });

    } catch (error) {
        console.error('Error loading friend requests:', error);
        requestsDiv.innerHTML = '<div class="no-requests">Error loading requests</div>';
    }
}

async function acceptFriendRequest(requestId) {
    try {
        const requestDoc = await db.collection('friendRequests').doc(requestId).get();
        if (!requestDoc.exists) return;

        const request = requestDoc.data();
        
        // Update request status
        await db.collection('friendRequests').doc(requestId).update({
            status: 'accepted'
        });

        // Add to both users' friends lists
        const batch = db.batch();
        
        batch.update(db.collection('users').doc(request.from), {
            friends: firebase.firestore.FieldValue.arrayUnion(request.to)
        });
        
        batch.update(db.collection('users').doc(request.to), {
            friends: firebase.firestore.FieldValue.arrayUnion(request.from)
        });

        await batch.commit();

        // Reload friends list
        loadFriendRequests();
        loadAllFriends();

    } catch (error) {
        console.error('Error accepting friend request:', error);
        modalManager.showModal('Error', 'Failed to accept friend request', 'error');
    }
}

async function declineFriendRequest(requestId) {
    try {
        await db.collection('friendRequests').doc(requestId).update({
            status: 'declined'
        });

        loadFriendRequests();

    } catch (error) {
        console.error('Error declining friend request:', error);
        modalManager.showModal('Error', 'Failed to decline friend request', 'error');
    }
}

async function loadAllFriends() {
    const friendsDiv = document.getElementById('friendsListAll');
    if (!friendsDiv) return;

    try {
        const friends = currentUserData.friends || [];
        
        if (friends.length === 0) {
            friendsDiv.innerHTML = '<div class="no-friends">No friends yet</div>';
            return;
        }

        let html = '';
        for (const friendUID of friends) {
            const friendData = await getUserData(friendUID);
            if (friendData) {
                const safeFriendUID = escapeAttribute(friendUID);
                const safeInitial = escapeHTML(friendData.name?.charAt(0)?.toUpperCase() || 'U');
                const safeName = escapeHTML(friendData.name);
                const friendStatusText = formatStatus(friendData.status, friendData.lastSeen);
                const friendIsOnline = friendData.status === 'online';
                html += `
                    <div class="friend-item">
                        <div class="friend-avatar" style="position:relative;">
                            ${safeInitial}
                            <span style="position:absolute;bottom:0;right:0;width:10px;height:10px;border-radius:50%;background:${friendIsOnline ? '#48bb78' : '#a0aec0'};border:2px solid var(--bg-primary,#fff);"></span>
                        </div>
                        <div class="friend-info">
                            <h4>${safeName}</h4>
                            <p style="font-size:0.75rem;">${friendStatusText}</p>
                        </div>
                        <button class="remove-friend-btn" data-uid="${safeFriendUID}" title="Remove Friend">×</button>
                    </div>
                `;
            }
        }

        friendsDiv.innerHTML = html;

        // Add remove friend listeners
        friendsDiv.querySelectorAll('.remove-friend-btn').forEach(btn => {
            btn.innerHTML = '&times;';
            btn.addEventListener('click', () => removeFriend(btn.dataset.uid));
        });

    } catch (error) {
        console.error('Error loading friends:', error);
        friendsDiv.innerHTML = '<div class="no-friends">Error loading friends</div>';
    }
}

async function removeFriend(friendUID) {
    const confirmed = await modalManager.showModal(
        'Remove Friend',
        `Are you sure you want to remove this friend?`,
        'warning',
        'Remove',
        'Cancel'
    );

    if (!confirmed) return;

    try {
        // Remove from both users' friends lists
        const batch = db.batch();
        
        batch.update(db.collection('users').doc(currentUser.uid), {
            friends: firebase.firestore.FieldValue.arrayRemove(friendUID)
        });
        
        batch.update(db.collection('users').doc(friendUID), {
            friends: firebase.firestore.FieldValue.arrayRemove(currentUser.uid)
        });

        await batch.commit();

        // Reload friends list
        loadAllFriends();
        loadFriendsList();

    } catch (error) {
        console.error('Error removing friend:', error);
        modalManager.showModal('Error', 'Failed to remove friend', 'error');
    }
}

// --------------------
// Group Functions
// --------------------
async function loadFriendsForGroup() {
    const select = document.getElementById('groupMembers');
    if (!select) return;

    try {
        const friends = currentUserData.friends || [];
        
        select.innerHTML = '<option value="">Select friends...</option>';
        
        for (const friendUID of friends) {
            const friendData = await getUserData(friendUID);
            if (friendData) {
                const option = document.createElement('option');
                option.value = friendUID;
                option.textContent = friendData.name;
                select.appendChild(option);
            }
        }

    } catch (error) {
        console.error('Error loading friends for group:', error);
    }
}

async function createGroup() {
    const nameInput = document.getElementById('groupName');
    const membersSelect = document.getElementById('groupMembers');
    
    if (!nameInput || !membersSelect) return;
    
    const name = nameInput.value.trim();
    const selectedMembers = Array.from(membersSelect.selectedOptions)
        .map(option => option.value)
        .filter(Boolean);
    
    if (!name) {
        modalManager.showModal('Error', 'Please enter a group name', 'error');
        return;
    }

    if (selectedMembers.length === 0) {
        modalManager.showModal('Error', 'Please select at least one friend', 'error');
        return;
    }

    try {
        const groupId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const allMembers = [currentUser.uid, ...selectedMembers];

        await db.collection('groups').doc(groupId).set({
            name,
            createdBy: currentUser.uid,
            members: allMembers,
            createdAt: new Date(),
            admin: currentUser.uid
        });

        // Clear form
        nameInput.value = '';
        membersSelect.selectedIndex = -1;

        modalManager.showModal('Success', 'Group created successfully!', 'success');
        
        // Reload groups list
        loadGroupsList();

    } catch (error) {
        console.error('Error creating group:', error);
        modalManager.showModal('Error', 'Failed to create group', 'error');
    }
}

async function loadGroupsList() {
    const groupsDiv = document.getElementById('groupsList');
    if (!groupsDiv) return;

    try {
        const snapshot = await db.collection('groups')
            .where('members', 'array-contains', currentUser.uid)
            .get();

        // Update count badge
        const countBadge = document.getElementById('groupsCount');
        if (countBadge) countBadge.textContent = snapshot.size;

        if (snapshot.empty) {
            groupsDiv.innerHTML = '<div class="no-groups">No groups yet. Create one above!</div>';
            return;
        }

        let html = '';
        snapshot.forEach(doc => {
            const group = doc.data();
            const safeGroupId = escapeAttribute(doc.id);
            const safeName = escapeHTML(group.name);
            const memberCount = Array.isArray(group.members) ? group.members.length : 0;
            const initial = escapeHTML((group.name || 'G')[0].toUpperCase());
            html += `
                <button class="group-item" data-groupid="${safeGroupId}">
                    <div class="group-avatar-icon">${initial}</div>
                    <div class="group-info">
                        <h4>${safeName}</h4>
                        <p>👥 ${memberCount} member${memberCount !== 1 ? 's' : ''}</p>
                    </div>
                </button>
            `;
        });

        groupsDiv.innerHTML = html;

        groupsDiv.querySelectorAll('.group-item').forEach(item => {
            item.addEventListener('click', () => {
                groupsDiv.querySelectorAll('.group-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                openGroupChat(item.dataset.groupid);
            });
        });

    } catch (error) {
        console.error('Error loading groups:', error);
        groupsDiv.innerHTML = '<div class="no-groups">Error loading groups</div>';
    }
}

async function openGroupChat(groupId) {
    groupChatID = groupId;
    chatWithUID = null;
    if (unsubscribeDirectMessages) {
        unsubscribeDirectMessages();
        unsubscribeDirectMessages = null;
    }

    // Update UI
    const defaultChat = document.getElementById('defaultChat');
    const individualChat = document.getElementById('individualChat');
    const groupChatContainer = document.getElementById('groupChatContainer');
    
    if (defaultChat) defaultChat.style.display = 'none';
    if (individualChat) individualChat.style.display = 'none';
    if (groupChatContainer) groupChatContainer.style.display = 'flex';

    // Hide sidebar on mobile when group chat opens
    if (window._hideSidebarOnMobile) window._hideSidebarOnMobile();

    // Load group data
    const groupDoc = await db.collection('groups').doc(groupId).get();
    if (groupDoc.exists) {
        const group = groupDoc.data();
        const groupChatName = document.getElementById('groupChatName');
        const membersCount = document.querySelector('.members-count');
        
        if (groupChatName) groupChatName.textContent = group.name;
        if (membersCount) membersCount.textContent = `${group.members.length} members`;
    }

    // Load group messages
    loadGroupMessages();

    // Add call buttons
    addCallButtonsToChat();
}

async function loadGroupMessages() {
    const chatContainer = document.getElementById('groupChat');
    if (!chatContainer) return;

    try {
        if (unsubscribeGroupMessages) {
            unsubscribeGroupMessages();
            unsubscribeGroupMessages = null;
        }

        let prevGroupMsgCount = 0;
        let firstGroupSnapshot = true;

        // Listen for group messages
        unsubscribeGroupMessages = db.collection('groupMessages')
            .where('groupId', '==', groupChatID)
            .orderBy('time', 'asc')
            .onSnapshot(snapshot => {
                const messages = [];
                snapshot.forEach(doc => {
                    messages.push({ id: doc.id, ...doc.data() });
                });

                // Notify on new group messages
                if (!firstGroupSnapshot && messages.length > prevGroupMsgCount) {
                    const newest = messages[messages.length - 1];
                    if (newest && newest.sender !== currentUser.uid && newest.sender !== 'system') {
                        badgeManager.playNotificationSound();

                        if (document.visibilityState !== 'visible') {
                            if (Notification.permission === 'granted') {
                                const groupChatName = document.getElementById('groupChatName');
                                new Notification(`EduChat — ${groupChatName?.textContent || 'Group'}`, {
                                    body: `${newest.senderName || 'Someone'}: ${newest.text}`,
                                    icon: '/favicon.ico'
                                });
                            }
                        }
                        const groupChatNameEl = document.getElementById('groupChatName');
                        toastManager.show({
                            icon: '👥',
                            title: groupChatNameEl?.textContent || 'Group Message',
                            body: `${newest.senderName || 'Someone'}: ${newest.text}`,
                            type: 'group'
                        });
                    }
                }
                firstGroupSnapshot = false;
                prevGroupMsgCount = messages.length;
                
                displayGroupMessages(messages);
                
                // Scroll to bottom
                const chatContainer = document.getElementById('groupChat');
                setTimeout(() => {
                    if (chatContainer) chatContainer.scrollTop = chatContainer.scrollHeight;
                }, 100);
            });

    } catch (error) {
        console.error('Error loading group messages:', error);
    }
}

function displayGroupMessages(messages) {
    const chatContainer = document.getElementById('groupChat');
    if (!chatContainer) return;

    let html = '';
    messages.forEach(msg => {
        const isSent = msg.sender === currentUser.uid;
        const rawTime = msg.time || msg.timestamp || Date.now();
        const time = rawTime?.toDate ? rawTime.toDate() : new Date(rawTime);
        const timeString = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const bodyHtml = msg.type === 'file' && window.driveShare
            ? window.driveShare.renderFileMessage(msg, isSent)
            : `<div class="message-text">${escapeHTML(msg.text)}</div>`;

        html += `
            <div class="message ${isSent ? 'sent' : 'received'}">
                ${!isSent ? `<div class="message-sender">${escapeHTML(msg.senderName || 'User')}</div>` : ''}
                ${bodyHtml}
                <div class="message-time">${timeString}</div>
            </div>
        `;
    });

    chatContainer.innerHTML = html;
}

async function sendGroupMessage() {
    const input = document.getElementById('groupMsg');
    if (!input) return;
    
    const text = input.value.trim();
    
    if (!text || !groupChatID) return;

    try {
        // Get sender name
        const senderName = currentUserData.name || 'User';
        
        await db.collection('groupMessages').add({
            groupId: groupChatID,
            sender: currentUser.uid,
            senderName: senderName,
            text,
            time: new Date(),
            type: 'text'
        });

        input.value = '';

    } catch (error) {
        console.error('Error sending group message:', error);
        modalManager.showModal('Error', 'Failed to send message', 'error');
    }
}

// --------------------
// Add Member to Group
// --------------------
async function openAddMemberModal() {
    if (!groupChatID) return;

    const modal = document.getElementById('addMemberModal');
    const listDiv = document.getElementById('addMemberFriendsList');
    if (!modal || !listDiv) return;

    listDiv.innerHTML = '<div class="loading">Loading friends...</div>';
    modal.style.display = 'flex';

    try {
        // Get current group members
        const groupDoc = await db.collection('groups').doc(groupChatID).get();
        const currentMembers = groupDoc.exists ? (groupDoc.data().members || []) : [];

        // Get all friends
        const userDoc = await db.collection('users').doc(currentUser.uid).get();
        const friendUIDs = userDoc.exists ? (userDoc.data().friends || []) : [];

        if (friendUIDs.length === 0) {
            listDiv.innerHTML = '<div style="padding:16px;text-align:center;color:#718096;">No friends to add</div>';
            return;
        }

        let html = '';
        const friendPromises = friendUIDs.map(uid => db.collection('users').doc(uid).get());
        const friendDocs = await Promise.all(friendPromises);

        friendDocs.forEach((doc, i) => {
            if (!doc.exists) return;
            const friend = doc.data();
            const uid = friendUIDs[i];
            const alreadyMember = currentMembers.includes(uid);
            const initial = (friend.name || 'U')[0].toUpperCase();

            html += `
                <div class="add-friend-select-item ${alreadyMember ? 'already-member' : ''}">
                    <div class="add-friend-avatar">${initial}</div>
                    <span class="add-friend-name">${escapeHTML(friend.name || 'User')}</span>
                    ${alreadyMember
                        ? '<span class="already-member-tag">Already in group</span>'
                        : `<input type="checkbox" class="add-friend-checkbox" data-uid="${escapeAttribute(uid)}" data-name="${escapeAttribute(friend.name || 'User')}">`
                    }
                </div>
            `;
        });

        listDiv.innerHTML = html || '<div style="padding:16px;text-align:center;color:#718096;">No friends available</div>';

        // Click on row to toggle checkbox
        listDiv.querySelectorAll('.add-friend-select-item:not(.already-member)').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.type === 'checkbox') return;
                const cb = item.querySelector('.add-friend-checkbox');
                if (cb) cb.checked = !cb.checked;
            });
        });

    } catch (error) {
        console.error('Error loading friends for add member:', error);
        listDiv.innerHTML = '<div style="padding:16px;text-align:center;color:#e53e3e;">Error loading friends</div>';
    }
}

async function confirmAddMembers() {
    if (!groupChatID) return;

    const checkboxes = document.querySelectorAll('#addMemberFriendsList .add-friend-checkbox:checked');
    if (checkboxes.length === 0) {
        modalManager.showModal('Notice', 'Please select at least one friend to add', 'info');
        return;
    }

    const selectedUIDs = Array.from(checkboxes).map(cb => cb.dataset.uid);
    const selectedNames = Array.from(checkboxes).map(cb => cb.dataset.name);

    try {
        const groupRef = db.collection('groups').doc(groupChatID);
        const groupDoc = await groupRef.get();
        const currentMembers = groupDoc.exists ? (groupDoc.data().members || []) : [];

        const newMembers = [...new Set([...currentMembers, ...selectedUIDs])];
        await groupRef.update({ members: newMembers });

        // Send system message
        await db.collection('groupMessages').add({
            groupId: groupChatID,
            sender: 'system',
            senderName: 'System',
            text: `${selectedNames.join(', ')} added to the group`,
            time: new Date(),
            type: 'system'
        });

        document.getElementById('addMemberModal').style.display = 'none';

        // Update member count in header
        const membersCount = document.querySelector('.members-count');
        if (membersCount) membersCount.textContent = `${newMembers.length} members`;

        modalManager.showModal('Success', `${selectedNames.join(', ')} added to group!`, 'success');

    } catch (error) {
        console.error('Error adding members:', error);
        modalManager.showModal('Error', 'Failed to add members', 'error');
    }
}

// --------------------
// Leave Group
// --------------------
async function openLeaveGroupModal() {
    if (!groupChatID) return;

    const modal = document.getElementById('leaveGroupModal');
    const nameEl = document.getElementById('leaveGroupName');
    if (!modal) return;

    const groupChatName = document.getElementById('groupChatName');
    if (nameEl && groupChatName) nameEl.textContent = groupChatName.textContent;

    modal.style.display = 'flex';
}

async function confirmLeaveGroup() {
    if (!groupChatID) return;

    try {
        const groupRef = db.collection('groups').doc(groupChatID);
        const groupDoc = await groupRef.get();
        if (!groupDoc.exists) return;

        const group = groupDoc.data();
        const updatedMembers = (group.members || []).filter(uid => uid !== currentUser.uid);

        if (updatedMembers.length === 0) {
            // Delete group if no members left
            await groupRef.delete();
        } else {
            await groupRef.update({ members: updatedMembers });
            // Send system message
            await db.collection('groupMessages').add({
                groupId: groupChatID,
                sender: 'system',
                senderName: 'System',
                text: `${currentUserData.name || 'User'} left the group`,
                time: new Date(),
                type: 'system'
            });
        }

        document.getElementById('leaveGroupModal').style.display = 'none';

        // Go back to default view
        groupChatID = null;
        if (unsubscribeGroupMessages) {
            unsubscribeGroupMessages();
            unsubscribeGroupMessages = null;
        }

        document.getElementById('groupChatContainer').style.display = 'none';
        document.getElementById('defaultChat').style.display = 'flex';

        // Reload groups list
        loadGroupsList();

    } catch (error) {
        console.error('Error leaving group:', error);
        modalManager.showModal('Error', 'Failed to leave group', 'error');
    }
}

// --------------------
// Utility Functions
// --------------------
async function getUserData(uid) {
    // Try cache first
    const cacheKey = `user_${uid}`;
    const cached = enhancedCache.get(cacheKey);
    if (cached) return cached;

    try {
        const userDoc = await db.collection('users').doc(uid).get();
        if (userDoc.exists) {
            const userData = userDoc.data();
            enhancedCache.set(cacheKey, userData, 30 * 60 * 1000);
            return userData;
        }
    } catch (error) {
        console.error('Error getting user data:', error);
    }

    return null;
}

function markChatAsRead(chatId) {
    if (unreadMap[chatId]) {
        unreadMap[chatId] = 0;
        // Update in Firebase
        db.collection('users').doc(currentUser.uid).update({
            [`unreadCounts.${chatId}`]: 0
        }).catch(console.error);
        
        // Update UI
        loadFriendsList();
    }
}

function initializeDarkMode() {
    const isDark = localStorage.getItem('darkMode') === 'true';
    if (isDark) {
        document.body.classList.add('dark');
    }
}

function toggleDarkMode() {
    document.body.classList.toggle('dark');
    localStorage.setItem('darkMode', document.body.classList.contains('dark'));
}

function requestNotificationPermission() {
    if (!notificationPermissionRequested && 'Notification' in window) {
        Notification.requestPermission().then(permission => {
            notificationPermissionRequested = true;
        });
    }
}

// ============================================================
// TOAST NOTIFICATION SYSTEM
// ============================================================
const toastManager = {
    show({ icon = '💬', title, body, type = 'message', duration = 4500, onClick = null }) {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <div class="toast-icon">${icon}</div>
            <div class="toast-content">
                <div class="toast-title">${escapeHTML(title)}</div>
                <div class="toast-body">${escapeHTML(body)}</div>
            </div>
            <button class="toast-close" title="Dismiss">✕</button>
        `;

        container.appendChild(toast);

        const dismiss = () => {
            toast.classList.add('removing');
            setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 280);
        };

        toast.querySelector('.toast-close').onclick = (e) => { e.stopPropagation(); dismiss(); };

        toast.onclick = () => {
            if (onClick) onClick();
            dismiss();
        };

        const timer = setTimeout(dismiss, duration);
        toast.addEventListener('mouseenter', () => clearTimeout(timer));

        return { dismiss };
    }
};

// Expose simple toast helper for driveFileShare.js
window._showToast = function(msg, type = 'info') {
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    toastManager.show({ icon: icons[type] || 'ℹ️', title: msg, body: '', type: 'message', duration: 3500 });
};

// Init Drive file sharing after GIS loads
window.addEventListener('load', () => {
    setTimeout(() => {
        if (window.driveShare) {
            window.driveShare.init();
        }
    }, 1500); // give GIS script time to load
});

async function logout() {
    try {
        // Update status to offline
        if (currentUser) {
            await db.collection('users').doc(currentUser.uid).update({
                status: 'offline',
                lastSeen: new Date()
            });
        }
        // Cleanup presence listeners
        if (typeof friendsPresenceUnsubscribers !== 'undefined') {
            friendsPresenceUnsubscribers.forEach(unsub => unsub());
            friendsPresenceUnsubscribers = [];
        }
        
        // Sign out
        await auth.signOut();
        window.location.href = 'index.html';
        
    } catch (error) {
        console.error('Error during logout:', error);
        // Force logout anyway
        window.location.href = 'index.html';
    }
}

// Make essential variables globally available for WebRTC
window.db = db;
window.currentUser = currentUser;
window.currentUserData = currentUserData;
window.enhancedCache = enhancedCache;
window.modalManager = modalManager;

console.log('Enhanced chat.js with WebRTC integration loaded successfully');
