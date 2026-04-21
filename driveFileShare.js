// ============================================================
//  EduChat — Google Drive File Sharing
//  Handles: auth, upload, file messages display
// ============================================================

const DRIVE_CLIENT_ID = '191214500535-6nironkv53bia01cct6lbfgmi6u0286s.apps.googleusercontent.com';
const DRIVE_SCOPE     = 'https://www.googleapis.com/auth/drive.file';
const EDUCHAT_FOLDER  = 'EduChat Files'; // folder name in user's Drive

let driveTokenClient  = null;
let driveAccessToken  = null;
let pendingUploadFile = null;   // file waiting after auth
let pendingUploadCtx  = null;   // { type: 'direct'|'group' }

// ── Init Google Identity Services ──────────────────────────
function initDriveAuth() {
    if (!window.google?.accounts?.oauth2) {
        console.warn('Google Identity Services not loaded yet');
        return;
    }
    driveTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: DRIVE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        // No redirect — stays on same page
        callback: (tokenResponse) => {
            if (tokenResponse.error) {
                console.error('Drive auth error:', tokenResponse.error);
                showToast('Drive access denied', 'error');
                return;
            }
            driveAccessToken = tokenResponse.access_token;
            // If a file was waiting for auth, upload it now
            if (pendingUploadFile) {
                const file = pendingUploadFile;
                const ctx  = pendingUploadCtx;
                pendingUploadFile = null;
                pendingUploadCtx  = null;
                uploadFileToDrive(file, ctx);
            }
        },
        error_callback: (err) => {
            console.error('Drive token error:', err);
            // popup_closed = user closed popup, not a real error
            if (err.type !== 'popup_closed') {
                showToast('Drive auth failed: ' + err.type, 'error');
            }
            pendingUploadFile = null;
            pendingUploadCtx  = null;
        }
    });
}

// ── Request Drive token ─────────────────────────────────────
function requestDriveToken(file, ctx) {
    if (!driveTokenClient) {
        initDriveAuth();
    }
    pendingUploadFile = file;
    pendingUploadCtx  = ctx;

    if (driveAccessToken) {
        // Token already exists — upload straight away
        const f = pendingUploadFile;
        const c = pendingUploadCtx;
        pendingUploadFile = null;
        pendingUploadCtx  = null;
        uploadFileToDrive(f, c);
    } else {
        // '' = no extra prompt if already consented, shows popup only if needed
        driveTokenClient.requestAccessToken({ prompt: '' });
    }
}

// ── Get or create EduChat folder in Drive ──────────────────
async function getOrCreateEduChatFolder() {
    // Search for existing folder
    const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=name='${EDUCHAT_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)`,
        { headers: { Authorization: `Bearer ${driveAccessToken}` } }
    );
    const searchData = await searchRes.json();

    if (searchData.files && searchData.files.length > 0) {
        return searchData.files[0].id;
    }

    // Create folder
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${driveAccessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            name: EDUCHAT_FOLDER,
            mimeType: 'application/vnd.google-apps.folder',
        }),
    });
    const folder = await createRes.json();
    return folder.id;
}

// ── Upload file to Drive, return { url, name, size, mimeType } ─
async function uploadFileToDrive(file, ctx) {
    // Show uploading indicator
    setAttachBtnLoading(true, ctx.type);

    try {
        const folderId = await getOrCreateEduChatFolder();

        // Multipart upload
        const metadata = {
            name: file.name,
            parents: [folderId],
        };

        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', file);

        const uploadRes = await fetch(
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,mimeType,webViewLink,webContentLink',
            {
                method: 'POST',
                headers: { Authorization: `Bearer ${driveAccessToken}` },
                body: form,
            }
        );

        if (!uploadRes.ok) {
            const err = await uploadRes.json();
            // Token might be expired
            if (err.error?.code === 401) {
                driveAccessToken = null;
                requestDriveToken(file, ctx);
                return;
            }
            throw new Error(err.error?.message || 'Upload failed');
        }

        const fileData = await uploadRes.json();

        // Make file publicly readable (anyone with link can view/download)
        await fetch(`https://www.googleapis.com/drive/v3/files/${fileData.id}/permissions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${driveAccessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ role: 'reader', type: 'anyone' }),
        });

        // Send as file message
        const fileMsg = {
            type: 'file',
            fileName: fileData.name,
            fileSize: fileData.size,
            fileMime: fileData.mimeType,
            fileUrl:  fileData.webViewLink,        // view link
            downloadUrl: fileData.webContentLink,  // direct download
            text: '',
            time: new Date(),
        };

        if (ctx.type === 'direct') {
            await sendFileMessage(fileMsg);
        } else {
            await sendGroupFileMessage(fileMsg);
        }

        showToast(`✅ ${file.name} sent!`, 'success');

    } catch (err) {
        console.error('Drive upload error:', err);
        showToast('File upload failed: ' + err.message, 'error');
    } finally {
        setAttachBtnLoading(false, ctx.type);
    }
}

// ── Send file message to Firestore (direct chat) ───────────
async function sendFileMessage(fileMsg) {
    if (!currentUser || !chatWithUID) return;
    const chatId = generateChatId(currentUser.uid, chatWithUID);
    await db.collection('messages').add({
        chatId,
        participants: [currentUser.uid, chatWithUID],
        sender: currentUser.uid,
        ...fileMsg,
    });
    await db.collection('users').doc(chatWithUID).update({
        [`unreadCounts.${chatId}`]: firebase.firestore.FieldValue.increment(1),
    });
}

// ── Send file message to Firestore (group chat) ────────────
async function sendGroupFileMessage(fileMsg) {
    if (!currentUser || !groupChatID) return;
    await db.collection('groupMessages').add({
        groupId: groupChatID,
        sender: currentUser.uid,
        senderName: currentUserData?.name || 'User',
        ...fileMsg,
    });
}

// ── Render a file message bubble ───────────────────────────
function renderFileMessage(msg, isSent) {
    const mime     = msg.fileMime || '';
    const isImage  = mime.startsWith('image/');
    const isPDF    = mime === 'application/pdf';
    const kb       = msg.fileSize ? Math.round(Number(msg.fileSize) / 1024) : null;
    const sizeStr  = kb ? (kb >= 1024 ? `${(kb/1024).toFixed(1)} MB` : `${kb} KB`) : '';

    const safeFileName    = escapeHTML(msg.fileName || 'File');
    const safeFileUrl     = escapeAttribute(msg.fileUrl || '#');
    const safeDownloadUrl = escapeAttribute(msg.downloadUrl || msg.fileUrl || '#');

    if (isImage) {
        // Inline image preview
        return `
            <div class="file-msg-wrap">
                <a href="${safeFileUrl}" target="_blank" rel="noopener">
                    <img 
                        src="${safeDownloadUrl}"
                        alt="${safeFileName}"
                        class="file-msg-image"
                        loading="lazy"
                        onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
                    >
                    <div class="file-msg-image-fallback" style="display:none">🖼️ ${safeFileName}</div>
                </a>
                <div class="file-msg-meta">
                    <span class="file-name">${safeFileName}</span>
                    ${sizeStr ? `<span class="file-size">${sizeStr}</span>` : ''}
                </div>
                <div class="file-msg-actions">
                    <a href="${safeFileUrl}" target="_blank" rel="noopener" class="file-action-btn">👁 View</a>
                    <a href="${safeDownloadUrl}" target="_blank" rel="noopener" class="file-action-btn">⬇ Download</a>
                </div>
            </div>
        `;
    }

    // Generic file / PDF
    const icon = isPDF ? '📄' : getFileIcon(mime);
    return `
        <div class="file-msg-wrap">
            <div class="file-msg-card">
                <span class="file-icon">${icon}</span>
                <div class="file-msg-info">
                    <span class="file-name">${safeFileName}</span>
                    ${sizeStr ? `<span class="file-size">${sizeStr}</span>` : ''}
                </div>
            </div>
            <div class="file-msg-actions">
                <a href="${safeFileUrl}" target="_blank" rel="noopener" class="file-action-btn">👁 View</a>
                <a href="${safeDownloadUrl}" target="_blank" rel="noopener" class="file-action-btn">⬇ Download</a>
            </div>
        </div>
    `;
}

function getFileIcon(mime) {
    if (mime.startsWith('video/'))      return '🎬';
    if (mime.startsWith('audio/'))      return '🎵';
    if (mime.includes('zip') || mime.includes('rar') || mime.includes('7z')) return '🗜️';
    if (mime.includes('word') || mime.includes('document')) return '📝';
    if (mime.includes('sheet') || mime.includes('excel'))   return '📊';
    if (mime.includes('presentation') || mime.includes('powerpoint')) return '📊';
    if (mime.includes('text'))          return '📃';
    return '📎';
}

// ── UI helpers ──────────────────────────────────────────────
function setAttachBtnLoading(loading, chatType) {
    const btns = chatType === 'direct'
        ? document.querySelectorAll('.attach-btn[data-chat="direct"]')
        : document.querySelectorAll('.attach-btn[data-chat="group"]');
    btns.forEach(btn => {
        btn.disabled = loading;
        btn.textContent = loading ? '⏳' : '📎';
    });
}

// showToast is defined in chat.js — re-use it
function showToast(msg, type = 'info') {
    if (window._showToast) {
        window._showToast(msg, type);
    }
}

// ── Wire up file input triggers ─────────────────────────────
function setupAttachButtons() {
    // Create hidden file inputs
    ['direct', 'group'].forEach(chatType => {
        const input = document.createElement('input');
        input.type = 'file';
        input.id   = `fileInput-${chatType}`;
        input.accept = 'image/*,application/pdf,video/*,audio/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt';
        input.style.display = 'none';
        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            input.value = '';
            if (!file) return;
            if (file.size > 25 * 1024 * 1024) {
                showToast('File too large (max 25 MB)', 'error');
                return;
            }
            // Token already obtained before file picker opened
            uploadFileToDrive(file, { type: chatType });
        });
        document.body.appendChild(input);
    });

    // Attach btn click:
    // Step 1 — get Drive token (popup opens here, from direct user click = not blocked)
    // Step 2 — after token received, open file picker
    document.querySelectorAll('.attach-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const chatType = btn.dataset.chat;
            if (driveAccessToken) {
                // Already have token — open file picker directly
                document.getElementById(`fileInput-${chatType}`)?.click();
            } else {
                // Need token first — popup from direct click = browser allows it
                if (!driveTokenClient) initDriveAuth();

                // Override callback to open file picker after auth
                driveTokenClient = google.accounts.oauth2.initTokenClient({
                    client_id: DRIVE_CLIENT_ID,
                    scope: DRIVE_SCOPE,
                    callback: (tokenResponse) => {
                        if (tokenResponse.error) {
                            showToast('Drive access denied', 'error');
                            return;
                        }
                        driveAccessToken = tokenResponse.access_token;
                        // Now open file picker — token is ready
                        document.getElementById(`fileInput-${chatType}`)?.click();
                    },
                    error_callback: (err) => {
                        if (err.type !== 'popup_closed') {
                            showToast('Drive auth failed', 'error');
                        }
                    }
                });
                driveTokenClient.requestAccessToken({ prompt: '' });
            }
        });
    });
}

// ── Expose globally ─────────────────────────────────────────
window.driveShare = {
    init: () => {
        initDriveAuth();
        setupAttachButtons();
    },
    renderFileMessage,
};
