import { useState, useEffect, useRef, useCallback } from 'react';
import { socket } from '../lib/socket.js';
import { api } from '../lib/api.js';
import EmojiPicker from 'emoji-picker-react';

const TYPING_DEBOUNCE = 1500;
const MAX_FILES = 5;
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

const ALLOWED_TYPES = new Set([
  'image/jpeg','image/png','image/gif','image/webp',
  'video/mp4','video/webm','video/ogg',
  'audio/mpeg','audio/ogg','audio/wav','audio/webm',
  'application/pdf','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]);

// ── Helpers ───────────────────────────────────────────────────
function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function fileIcon(mime) {
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime === 'application/pdf') return '📄';
  return '📁';
}

// ── Avatar ────────────────────────────────────────────────────
function Avatar({ name, color, avatarUrl, size = 'sm', online }) {
  const sz = size === 'xs' ? 'w-6 h-6 text-[10px]' : size === 'md' ? 'w-9 h-9 text-sm' : 'w-7 h-7 text-xs';
  return (
    <div className="relative flex-shrink-0">
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className={`${sz} rounded-full object-cover`} />
      ) : (
        <div className={`${sz} rounded-full flex items-center justify-center font-bold text-white`}
          style={{ backgroundColor: color || '#3B82F6' }}>
          {name?.[0]?.toUpperCase() || '?'}
        </div>
      )}
      {online !== undefined && (
        <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-white ${online ? 'bg-green-400' : 'bg-gray-300'}`} />
      )}
    </div>
  );
}

// ── Group Management Panel ────────────────────────────────────
function GroupPanel({ conversation, currentUser, onlineUsers, onClose, onUpdated }) {
  const [members, setMembers] = useState([]);
  const [addSearch, setAddSearch] = useState('');
  const [addResults, setAddResults] = useState([]);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(conversation.title || '');
  const [error, setError] = useState('');
  const isOwner = conversation.owner_id === currentUser.id;

  useEffect(() => {
    fetch(`/api/conversations/${conversation.id}/members`, { credentials: 'include' })
      .then(r => r.json()).then(d => setMembers(d.members || [])).catch(() => {});
  }, [conversation.id]);

  useEffect(() => {
    if (!addSearch.trim()) { setAddResults([]); return; }
    const t = setTimeout(() =>
      api.searchUsers(addSearch).then(({ users }) =>
        setAddResults(users.filter(u => !members.find(m => m.id === u.id)))
      ).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [addSearch, members]);

  const removeMember = async (userId) => {
    if (!window.confirm('Remove this member?')) return;
    try { await api.removeGroupMember(conversation.id, userId); setMembers(prev => prev.filter(m => m.id !== userId)); }
    catch (err) { setError(err.message); }
  };

  const addMember = async (u) => {
    try { await api.addGroupMember(conversation.id, u.id); setMembers(prev => [...prev, { ...u, joined_at: new Date().toISOString() }]); setAddSearch(''); setAddResults([]); }
    catch (err) { setError(err.message); }
  };

  const rename = async () => {
    if (!newName.trim()) return;
    try { await api.renameGroup(conversation.id, newName.trim()); setRenaming(false); onUpdated(); }
    catch (err) { setError(err.message); }
  };

  return (
    <div className="absolute top-0 right-0 h-full w-72 bg-white border-l border-gray-200 z-10 shadow-xl flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h3 className="font-semibold text-gray-900">Group Info</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Group Name</p>
            {isOwner && !renaming && <button onClick={() => setRenaming(true)} className="text-xs text-blue-500">Edit</button>}
          </div>
          {renaming ? (
            <div className="flex gap-2">
              <input value={newName} onChange={e => setNewName(e.target.value)} maxLength={50}
                className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button onClick={rename} className="bg-blue-600 text-white text-xs px-2 py-1 rounded">Save</button>
              <button onClick={() => setRenaming(false)} className="text-gray-500 text-xs px-1">✕</button>
            </div>
          ) : <p className="text-sm font-semibold text-gray-900">{conversation.title}</p>}
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Members ({members.length})</p>
          <div className="space-y-2">
            {members.map(m => (
              <div key={m.id} className="flex items-center gap-2">
                <Avatar name={m.name} color={m.avatar_color} avatarUrl={m.avatar_url} size="xs" online={onlineUsers?.has(m.id)} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{m.name} {m.id === currentUser.id && <span className="text-xs text-gray-400">(you)</span>} {conversation.owner_id === m.id && '👑'}</p>
                  <p className="text-xs text-gray-500">@{m.username}</p>
                </div>
                {isOwner && m.id !== currentUser.id && (
                  <button onClick={() => removeMember(m.id)} className="text-xs text-red-500 hover:text-red-700">✕</button>
                )}
              </div>
            ))}
          </div>
        </div>
        {isOwner && (
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Add Member</p>
            <input type="text" placeholder="Search @username…" value={addSearch} onChange={e => setAddSearch(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {addResults.length > 0 && (
              <div className="mt-1 border border-gray-200 rounded-lg max-h-28 overflow-y-auto">
                {addResults.map(u => (
                  <button key={u.id} onClick={() => addMember(u)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-blue-50 text-left text-sm">
                    <Avatar name={u.name} color={u.avatar_color} size="xs" />
                    <div><p className="font-medium text-xs">{u.name}</p><p className="text-xs text-gray-400">@{u.username}</p></div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
      <div className="p-4 border-t border-gray-100 space-y-2">
        {!isOwner && (
          <button onClick={async () => { if (!window.confirm('Leave this group?')) return; try { await api.leaveGroup(conversation.id); onUpdated(); onClose(); } catch (err) { setError(err.message); } }}
            className="w-full text-sm text-red-600 border border-red-200 hover:bg-red-50 rounded-lg py-2 font-medium">Leave Group</button>
        )}
        {isOwner && (
          <button onClick={async () => { if (!window.confirm('Delete this group?')) return; try { await api.deleteGroup(conversation.id); onUpdated(); onClose(); } catch (err) { setError(err.message); } }}
            className="w-full text-sm text-red-600 border border-red-200 hover:bg-red-50 rounded-lg py-2 font-medium">Delete Group</button>
        )}
      </div>
    </div>
  );
}

// ── Attachment Preview (before send) ─────────────────────────
function AttachPreview({ files, onRemove }) {
  return (
    <div className="flex flex-wrap gap-2 px-4 py-2 border-t border-gray-100 bg-gray-50">
      {files.map((f, i) => (
        <div key={i} className="relative group flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 shadow-sm max-w-xs">
          {f.type.startsWith('image/') ? (
            <img src={f.preview} alt={f.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
          ) : (
            <span className="text-xl flex-shrink-0">{fileIcon(f.type)}</span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-gray-900 truncate">{f.name}</p>
            <p className="text-xs text-gray-400">{fmtSize(f.size)}</p>
          </div>
          {f.uploading && <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
          {f.error && <span className="text-red-500 text-xs flex-shrink-0" title={f.error}>⚠️</span>}
          <button onClick={() => onRemove(i)}
            className="ml-1 w-5 h-5 bg-gray-200 hover:bg-red-100 text-gray-500 hover:text-red-600 rounded-full flex items-center justify-center text-xs flex-shrink-0 transition-colors">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Render a single attachment in message ─────────────────────
function AttachmentItem({ att, currentUserId }) {
  const url = `/api/upload/file/${att.storage_key}`;
  if (att.mime_type.startsWith('image/')) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block mt-1">
        <img src={url} alt={att.original_name} className="max-w-xs max-h-64 rounded-xl object-cover shadow-sm border border-gray-100 cursor-pointer hover:opacity-90 transition-opacity" />
      </a>
    );
  }
  if (att.mime_type.startsWith('video/')) {
    return (
      <video controls className="max-w-xs max-h-48 rounded-xl mt-1 border border-gray-100 shadow-sm" preload="metadata">
        <source src={url} type={att.mime_type} />
        Your browser doesn't support video.
      </video>
    );
  }
  if (att.mime_type.startsWith('audio/')) {
    return (
      <audio controls className="mt-1 w-full max-w-xs" preload="metadata">
        <source src={url} type={att.mime_type} />
      </audio>
    );
  }
  return (
    <a href={url} download={att.original_name}
      className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 mt-1 shadow-sm hover:bg-gray-50 transition-colors max-w-xs">
      <span className="text-2xl">{fileIcon(att.mime_type)}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 truncate">{att.original_name}</p>
        <p className="text-xs text-gray-400">{fmtSize(att.size)}</p>
      </div>
      <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
    </a>
  );
}

// ── Render message content with @mention highlights ───────────
function MessageContent({ content, mentions = [], currentUserId, onMentionClick }) {
  if (!content && (!mentions || mentions.length === 0)) return null;
  if (!content) return null;

  // Build mention regex from usernames present in the message
  if (!mentions.length) return <span className="whitespace-pre-wrap break-words">{content}</span>;

  // Sort by longest first to prevent partial matches
  const sorted = [...mentions].sort((a, b) => b.username.length - a.username.length);
  const parts = [];
  let remaining = content;

  // Simple segment-based parsing
  let text = content;
  const segments = [];
  while (text.length > 0) {
    let earliest = null;
    let earliestMention = null;
    for (const m of sorted) {
      const pat = `@${m.username}`;
      const idx = text.indexOf(pat);
      if (idx !== -1 && (earliest === null || idx < earliest)) {
        earliest = idx;
        earliestMention = { m, pat };
      }
    }
    if (earliest === null) {
      segments.push({ type: 'text', text });
      break;
    }
    if (earliest > 0) segments.push({ type: 'text', text: text.slice(0, earliest) });
    segments.push({ type: 'mention', mention: earliestMention.m });
    text = text.slice(earliest + earliestMention.pat.length);
  }

  return (
    <span className="whitespace-pre-wrap break-words">
      {segments.map((seg, i) => {
        if (seg.type === 'text') return <span key={i}>{seg.text}</span>;
        const isMe = seg.mention.userId === currentUserId;
        return (
          <button key={i} onClick={() => onMentionClick?.(seg.mention.userId)}
            className={`inline font-semibold rounded px-0.5 cursor-pointer hover:underline ${
              isMe ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-50 text-blue-600'
            }`}>
            @{seg.mention.username}
          </button>
        );
      })}
    </span>
  );
}

// ── Summary Panel ─────────────────────────────────────────────
function SummaryPanel({ summary, messageCount, limit, generatedAt, isStale, onRegenerate, onClose, regenerating }) {
  if (!summary) return null;
  const timeStr = generatedAt?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const rangeLabel = limit === 9999 ? 'all messages' : `last ${messageCount || limit} messages`;
  return (
    <div className="border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-purple-50 shadow-sm flex-shrink-0 max-h-80 overflow-y-auto">
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <span className="font-semibold text-gray-900 text-sm">Action Summary</span>
            <span className="text-xs text-gray-400">· {rangeLabel} · {timeStr}</span>
          </div>
          <div className="flex items-center gap-2">
            {isStale && <button onClick={onRegenerate} disabled={regenerating} className="text-xs bg-yellow-100 hover:bg-yellow-200 text-yellow-700 px-2 py-0.5 rounded-full font-medium disabled:opacity-60">{regenerating ? 'Updating…' : '⚠ Update'}</button>}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
          </div>
        </div>
        {summary.summary && <p className="text-gray-700 mb-3 text-sm leading-relaxed">{summary.summary}</p>}
        {summary.tasks?.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">📋 Tasks</p>
            <div className="space-y-1.5">{summary.tasks.map((t, i) => (
              <div key={i} className="bg-white border border-gray-100 rounded-lg px-3 py-2 text-sm">
                <span className="text-blue-500">→ </span><span className="font-medium">{t.assignee !== 'Not specified' ? `${t.assignee}: ` : ''}</span><span className="text-gray-700">{t.task}</span>
                {t.deadline && t.deadline !== 'Not specified' && <span className="ml-1 text-xs text-orange-500">· Due: {t.deadline}</span>}
              </div>
            ))}</div>
          </div>
        )}
        {summary.decisions?.length > 0 && (
          <div className="mb-3"><p className="text-xs font-semibold text-gray-500 uppercase mb-1.5">✅ Decisions</p>
            <ul className="space-y-1">{summary.decisions.map((d, i) => <li key={i} className="flex gap-2 text-gray-800 text-sm"><span className="text-green-500">•</span><span>{d}</span></li>)}</ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
export default function ChatWindow({
  conversation,
  currentUser,
  onlineUsers = new Set(),
  onNewMessage,
  onAccept,
  onBlock,
  onShowProfile,
  onConversationUpdated,
  onToggleSidebar,
  isSidebarOpen,
}) {
  const user = currentUser;
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sendError, setSendError] = useState('');
  const [showGroupPanel, setShowGroupPanel] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  // File attachment state
  const [pendingFiles, setPendingFiles] = useState([]); // [{name, size, type, preview, id (after upload), uploading, error}]
  const fileInputRef = useRef(null);
  const dropZoneRef = useRef(null);

  // Mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState(''); // text after @ trigger
  const [mentionResults, setMentionResults] = useState([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionTriggerPos, setMentionTriggerPos] = useState(null); // index in input where @ was typed
  const [pendingMentions, setPendingMentions] = useState([]); // [{userId, username, name}]
  const [groupMembers, setGroupMembers] = useState([]);

  // Summary state
  const [summaryCache, setSummaryCache] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [showSummary, setShowSummary] = useState(false);
  const [summaryLimit, setSummaryLimit] = useState(50);

  const bottomRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimer = useRef(null);
  const seenIds = useRef(new Set());
  const isNearBottom = useRef(true);

  const scrollToBottom = useCallback((force = false) => {
    if (force || isNearBottom.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // ── Load group members for mention autocomplete ───────────────
  useEffect(() => {
    if (!conversation || conversation.type !== 'GROUP') { setGroupMembers([]); return; }
    fetch(`/api/conversations/${conversation.id}/members`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setGroupMembers((d.members || []).filter(m => m.id !== user?.id)))
      .catch(() => {});
  }, [conversation?.id]);

  // ── Load history ──────────────────────────────────────────────
  useEffect(() => {
    if (!conversation) return;
    setMessages([]); seenIds.current = new Set(); setLoadingHistory(true);
    setSummaryCache(null); setShowSummary(false); setSendError('');
    setShowGroupPanel(false); setPendingFiles([]); setPendingMentions([]);
    setInput(''); setMentionQuery(''); setMentionTriggerPos(null);

    socket.emit('conversation:join', conversation.id, (res) => {
      if (res?.error) console.error('Join error:', res.error);
    });

    api.getMessages(conversation.id)
      .then(({ messages: msgs, hasMore: more }) => {
        const unique = msgs.filter(m => !seenIds.current.has(m.id));
        unique.forEach(m => seenIds.current.add(m.id));
        setMessages(unique); setHasMore(more);
        if (unique.length > 0 && onNewMessage) onNewMessage(conversation.id, unique[unique.length - 1]);
        if (unique.length > 0) api.markRead(conversation.id, unique[unique.length - 1].id).catch(() => {});
        setTimeout(() => scrollToBottom(true), 50);
      })
      .catch(console.error)
      .finally(() => setLoadingHistory(false));
  }, [conversation?.id]);

  // ── Socket listeners ──────────────────────────────────────────
  useEffect(() => {
    if (!conversation) return;
    const onMessage = (msg) => {
      if (msg.conversation_id !== conversation.id) return;
      if (seenIds.current.has(msg.id)) return;
      seenIds.current.add(msg.id);
      setMessages(prev => [...prev, msg]);
      onNewMessage?.(conversation.id, msg);
      scrollToBottom();
    };
    const onTyping = ({ conversationId, typingUsers: names }) => {
      if (conversationId !== conversation.id) return;
      setTypingUsers(names.filter(n => n !== user?.name));
    };
    socket.on('message:new', onMessage);
    socket.on('typing:update', onTyping);
    return () => { socket.off('message:new', onMessage); socket.off('typing:update', onTyping); };
  }, [conversation?.id, user?.name]);

  // ── Scroll tracking ───────────────────────────────────────────
  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    isNearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  };

  // ── Load older messages ───────────────────────────────────────
  const loadMore = async () => {
    if (loadingMore || !hasMore || !messages.length) return;
    setLoadingMore(true);
    const oldest = messages[0];
    try {
      const { messages: older, hasMore: more } = await api.getMessages(conversation.id, `${oldest.created_at}_${oldest.id}`);
      const unique = older.filter(m => !seenIds.current.has(m.id));
      unique.forEach(m => seenIds.current.add(m.id));
      const el = listRef.current; const prevScrollHeight = el?.scrollHeight || 0;
      setMessages(prev => [...unique, ...prev]); setHasMore(more);
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - prevScrollHeight; });
    } catch (err) { console.error(err); } finally { setLoadingMore(false); }
  };

  // ── File handling ─────────────────────────────────────────────
  const addFiles = (fileList) => {
    const arr = Array.from(fileList);
    const errors = [];

    const valid = arr.filter(f => {
      if (!ALLOWED_TYPES.has(f.type)) { errors.push(`${f.name}: type not allowed`); return false; }
      if (f.size > MAX_FILE_SIZE) { errors.push(`${f.name}: too large (max 25 MB)`); return false; }
      return true;
    });

    if (errors.length) setSendError(errors.join(' · '));

    const newItems = valid.slice(0, MAX_FILES - pendingFiles.length).map(f => ({
      file: f, name: f.name, size: f.size, type: f.type,
      preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
      uploading: false, uploaded: false, id: null, error: null,
    }));

    setPendingFiles(prev => [...prev, ...newItems]);
  };

  const removeFile = (i) => {
    setPendingFiles(prev => {
      const next = [...prev];
      if (next[i].preview) URL.revokeObjectURL(next[i].preview);
      next.splice(i, 1);
      return next;
    });
  };

  // Upload a single file, update its state
  const uploadFile = async (idx) => {
    const item = pendingFiles[idx];
    if (!item || item.uploaded || item.uploading) return item?.id || null;

    setPendingFiles(prev => prev.map((f, i) => i === idx ? { ...f, uploading: true, error: null } : f));
    try {
      const formData = new FormData();
      formData.append('files', item.file, item.name);
      const resp = await fetch(`/api/upload/${conversation.id}`, {
        method: 'POST', body: formData, credentials: 'include',
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Upload failed');
      const att = data.attachments[0];
      setPendingFiles(prev => prev.map((f, i) => i === idx ? { ...f, uploading: false, uploaded: true, id: att.id } : f));
      return att.id;
    } catch (err) {
      setPendingFiles(prev => prev.map((f, i) => i === idx ? { ...f, uploading: false, error: err.message } : f));
      return null;
    }
  };

  // ── Drag and Drop ─────────────────────────────────────────────
  useEffect(() => {
    const el = dropZoneRef.current;
    if (!el) return;
    const prevent = e => { e.preventDefault(); e.stopPropagation(); };
    const onDrop = (e) => { e.preventDefault(); e.stopPropagation(); addFiles(e.dataTransfer.files); };
    el.addEventListener('dragover', prevent); el.addEventListener('drop', onDrop);
    return () => { el.removeEventListener('dragover', prevent); el.removeEventListener('drop', onDrop); };
  }, [pendingFiles.length, conversation?.id]);

  // ── Mention autocomplete ──────────────────────────────────────
  const handleMentionSelect = (member) => {
    if (mentionTriggerPos === null) return;
    const before = input.slice(0, mentionTriggerPos);
    const after = input.slice(mentionTriggerPos + 1 + mentionQuery.length); // remove @query
    const newInput = before + `@${member.username}` + after;
    setInput(newInput);
    setPendingMentions(prev => {
      if (prev.find(m => m.userId === member.id)) return prev;
      return [...prev, { userId: member.id, username: member.username, name: member.name }];
    });
    setMentionTriggerPos(null); setMentionQuery(''); setMentionResults([]);
    // Focus input, set cursor after inserted mention
    setTimeout(() => {
      if (inputRef.current) {
        const pos = before.length + member.username.length + 1;
        inputRef.current.setSelectionRange(pos, pos);
        inputRef.current.focus();
      }
    }, 0);
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInput(val);
    socket.emit('typing:start', { conversationId: conversation.id });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => socket.emit('typing:stop', { conversationId: conversation.id }), TYPING_DEBOUNCE);

    // Detect @ mention trigger
    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = val.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\w*)$/);
    if (atMatch && conversation?.type === 'GROUP') {
      const query = atMatch[1].toLowerCase();
      const triggerPos = cursorPos - 1 - query.length;
      setMentionTriggerPos(triggerPos);
      setMentionQuery(query);
      setMentionIndex(0);
      const filtered = groupMembers.filter(m =>
        m.name.toLowerCase().includes(query) || m.username.toLowerCase().includes(query)
      ).slice(0, 8);
      setMentionResults(filtered);
    } else {
      setMentionTriggerPos(null); setMentionQuery(''); setMentionResults([]);
    }

    // Remove mentions from pendingMentions if their @username was deleted from input
    setPendingMentions(prev => prev.filter(m => val.includes(`@${m.username}`)));
  };

  const handleKeyDown = (e) => {
    if (mentionResults.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, mentionResults.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); handleMentionSelect(mentionResults[mentionIndex]); return; }
      if (e.key === 'Escape') { setMentionResults([]); setMentionTriggerPos(null); return; }
    }
  };

  // ── Send message ──────────────────────────────────────────────
  const sendMessage = async (e) => {
    e.preventDefault();
    const hasText = input.trim();
    const hasFiles = pendingFiles.length > 0;
    if (!hasText && !hasFiles) return;
    if (sending) return;

    setSending(true); setSendError(''); setMentionResults([]); setShowEmojiPicker(false);

    // Upload any files that haven't been uploaded yet
    let uploadedIds = pendingFiles.filter(f => f.uploaded).map(f => f.id);
    const unuploaded = pendingFiles.map((f, i) => ({ f, i })).filter(({ f }) => !f.uploaded && !f.error);
    for (const { i } of unuploaded) {
      const id = await uploadFile(i);
      if (id) uploadedIds.push(id);
    }

    const clientMessageId = crypto.randomUUID();
    const content = input.trim();
    const mentions = pendingMentions.filter(m => content.includes(`@${m.username}`));

    setInput(''); setPendingFiles([]); setPendingMentions([]);
    socket.emit('typing:stop', { conversationId: conversation.id });
    clearTimeout(typingTimer.current);

    socket.emit('message:send',
      { conversationId: conversation.id, clientMessageId, content, attachmentIds: uploadedIds, mentions },
      (ack) => {
        setSending(false);
        if (ack?.error) { setSendError(ack.error); setInput(content); }
      }
    );
  };

  // ── AI Summary ────────────────────────────────────────────────
  const currentLastMsgId = messages[messages.length - 1]?.id;
  const hasNewMessagesSinceLastSummary = summaryCache && (summaryCache.lastMessageId !== currentLastMsgId || summaryCache.limit !== summaryLimit);

  const handleActionSummary = async (forceRegenerate = false) => {
    if (summaryCache && !forceRegenerate && !hasNewMessagesSinceLastSummary) { setShowSummary(true); return; }
    setSummaryLoading(true); setSummaryError('');
    try {
      const res = await api.getSummary(conversation.id, summaryLimit);
      setSummaryCache({ summary: res.summary, lastMessageId: res.lastMessageId, limit: summaryLimit, messageCount: res.messageCount, generatedAt: new Date() });
      setShowSummary(true);
    } catch (err) { setSummaryError(err.message); } finally { setSummaryLoading(false); }
  };

  // ── Derived values ────────────────────────────────────────────
  const isGroup = conversation?.type === 'GROUP';
  const otherMember = !isGroup ? conversation?.members?.find(m => m.id !== user?.id) : null;
  const displayName = isGroup ? (conversation?.title || 'Group') : (otherMember?.name || 'Unknown');
  const displayColor = isGroup ? '#8B5CF6' : (otherMember?.avatar_color || '#3B82F6');
  const otherOnline = !isGroup && otherMember ? onlineUsers.has(otherMember.id) : false;
  const isPending = conversation?.isRequest === true;
  const memberCount = conversation?.members?.length;

  const formatTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts.includes('Z') ? ts : ts + 'Z');
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDateDivider = (ts) => {
    if (!ts) return '';
    const d = new Date(ts.includes('Z') ? ts : ts + 'Z');
    const now = new Date();
    const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    const formatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    if (isToday) return `Today, ${formatter.format(d)}`;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth() && d.getFullYear() === yesterday.getFullYear()) {
      return `Yesterday, ${formatter.format(d)}`;
    }
    return formatter.format(d);
  };

  const shouldShowSender = (msg, i) => {
    return i === 0 || messages[i - 1]?.sender_id !== msg.sender_id;
  };

  // ── Empty state ───────────────────────────────────────────────
  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 text-gray-400">
        <div className="text-center">
          <div className="text-5xl mb-4">💬</div>
          <p className="font-medium text-gray-600">Select a conversation</p>
          <p className="text-sm mt-1">Or search for a student to start chatting</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={dropZoneRef} className="flex-1 flex flex-col overflow-hidden relative bg-gray-50/30">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white shadow-[0_2px_10px_-10px_rgba(0,0,0,0.1)] flex-shrink-0">
        <div className="flex items-center gap-4">
          <button className="md:hidden text-gray-500 hover:text-gray-700">
             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div className="flex items-center gap-3">
            {isGroup ? (
              <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
              </div>
            ) : (
              <Avatar name={displayName} color={displayColor} avatarUrl={otherMember?.avatar_url} size="md" />
            )}
            <div>
              <p className="font-bold text-gray-900 text-sm leading-tight">{displayName}</p>
              {typingUsers.length > 0 ? (
                <p className="text-xs font-semibold text-blue-500 animate-pulse">
                  {typingUsers.length === 1 ? `${typingUsers[0]} is typing…` : 'Several people are typing…'}
                </p>
              ) : isGroup ? (
                <p className="text-xs text-gray-500">{memberCount} members</p>
              ) : (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`w-2 h-2 rounded-full ${otherOnline ? 'bg-green-500' : 'bg-gray-300'}`} />
                  <span className="text-[11px] font-medium text-gray-500">{otherOnline ? 'Online' : 'Offline'}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Request banner ──────────────────────────────────────── */}
      {isPending && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-6 py-3 flex-shrink-0 flex items-center justify-between shadow-sm z-10">
          <div>
            <p className="text-sm font-semibold text-yellow-800">{displayName} sent you a message request</p>
            <p className="text-xs text-yellow-700 mt-0.5">Accept to reply. Block to stop messages.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => onAccept?.(conversation.id)} className="bg-green-500 hover:bg-green-600 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors shadow-sm">Accept</button>
            <button onClick={() => onBlock?.(conversation.id)} className="bg-red-100 hover:bg-red-200 text-red-600 text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors">Block</button>
          </div>
        </div>
      )}

      {/* ── Message list ────────────────────────────────────────── */}
      <div ref={listRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 py-6 space-y-2 relative bg-[#FAFCFF]">
        {hasMore && (
          <div className="text-center mb-4">
            <button onClick={loadMore} disabled={loadingMore}
              className="text-xs text-blue-500 hover:text-blue-700 bg-white border border-gray-200 px-4 py-1.5 rounded-full shadow-sm disabled:opacity-50 font-semibold transition-all">
              {loadingMore ? 'Loading…' : 'Load older messages'}
            </button>
          </div>
        )}
        
        {loadingHistory ? (
          <div className="flex items-center justify-center py-12"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400"><div className="text-4xl mb-3">👋</div><p className="text-sm font-medium">Say hello!</p></div>
        ) : (
          messages.map((msg, i) => {
            const isMine = msg.sender_id === user?.id;
            const showSender = shouldShowSender(msg, i);
            const time = formatTime(msg.created_at);
            
            const msgDate = new Date(msg.created_at.includes('Z') ? msg.created_at : msg.created_at + 'Z');
            const prevMsg = i > 0 ? messages[i - 1] : null;
            const prevMsgDate = prevMsg ? new Date(prevMsg.created_at.includes('Z') ? prevMsg.created_at : prevMsg.created_at + 'Z') : null;
            const showDate = !prevMsgDate || msgDate.toDateString() !== prevMsgDate.toDateString();

            return (
              <div key={msg.id}>
                {showDate && (
                  <div className="text-center my-6">
                     <span className="text-[11px] font-medium text-gray-500 bg-gray-100/80 backdrop-blur-sm border border-gray-200 px-4 py-1.5 rounded-full shadow-sm">{formatDateDivider(msg.created_at)}</span>
                  </div>
                )}
                <div className={`flex ${isMine ? 'justify-end' : 'justify-start'} ${showSender && !showDate ? 'mt-4' : 'mt-1'}`}>
                  <div className={`flex items-end gap-2 max-w-[80%] ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
                    
                    {showSender ? (
                       <Avatar name={msg.sender_name || user?.name} color={msg.sender_color || user?.avatar_color} avatarUrl={msg.sender_avatar_url || user?.avatar_url} size="sm" />
                    ) : (
                       <div className="w-8 flex-shrink-0" />
                    )}

                    {!isMine ? (
                       // Received Message
                       <div className="flex flex-col items-start gap-1">
                          {msg.attachments?.map((att, idx) => (
                             <div key={att.id} className="relative">
                               <AttachmentItem att={att} />
                               {!msg.content && idx === msg.attachments.length - 1 && (
                                 <span className="absolute bottom-1 -right-10 text-[10px] font-medium text-gray-400">{time}</span>
                               )}
                             </div>
                          ))}
                          {msg.content && (
                             <div className="flex items-end flex-row">
                                <div className="px-4 py-2.5 rounded-2xl text-[15px] shadow-[0_1px_2px_rgba(0,0,0,0.05)] bg-[#f0f4f8] text-gray-800 rounded-bl-sm">
                                   <MessageContent content={msg.content} mentions={msg.mentions || []} currentUserId={user?.id} onMentionClick={onShowProfile} />
                                </div>
                                <span className="text-[10px] font-medium text-gray-400 flex-shrink-0 mb-1 ml-1">{time}</span>
                             </div>
                          )}
                       </div>
                    ) : (
                       // Sent Message
                       <div className="flex flex-col items-end gap-1">
                          {msg.attachments?.map((att, idx) => (
                             <div key={att.id} className="relative group">
                               <AttachmentItem att={att} />
                               {!msg.content && idx === msg.attachments.length - 1 && (
                                 <div className="absolute bottom-2 right-2 bg-black/40 px-1.5 py-0.5 rounded-full flex items-center gap-1 backdrop-blur-sm pointer-events-none">
                                   <span className="text-[10px] text-white font-medium leading-none">{time}</span>
                                   <div className="flex -space-x-1.5 relative top-[0.5px]">
                                     <svg className="w-[12px] h-[12px] text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                                     <svg className="w-[12px] h-[12px] text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                                   </div>
                                 </div>
                               )}
                             </div>
                          ))}
                          {msg.content && (
                             <div className="px-4 py-2.5 rounded-2xl text-[15px] shadow-[0_1px_2px_rgba(0,0,0,0.1)] bg-[#3B82F6] text-white rounded-br-sm flex flex-col min-w-[80px]">
                                <MessageContent content={msg.content} mentions={msg.mentions || []} currentUserId={user?.id} onMentionClick={onShowProfile} />
                                <div className="flex justify-end items-center gap-1 mt-1 opacity-90 -mb-1 -mr-1">
                                  <span className="text-[10px] text-white/90 leading-none">{time}</span>
                                  <div className="flex -space-x-1.5 relative top-[1px]">
                                    <svg className="w-[12px] h-[12px] text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                                    <svg className="w-[12px] h-[12px] text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                                  </div>
                                </div>
                             </div>
                          )}
                       </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Composer ────────────────────────────────────────────── */}
      {!isPending && (
        <div className="bg-white flex-shrink-0 px-6 py-4 shadow-[0_-2px_10px_-10px_rgba(0,0,0,0.1)] relative z-10">
          {pendingFiles.length > 0 && <div className="mb-3"><AttachPreview files={pendingFiles} onRemove={removeFile} /></div>}
          
          {sendError && (
            <div className="flex items-center gap-2 text-red-600 text-xs mb-3 bg-red-50 px-4 py-2 rounded-xl">
              <span>⚠️ {sendError}</span>
              <button onClick={() => setSendError('')} className="ml-auto text-red-400 hover:text-red-600 font-bold">✕</button>
            </div>
          )}

          {mentionResults.length > 0 && (
            <div className="absolute bottom-full mb-2 left-6 right-6 border border-gray-100 rounded-2xl bg-white shadow-xl overflow-hidden z-20">
              {mentionResults.map((m, i) => (
                <button key={m.id} onClick={() => handleMentionSelect(m)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${i === mentionIndex ? 'bg-blue-50/50' : 'hover:bg-gray-50'}`}>
                  <Avatar name={m.name} color={m.avatar_color} avatarUrl={m.avatar_url} size="sm" />
                  <div>
                    <p className="font-bold text-gray-900 text-sm leading-tight">{m.name}</p>
                    <p className="text-xs text-blue-500">@{m.username}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {showEmojiPicker && (
            <div className="absolute bottom-full right-16 mb-2 z-50 shadow-2xl rounded-2xl overflow-hidden bg-white border border-gray-100 flex flex-col" style={{ width: '280px' }}>
              <div className="flex items-center justify-between px-4 pt-4 pb-2 bg-white">
                <div className="flex items-center gap-2">
                  <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <span className="font-bold text-gray-900 text-[17px]">Emoji</span>
                </div>
                <button type="button" onClick={() => setShowEmojiPicker(false)} className="text-gray-400 hover:text-gray-800 transition-colors p-1">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <EmojiPicker 
                onEmojiClick={(emojiData) => setInput(prev => prev + emojiData.emoji)} 
                theme="light"
                emojiStyle="apple"
                previewConfig={{ showPreview: false }}
                width="100%"
                height="280px"
                style={{ border: 'none', '--epr-picker-border-radius': '0' }}
              />
            </div>
          )}
          <form onSubmit={sendMessage} className="flex items-center gap-3">
            
            <div className="flex-1 flex items-center bg-gray-50 border border-gray-100 rounded-full px-2 py-1 relative">
              <input ref={inputRef} value={input} onChange={handleInputChange} onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                className="flex-1 bg-transparent px-4 py-3 text-lg focus:outline-none text-gray-900 placeholder-gray-400" />
              
              <div className="flex items-center gap-1 pr-2">
                <button type="button" onClick={() => setShowEmojiPicker(v => !v)} className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </button>
                <input ref={fileInputRef} type="file" multiple accept={[...ALLOWED_TYPES].join(',')} className="hidden"
                  onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={pendingFiles.length >= MAX_FILES}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50">
                  <svg className="w-5 h-5 transform -rotate-45" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                </button>
              </div>
            </div>

            <button type="submit" disabled={(!input.trim() && !pendingFiles.length) || sending}
              className="w-12 h-12 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-full flex items-center justify-center transition-all shadow-md shadow-blue-200 flex-shrink-0">
              {sending ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-5 h-5 transform translate-x-0.5 -translate-y-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
              )}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

