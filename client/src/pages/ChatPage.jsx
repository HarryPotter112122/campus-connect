import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../hooks/useAuth.jsx';
import ChatWindow from '../components/ChatWindow.jsx';
import { socket } from '../lib/socket.js';

// ── Shared components ─────────────────────────────────────────
function Avatar({ name, color, avatarUrl, size = 'md', online }) {
  const sz = size === 'xs' ? 'w-6 h-6 text-[10px]' :
             size === 'sm' ? 'w-8 h-8 text-xs' :
             size === 'lg' ? 'w-12 h-12 text-lg' :
             size === 'xl' ? 'w-24 h-24 text-3xl' :
             'w-10 h-10 text-sm';
  return (
    <div className="relative flex-shrink-0">
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className={`${sz} rounded-full object-cover shadow-sm`} />
      ) : (
        <div className={`${sz} rounded-full flex items-center justify-center font-bold text-white shadow-sm`}
          style={{ backgroundColor: color || '#3B82F6' }}>
          {name?.[0]?.toUpperCase() || '?'}
        </div>
      )}
      {online !== undefined && (
        <span className={`absolute bottom-0 right-0 rounded-full border-2 border-white ${online ? 'bg-green-500' : 'bg-gray-300'} ${size === 'xl' ? 'w-5 h-5' : size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3'}`} />
      )}
    </div>
  );
}

function Toast({ toast, onClick, onClose }) {
  return (
    <div onClick={onClick} className="flex items-start gap-3 bg-gray-900 text-white rounded-xl shadow-2xl px-4 py-3 cursor-pointer hover:bg-gray-800 transition-colors max-w-xs w-full animate-slide-in">
      <Avatar name={toast.senderName} color={toast.color} size="sm" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">{toast.senderName}</p>
        <p className="text-xs text-gray-300 truncate">{toast.content}</p>
        {toast.isRequest && <p className="text-xs text-yellow-400 mt-0.5">📩 Message request</p>}
      </div>
      <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="text-gray-500 hover:text-gray-300 text-lg leading-none flex-shrink-0">✕</button>
    </div>
  );
}

// ── Modals ────────────────────────────────────────────────────
function CreateGroupModal({ onClose, onCreated, currentUserId }) {
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!search.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      const { users } = await api.searchUsers(search).catch(() => ({ users: [] }));
      setResults(users.filter(u => u.id !== currentUserId && !selected.find(s => s.id === u.id)));
    }, 300);
    return () => clearTimeout(t);
  }, [search, selected, currentUserId]);

  const toggle = (u) => setSelected(prev => prev.find(s => s.id === u.id) ? prev.filter(s => s.id !== u.id) : [...prev, u]);

  const create = async () => {
    if (!name.trim()) return setError('Group name is required');
    if (selected.length === 0) return setError('Add at least one member');
    setLoading(true); setError('');
    try {
      const { conversation } = await api.createGroup(name.trim(), selected.map(u => u.id));
      onCreated(conversation); onClose();
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Create Group</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Group Name</label>
            <input type="text" placeholder="e.g. Project Team" value={name} maxLength={50} onChange={e => setName(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Add Members</label>
            <input type="text" placeholder="Search @username or name" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {results.length > 0 && (
              <div className="mt-2 border border-gray-100 rounded-xl max-h-40 overflow-y-auto bg-white shadow-sm">
                {results.map(u => (
                  <button key={u.id} onClick={() => toggle(u)} className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 transition-colors text-left">
                    <Avatar name={u.name} color={u.avatar_color} avatarUrl={u.avatar_url} size="sm" />
                    <div><p className="text-sm font-medium text-gray-900">{u.name}</p><p className="text-xs text-gray-500">@{u.username}</p></div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2">
              {selected.map(u => (
                <span key={u.id} className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full text-xs font-medium">
                  {u.name} <button onClick={() => toggle(u)} className="hover:text-blue-900">✕</button>
                </span>
              ))}
            </div>
          )}
          {error && <p className="text-sm text-red-600 bg-red-50 p-2 rounded-lg">{error}</p>}
          <button onClick={create} disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl py-2.5 mt-2 transition-colors disabled:opacity-50">
            {loading ? 'Creating...' : 'Create Group'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfilePanel({ userId, currentUserId, isOnline, onClose, onProfileUpdated }) {
  const [profile, setProfile] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', username: '', bio: '', avatar_url: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isOwn = userId === currentUserId;

  const PRESET_AVATARS = Array.from({ length: 36 }, (_, i) => `/avatars/av${(i + 1).toString().padStart(2, '0')}.jpg`);

  useEffect(() => {
    setLoading(true);
    api.getProfile(userId).then(data => {
      setProfile(data.user);
      setForm({ name: data.user.name, username: data.user.username, bio: data.user.bio || '', avatar_url: data.user.avatar_url || '' });
    }).catch(err => setError(err.message)).finally(() => setLoading(false));
  }, [userId]);

  const save = async () => {
    setSaving(true); setError('');
    try {
      const data = await api.updateProfile(form);
      setProfile(data.user);
      onProfileUpdated(data.user);
      setEditing(false);
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  };

  const handlePhotoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setError('Photo must be less than 5MB');
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX = 256; let w = img.width; let h = img.height;
        if (w > h) { if (w > MAX) { h *= MAX / w; w = MAX; } } else { if (h > MAX) { w *= MAX / h; h = MAX; } }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        setForm({ ...form, avatar_url: canvas.toDataURL('image/jpeg', 0.8) });
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
        {loading ? <div className="p-8 text-center text-gray-500">Loading profile...</div> : (
            <div className="flex flex-col max-h-[85vh] overflow-y-auto scrollbar-none relative">
              <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 bg-black/20 hover:bg-black/40 text-white rounded-full flex items-center justify-center transition-colors z-20">✕</button>
              
              <div className="relative h-32 bg-gradient-to-br from-blue-400 to-indigo-600 flex-shrink-0 overflow-hidden">
                 <svg className="absolute bottom-0 w-full h-12 text-white" preserveAspectRatio="none" viewBox="0 0 1440 320" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                    <path d="M0,160L48,176C96,192,192,224,288,213.3C384,203,480,149,576,149.3C672,149,768,203,864,224C960,245,1056,235,1152,213.3C1248,192,1344,160,1392,144L1440,128L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"></path>
                 </svg>
              </div>
              
              <div className="px-6 pb-6 pt-0 relative flex-1">
                <div className="flex justify-center -mt-14 mb-4 relative z-10">
                <div className="rounded-full ring-4 ring-white bg-white">
                  <Avatar name={form.name} color={profile.avatar_color} avatarUrl={form.avatar_url} size="xl" online={isOnline} />
                </div>
                {editing && (
                  <div className="absolute -bottom-2 right-1/2 translate-x-12 flex gap-1 bg-white rounded-full p-1 shadow-md border border-gray-100">
                     <label className="cursor-pointer w-8 h-8 flex items-center justify-center text-gray-600 hover:bg-gray-50 rounded-full transition-colors" title="Upload Photo">
                        📷<input type="file" className="hidden" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoUpload} />
                     </label>
                     {form.avatar_url && (
                        <button onClick={() => setForm({...form, avatar_url: ''})} className="w-8 h-8 flex items-center justify-center text-red-500 hover:bg-red-50 rounded-full transition-colors" title="Remove Photo">🗑</button>
                     )}
                  </div>
                )}
              </div>

              {!editing ? (
                <div className="flex flex-col items-center">
                  <h2 className="text-2xl font-bold text-gray-900">{profile.name}</h2>
                  <p className="text-gray-500 mt-1">@{profile.username}</p>
                  
                  {isOnline ? (
                    <div className="mt-3 flex items-center gap-1.5 px-3 py-1 bg-green-50 text-green-600 rounded-full text-xs font-semibold shadow-sm border border-green-100">
                      <div className="w-2 h-2 rounded-full bg-green-500"></div>
                      Online
                    </div>
                  ) : (
                    <div className="mt-3 flex items-center gap-1.5 px-3 py-1 bg-gray-50 text-gray-500 rounded-full text-xs font-semibold shadow-sm border border-gray-100">
                      <div className="w-2 h-2 rounded-full bg-gray-400"></div>
                      Offline
                    </div>
                  )}

                  {/* Stats Section */}
                  <div className="flex justify-between items-center w-full bg-gray-50/80 rounded-2xl p-4 mt-6 border border-gray-100 shadow-sm">
                    <div className="text-center flex-1 border-r border-gray-200 last:border-0">
                      <p className="font-bold text-gray-900 text-lg">{profile.stats?.groups || 0}</p>
                      <p className="text-xs text-gray-500 font-medium">Groups</p>
                    </div>
                    <div className="text-center flex-1 border-r border-gray-200 last:border-0">
                      <p className="font-bold text-gray-900 text-lg">{profile.stats?.connections || 0}</p>
                      <p className="text-xs text-gray-500 font-medium">Connections</p>
                    </div>
                  </div>

                  <div className="mt-6 text-left w-full px-2">
                    <div className="flex items-center gap-2 mb-2 text-gray-900 font-semibold">
                      <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      About
                    </div>
                    <p className="text-sm text-gray-500 leading-relaxed pl-1">
                      {profile.bio || 'No bio provided.'}
                    </p>
                  </div>

                  {isOwn && (
                    <button onClick={() => setEditing(true)} className="mt-6 w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-2xl transition-colors text-sm shadow-md shadow-blue-200">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                      Edit Profile
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-4 pt-2">
                  {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-xl border border-red-100">{error}</div>}
                  
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Name</label>
                    <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} maxLength={50}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Username</label>
                    <input value={form.username} onChange={e => setForm({...form, username: e.target.value.toLowerCase()})} maxLength={24}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Bio</label>
                    <textarea value={form.bio} onChange={e => setForm({...form, bio: e.target.value})} maxLength={300} rows={3}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none" />
                  </div>
                  
                  <div>
                     <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Preset Avatars</label>
                     <div className="grid grid-cols-6 gap-2 max-h-32 overflow-y-auto p-1 scrollbar-none">
                       {PRESET_AVATARS.map(url => (
                         <button key={url} onClick={() => setForm({...form, avatar_url: url})}
                           className={`rounded-full overflow-hidden border-2 transition-all ${form.avatar_url === url ? 'border-blue-500 scale-110 shadow-md' : 'border-transparent hover:scale-105'}`}>
                           <img src={url} alt="preset" className="w-full h-auto" loading="lazy" />
                         </button>
                       ))}
                     </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button onClick={() => { setEditing(false); setForm({ name: profile.name, username: profile.username, bio: profile.bio || '', avatar_url: profile.avatar_url || '' }); setError(''); }}
                      className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-semibold rounded-xl py-2.5 transition-colors text-sm">Cancel</button>
                    <button onClick={save} disabled={saving}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl py-2.5 transition-colors text-sm disabled:opacity-50">
                      {saving ? 'Saving...' : 'Save Profile'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Real Right Sidebar ────────────────────────────────────────
function RightSidebar({ user, selectedConv, onlineUsers, onEditProfile, onUpdated }) {
  const [members, setMembers] = useState([]);
  const [addSearch, setAddSearch] = useState('');
  const [addResults, setAddResults] = useState([]);
  const [error, setError] = useState('');

  const isGroup = selectedConv?.type === 'GROUP';
  const otherMember = !isGroup ? selectedConv?.members?.find(m => m.id !== user.id) : null;
  const isOwner = isGroup && selectedConv.owner_id === user.id;

  // Fetch group members if group
  useEffect(() => {
    if (!isGroup) return;
    fetch(`/api/conversations/${selectedConv.id}/members`, { credentials: 'include' })
      .then(r => r.json()).then(d => setMembers(d.members || [])).catch(() => {});
  }, [selectedConv?.id, isGroup]);

  // Search to add
  useEffect(() => {
    if (!addSearch.trim()) { setAddResults([]); return; }
    const t = setTimeout(() => api.searchUsers(addSearch).then(({ users }) => setAddResults(users.filter(u => !members.find(m => m.id === u.id)))).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [addSearch, members]);

  const addMember = async (u) => {
    try { await api.addGroupMember(selectedConv.id, u.id); setMembers(prev => [...prev, { ...u, joined_at: new Date().toISOString() }]); setAddSearch(''); setAddResults([]); }
    catch (err) { setError(err.message); }
  };
  const removeMember = async (userId) => {
    if (!window.confirm('Remove member?')) return;
    try { await api.removeGroupMember(selectedConv.id, userId); setMembers(prev => prev.filter(m => m.id !== userId)); }
    catch (err) { setError(err.message); }
  };

  if (!selectedConv) {
    // Empty state: Show current user + online directory
    const activeIds = Array.from(onlineUsers).filter(id => id !== user.id);
    return (
      <aside className="w-[300px] bg-white border-l border-gray-100 flex flex-col h-full overflow-y-auto flex-shrink-0">
        <div className="relative h-28 bg-gradient-to-r from-blue-50 to-indigo-50"></div>
        <div className="px-6 pb-6 pt-0 text-center relative border-b border-gray-100">
          <div className="absolute -top-12 left-1/2 -translate-x-1/2">
             <Avatar name={user.name} color={user.avatar_color} avatarUrl={user.avatar_url} size="xl" online={true} />
          </div>
          <div className="mt-14 mb-4">
            <h2 className="text-xl font-bold text-gray-900">{user.name}</h2>
            <p className="text-sm font-medium text-blue-500">@{user.username}</p>
          </div>
          <button onClick={onEditProfile} className="bg-gray-50 hover:bg-gray-100 text-gray-700 font-semibold text-sm px-5 py-2 rounded-xl transition-colors border border-gray-200 shadow-sm">
            Edit Profile
          </button>
          {user.bio && <p className="text-sm text-gray-600 mt-5 leading-relaxed italic">"{user.bio}"</p>}
        </div>

        <div className="p-6">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Active Now</h3>
          {activeIds.length === 0 ? (
            <p className="text-sm text-gray-400">No one else is online right now.</p>
          ) : (
            <div className="space-y-3">
              {/* In a real app we'd fetch full details of active users, here we just show what we have in convs if possible, or omit */}
              <p className="text-sm text-gray-500">{activeIds.length} users online on campus</p>
            </div>
          )}
        </div>
      </aside>
    );
  }

  if (isGroup) {
    return (
      <aside className="w-[300px] bg-white border-l border-gray-100 flex flex-col h-full overflow-y-auto flex-shrink-0">
        <div className="p-6 text-center border-b border-gray-100">
          <div className="w-20 h-20 rounded-2xl bg-purple-100 flex items-center justify-center border border-purple-200 mx-auto mb-4 shadow-sm">
            <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900">{selectedConv.title}</h2>
          <p className="text-sm text-gray-500 mt-1">{members.length} members</p>
        </div>

        <div className="p-5 flex-1 overflow-y-auto scrollbar-none">
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Group Members</h3>
          <div className="space-y-2 mb-6">
            {members.map(m => (
              <div key={m.id} className="flex items-center gap-3 bg-gray-50 px-3 py-2 rounded-xl border border-gray-100">
                <Avatar name={m.name} color={m.avatar_color} avatarUrl={m.avatar_url} size="sm" online={onlineUsers.has(m.id)} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {m.name} {m.id === user.id && <span className="text-gray-400 font-normal">(you)</span>} {selectedConv.owner_id === m.id && '👑'}
                  </p>
                  <p className="text-xs text-blue-500">@{m.username}</p>
                </div>
                {isOwner && m.id !== user.id && (
                  <button onClick={() => removeMember(m.id)} className="text-gray-400 hover:text-red-500">✕</button>
                )}
              </div>
            ))}
          </div>

          {isOwner && (
            <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100">
              <h3 className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-2">Add Members</h3>
              <input type="text" placeholder="Search @username..." value={addSearch} onChange={e => setAddSearch(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500" />
              {addResults.length > 0 && (
                <div className="mt-2 bg-white border border-gray-100 rounded-lg shadow-sm max-h-40 overflow-y-auto">
                  {addResults.map(u => (
                    <button key={u.id} onClick={() => addMember(u)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-left">
                      <Avatar name={u.name} color={u.avatar_color} avatarUrl={u.avatar_url} size="xs" />
                      <div><p className="text-xs font-semibold">{u.name}</p></div>
                    </button>
                  ))}
                </div>
              )}
              {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
            </div>
          )}
        </div>

        <div className="p-4 space-y-1 bg-gray-50/50 border-t border-gray-100">
          <button onClick={async () => { await api.muteConversation(selectedConv.id, !selectedConv.is_muted); onUpdated(); }}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-white rounded-xl text-sm font-semibold text-gray-700 transition-colors">
            <div className="flex items-center gap-3"><span className="text-gray-400">🔔</span> Mute</div>
            <div className={`w-9 h-5 rounded-full flex items-center p-0.5 transition-colors ${selectedConv.is_muted ? 'bg-blue-600' : 'bg-gray-200'}`}>
              <div className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform ${selectedConv.is_muted ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
          </button>
          <button onClick={async () => { await api.pinConversation(selectedConv.id, !selectedConv.is_pinned); onUpdated(); }}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-white rounded-xl text-sm font-semibold text-gray-700 transition-colors">
            <div className="flex items-center gap-3"><span className="text-gray-400">📌</span> Pin Chat</div>
            <div className={`w-9 h-5 rounded-full flex items-center p-0.5 transition-colors ${selectedConv.is_pinned ? 'bg-blue-600' : 'bg-gray-200'}`}>
              <div className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform ${selectedConv.is_pinned ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
          </button>
        </div>

        <div className="p-4 border-t border-gray-100 bg-gray-50">
           {!isOwner ? (
              <button onClick={async () => { if (!window.confirm('Leave group?')) return; await api.leaveGroup(selectedConv.id); onUpdated(); }}
                className="w-full bg-white text-red-600 border border-red-200 hover:bg-red-50 py-2.5 rounded-xl font-semibold text-sm transition-colors">
                Leave Group
              </button>
           ) : (
              <button onClick={async () => { if (!window.confirm('Delete group?')) return; await api.deleteGroup(selectedConv.id); onUpdated(); }}
                className="w-full bg-white text-red-600 border border-red-200 hover:bg-red-50 py-2.5 rounded-xl font-semibold text-sm transition-colors">
                Delete Group
              </button>
           )}
        </div>
      </aside>
    );
  }

  // Direct chat
  return (
    <aside className="w-[300px] bg-white border-l border-gray-100 flex flex-col h-full overflow-y-auto flex-shrink-0">
      <div className="p-8 text-center border-b border-gray-100">
        <div className="mb-4 flex justify-center">
          <Avatar name={otherMember?.name} color={otherMember?.avatar_color} avatarUrl={otherMember?.avatar_url} size="xl" online={onlineUsers.has(otherMember?.id)} />
        </div>
        <h2 className="text-xl font-bold text-gray-900">{otherMember?.name}</h2>
        <p className="text-sm font-medium text-blue-500 mb-4">@{otherMember?.username}</p>
        {onlineUsers.has(otherMember?.id) && <span className="inline-block bg-green-100 text-green-700 text-xs font-bold px-3 py-1 rounded-full mb-2">Online</span>}
      </div>

      <div className="p-4 space-y-1 bg-gray-50/50 flex-1">
        <button onClick={async () => { await api.muteConversation(selectedConv.id, !selectedConv.is_muted); onUpdated(); }}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-white rounded-xl text-sm font-semibold text-gray-700 transition-colors">
          <div className="flex items-center gap-3"><span className="text-gray-400">🔔</span> Mute</div>
          <div className={`w-9 h-5 rounded-full flex items-center p-0.5 transition-colors ${selectedConv.is_muted ? 'bg-blue-600' : 'bg-gray-200'}`}>
            <div className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform ${selectedConv.is_muted ? 'translate-x-4' : 'translate-x-0'}`} />
          </div>
        </button>
        <button onClick={async () => { await api.pinConversation(selectedConv.id, !selectedConv.is_pinned); onUpdated(); }}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-white rounded-xl text-sm font-semibold text-gray-700 transition-colors">
          <div className="flex items-center gap-3"><span className="text-gray-400">📌</span> Pin Chat</div>
          <div className={`w-9 h-5 rounded-full flex items-center p-0.5 transition-colors ${selectedConv.is_pinned ? 'bg-blue-600' : 'bg-gray-200'}`}>
            <div className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform ${selectedConv.is_pinned ? 'translate-x-4' : 'translate-x-0'}`} />
          </div>
        </button>
        <button onClick={async () => { if(window.confirm('Block this user?')) { await api.blockUser(selectedConv.id); onUpdated(); } }}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-white rounded-xl text-sm font-semibold text-red-600 transition-colors mt-4">
          <div className="flex items-center gap-3"><span>🚫</span> Block</div>
        </button>
      </div>
    </aside>
  );
}

// ── Left Nav ──────────────────────────────────────────────────
function AppNav({ user, onNav, activeNav, onProfileClick }) {
  const navItems = [
    { id: 'chats', icon: '💬', label: 'Chats' },
    { id: 'groups', icon: '➕', label: 'New Group' },
  ];

  return (
    <nav className="w-20 md:w-[240px] bg-white border-r border-gray-100 flex flex-col h-full overflow-hidden flex-shrink-0">
      <div className="p-5 flex items-center justify-center md:justify-start gap-3">
        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white flex-shrink-0 shadow-sm">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
        </div>
        <span className="hidden md:block font-bold text-gray-900 text-xl tracking-tight">Campus<span className="text-blue-600">Connect</span></span>
      </div>

      <div className="flex-1 px-3 mt-4 space-y-2">
        {navItems.map(item => (
          <button key={item.id} onClick={() => onNav(item.id)}
            className={`w-full flex items-center justify-center md:justify-start px-4 py-3 rounded-2xl transition-all ${activeNav === item.id ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}>
            <span className="text-xl md:text-lg md:mr-3">{item.icon}</span>
            <span className="hidden md:block text-sm font-bold">{item.label}</span>
          </button>
        ))}
      </div>

      <div className="p-4 border-t border-gray-100">
        <button onClick={onProfileClick} className="w-full flex items-center justify-center md:justify-start gap-3 hover:opacity-80 transition-opacity p-2 rounded-xl hover:bg-gray-50">
          <Avatar name={user.name} color={user.avatar_color} avatarUrl={user.avatar_url} size="sm" online={true} />
          <div className="hidden md:block text-left min-w-0 flex-1">
            <p className="text-sm font-bold text-gray-900 truncate">{user.name}</p>
            <p className="text-xs text-blue-500 font-medium truncate">@{user.username}</p>
          </div>
        </button>
      </div>
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────
export default function ChatPage() {
  const { user, logout, updateUser } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [requests, setRequests] = useState([]);
  const [selectedConv, setSelectedConv] = useState(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [unread, setUnread] = useState({});
  const [connected, setConnected] = useState(socket.connected);
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [filter, setFilter] = useState('All'); // All, Direct, Groups
  
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showProfile, setShowProfile] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [activeNav, setActiveNav] = useState('chats');
  const [showRightSidebar, setShowRightSidebar] = useState(true);

  const selectedConvRef = useRef(null);
  const conversationsRef = useRef([]);
  const searchInputRef = useRef(null);
  useEffect(() => { selectedConvRef.current = selectedConv; }, [selectedConv]);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);

  // Load data
  const loadConversations = useCallback(async () => {
    try {
      const { conversations: convs } = await api.getConversations();
      setConversations(convs);
      const initialUnread = {};
      convs.forEach((c) => { if (c.unread_count > 0) initialUnread[c.id] = c.unread_count; });
      setUnread(initialUnread);
    } catch (err) { console.error(err); }
  }, []);

  const loadRequests = useCallback(async () => {
    try {
      const { conversations: reqs } = await api.getRequests();
      setRequests(reqs.map(r => ({ ...r, isRequest: true })));
    } catch (err) { console.error(err); }
  }, []);

  useEffect(() => { loadConversations(); loadRequests(); }, []);

  const handleAcceptRequest = async (cid) => {
    try {
      await api.acceptRequest(cid);
      setFilter('All');
      setSelectedConv(null);
      loadConversations();
      loadRequests();
    } catch(err) { console.error(err); }
  };

  const handleBlockRequest = async (cid) => {
    try {
      await api.blockRequest(cid);
      setFilter('All');
      setSelectedConv(null);
      loadConversations();
      loadRequests();
    } catch(err) { console.error(err); }
  };

  // Search logic
  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); return; }
    setSearching(true);
    const t = setTimeout(() => {
      api.searchUsers(search).then(({ users }) => setSearchResults(users.filter(u => u.id !== user.id)))
        .catch(console.error).finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [search, user.id]);

  // Toasts
  const dismissToast = useCallback((id) => setToasts(prev => prev.filter(t => t.id !== id)), []);
  const addToast = useCallback((toast) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev.slice(-3), { ...toast, id }]);
    setTimeout(() => dismissToast(id), 5000);
  }, [dismissToast]);

  // Socket
  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onPresence = ({ userId, online }) => {
      setOnlineUsers(prev => {
        const next = new Set(prev);
        if (online) next.add(userId); else next.delete(userId);
        return next;
      });
    };
    const onPresenceSnapshot = ({ onlineUsers: usersList }) => setOnlineUsers(new Set(usersList));

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('presence:update', onPresence);
    socket.on('presence:snapshot', onPresenceSnapshot);

    socket.on('notification:new', (notif) => {
      loadRequests();
      const c = conversationsRef.current.find(x => x.id === notif.conversationId);
      if (c && c.is_muted) return;
      addToast({ senderName: notif.senderName, content: notif.content, isRequest: true, conversationId: notif.conversationId, color: '#F59E0B' });
    });
    
    socket.on('mention:new', (notif) => {
      if (selectedConvRef.current?.id === notif.conversationId) return;
      const c = conversationsRef.current.find(x => x.id === notif.conversationId);
      if (c && c.is_muted) return;
      addToast({ senderName: notif.mentionedBy, content: `Mentioned you: ${notif.preview}`, conversationId: notif.conversationId, color: '#3B82F6' });
    });

    socket.on('conversation:new', () => { loadConversations(); loadRequests(); });
    socket.on('conversation:deleted', (data) => {
      if (selectedConvRef.current?.id === data.conversationId) setSelectedConv(null);
      loadConversations();
    });
    socket.on('conversation:updated', () => loadConversations());

    if (socket.connected) { onConnect(); socket.emit('presence:request_snapshot'); }
    else socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('presence:update', onPresence);
      socket.off('presence:snapshot', onPresenceSnapshot);
      socket.off('notification:new');
      socket.off('mention:new');
      socket.off('conversation:new');
      socket.off('conversation:deleted');
      socket.off('conversation:updated');
    };
  }, []);

  // Message sync
  useEffect(() => {
    const onMessageNew = (msg) => {
      setConversations(prev => {
        const copy = [...prev];
        const idx = copy.findIndex(c => c.id === msg.conversation_id);
        if (idx !== -1) {
          const c = { ...copy[idx] };
          c.last_message = msg.content || '📎 Attachment';
          c.last_message_at = msg.created_at;
          copy[idx] = c;
          
          copy.sort((a, b) => {
            if (a.is_pinned !== b.is_pinned) return b.is_pinned ? 1 : -1;
            const tA = a.last_message_at || a.created_at;
            const tB = b.last_message_at || b.created_at;
            return tB.localeCompare(tA);
          });
        }
        return copy;
      });
      if (selectedConvRef.current?.id !== msg.conversation_id && msg.sender_id !== user.id) {
        setUnread(p => ({ ...p, [msg.conversation_id]: (p[msg.conversation_id] || 0) + 1 }));
      }
    };
    socket.on('message:new', onMessageNew);
    return () => socket.off('message:new', onMessageNew);
  }, [user.id]);

  const selectConv = (conv) => {
    setSelectedConv(conv);
    if (unread[conv.id]) setUnread(p => ({ ...p, [conv.id]: 0 }));
    setSearch(''); // clear search on select
  };

  const getConvDisplayName = (conv) => {
    if (conv.type === 'DIRECT') {
      const other = conv.members?.find(m => m.id !== user.id);
      return other?.name || 'Unknown User';
    }
    return conv.title || 'Group';
  };

  const openDirectChat = async (otherUser) => {
    const existing = conversations.find(c => c.type === 'DIRECT' && c.members?.some(m => m.id === otherUser.id));
    if (existing) { selectConv(existing); return; }
    try {
      const { conversation } = await api.createDirect(otherUser.id);
      setConversations(p => [conversation, ...p]);
      selectConv(conversation);
    } catch (err) { alert(err.message); }
  };

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="flex h-screen bg-gray-50 font-sans text-gray-900 overflow-hidden relative">
      {/* Modals & Overlays */}
      {showCreateGroup && <CreateGroupModal onClose={() => setShowCreateGroup(false)} onCreated={c => { loadConversations(); selectConv(c); }} currentUserId={user.id} />}
      {showProfile && <ProfilePanel userId={showProfile} currentUserId={user.id} isOnline={onlineUsers.has(showProfile)} onClose={() => setShowProfile(null)} onProfileUpdated={updateUser} />}

      {/* Toasts */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(toast => (
          <div key={toast.id} className="pointer-events-auto">
            <Toast toast={toast} onClose={() => dismissToast(toast.id)} onClick={() => {
              dismissToast(toast.id);
              const conv = [...conversations, ...requests].find(c => c.id === toast.conversationId);
              if (conv) selectConv(conv);
            }} />
          </div>
        ))}
      </div>

      <AppNav user={user} activeNav={activeNav} onNav={(id) => { 
        if (id === 'groups') {
          setShowCreateGroup(true); 
        } else {
          setActiveNav(id);
          setSelectedConv(null);
        }
      }} onProfileClick={() => setShowProfile(user.id)} />

      {/* Inner Sidebar (Chat List) */}
      <div className="flex flex-col w-[340px] bg-white border-r border-gray-100 flex-shrink-0">
        <div className="p-5 pb-3">
          <div className="flex items-center justify-between mb-4">
             <h2 className="text-xl font-extrabold text-gray-900 tracking-tight">Messages</h2>
          </div>
          <div className="relative">
            <svg className="absolute left-3.5 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input ref={searchInputRef} type="text" placeholder="Search people or groups..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full bg-gray-100 border-none rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium placeholder-gray-500" />
          </div>
        </div>

        {/* Global Search Results */}
        {search.trim() ? (
          <div className="flex-1 overflow-y-auto px-3 pb-4">
            <p className="px-3 py-2 text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Global Search</p>
            {searching ? <p className="px-3 py-2 text-sm text-gray-400 font-medium">Searching...</p> : 
             searchResults.length === 0 ? <p className="px-3 py-2 text-sm text-gray-400 font-medium">No results found.</p> :
             searchResults.map(u => (
               <button key={u.id} onClick={() => openDirectChat(u)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-gray-50 transition-colors text-left group">
                 <Avatar name={u.name} color={u.avatar_color} avatarUrl={u.avatar_url} size="sm" online={onlineUsers.has(u.id)} />
                 <div className="flex-1 min-w-0"><p className="text-sm font-bold text-gray-900 truncate">{u.name}</p><p className="text-xs text-blue-500 font-medium">@{u.username}</p></div>
               </button>
             ))}
          </div>
        ) : (
          <>
            <div className="px-5 mb-3 flex items-center gap-2">
              {['All', 'Direct', 'Groups'].map(t => (
                <button key={t} onClick={() => setFilter(t)}
                  className={`px-4 py-1.5 text-xs font-bold rounded-full transition-all border ${filter === t ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}>
                  {t}
                </button>
              ))}
            </div>

            {requests.length > 0 && filter === 'All' && (
              <div className="px-3 mb-2">
                <button onClick={() => setFilter('Requests')} className="w-full bg-yellow-50 hover:bg-yellow-100 border border-yellow-100 rounded-2xl px-4 py-3 flex items-center justify-between text-left transition-colors">
                  <div>
                    <p className="text-sm font-bold text-yellow-800">Message Requests</p>
                    <p className="text-xs font-medium text-yellow-600 mt-0.5">{requests.length} pending</p>
                  </div>
                  <span className="w-6 h-6 bg-yellow-200 text-yellow-800 font-bold text-xs rounded-full flex items-center justify-center">!</span>
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-3 space-y-0.5 pb-4 scrollbar-none">
              {(filter === 'Requests' ? requests : conversations.filter(c => filter === 'All' ? true : filter === 'Direct' ? c.type === 'DIRECT' : c.type === 'GROUP')).map(conv => {
                const isGroup = conv.type === 'GROUP';
                const other = !isGroup ? conv.members?.find(m => m.id !== user.id) : null;
                const name = getConvDisplayName(conv);
                const isSelected = selectedConv?.id === conv.id;
                const badge = unread[conv.id] || 0;
                const isOnline = other && onlineUsers.has(other.id);
                const time = new Date(conv.last_message_at || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                return (
                  <button key={conv.id} onClick={() => selectConv(conv)}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-2xl transition-all text-left ${isSelected ? 'bg-blue-50/60 shadow-sm shadow-blue-100/50' : 'hover:bg-gray-50'}`}>
                    {isGroup ? (
                       <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0 shadow-inner">
                         <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                       </div>
                    ) : (
                       <Avatar name={name} color={other?.avatar_color} avatarUrl={other?.avatar_url} size="lg" online={isOnline} />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-1.5 truncate pr-2">
                          <p className="text-[15px] font-bold text-gray-900 truncate">{name}</p>
                          {conv.is_pinned === 1 && <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M16 11V5.5C16 4.67157 15.3284 4 14.5 4H9.5C8.67157 4 8 4.67157 8 5.5V11L6 14.5V16H11V21H13V16H18V14.5L16 11Z" /></svg>}
                          {conv.is_muted === 1 && <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M19.7439 15.3934L17.9179 13.5673C18.5996 12.3551 18.9999 10.9576 18.9999 9.5C18.9999 5.35786 15.642 2 11.4999 2C10.0423 2 8.64483 2.40033 7.43265 3.08204L5.6066 1.25598L4.19238 2.6702L20.1581 18.6359L21.5723 17.2217L19.7439 15.3934ZM9.68961 5.33894C10.2678 5.12061 10.8741 4 11.4999 4C14.5375 4 16.9999 6.46243 16.9999 9.5C16.9999 10.1258 16.8793 10.7321 16.661 11.3103L9.68961 4.33894ZM2.8988 6.43442L4.35728 7.8929C4.1257 8.40698 3.9999 8.9431 3.9999 9.5V15L1.9999 17V18H14.4644L15.4644 19H12.9999V22H9.9999V19H2.8988V18L4.8988 16V9.5C4.8988 8.35824 5.25368 7.30137 5.86438 6.43442ZM11.4999 14.8929L5.80735 9.20038C5.58913 9.77857 5.4999 10.3849 5.4999 11V15L3.4999 17H13.607L11.4999 14.8929Z" /></svg>}
                        </div>
                        <span className={`text-[10px] font-bold flex-shrink-0 ${badge ? 'text-blue-600' : 'text-gray-400'}`}>{time}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className={`text-[13px] truncate pr-2 ${badge ? 'font-semibold text-gray-900' : 'font-medium text-gray-500'}`}>{conv.last_message_at ? (conv.last_message || 'Sent an attachment') : 'Start conversation...'}</p>
                        {badge > 0 && <span className="min-w-[1.25rem] h-5 bg-blue-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 flex-shrink-0 shadow-sm shadow-blue-200">{badge}</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Main Area ──────────────────────────────────────────────── */}
      <main className="flex-1 flex overflow-hidden">
        {selectedConv ? (
          <>
            <ChatWindow conversation={selectedConv} currentUser={user} onlineUsers={onlineUsers} onNewMessage={(cid, msg) => {}} onConversationUpdated={loadConversations} onToggleSidebar={() => setShowRightSidebar(s => !s)} isSidebarOpen={showRightSidebar} onAccept={handleAcceptRequest} onBlock={handleBlockRequest} />
            {showRightSidebar && <RightSidebar user={user} selectedConv={selectedConv} onlineUsers={onlineUsers} onEditProfile={() => setShowProfile(user.id)} onUpdated={() => { setSelectedConv(null); loadConversations(); }} />}
          </>
        ) : (
          <>
            <div className="flex-1 flex flex-col items-center justify-center px-8 relative bg-gray-50/50">
              <div className="max-w-xl w-full text-center relative z-10">
                <div className="w-24 h-24 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
                  <svg className="w-10 h-10 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                </div>
                <h2 className="text-2xl font-extrabold text-gray-900 mb-2">Welcome to CampusConnect</h2>
                <p className="text-gray-500 mb-10 font-medium text-sm leading-relaxed">Select a conversation from the left, search for a classmate,<br/>or start a new group to begin chatting.</p>

                <div className="flex gap-4 justify-center">
                  <button onClick={() => setShowCreateGroup(true)} className="bg-white border border-gray-200 hover:border-blue-300 hover:bg-blue-50 hover:shadow-md transition-all px-6 py-4 rounded-2xl flex flex-col items-center gap-3 group min-w-[140px]">
                    <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg></div>
                    <span className="text-sm font-bold text-gray-900">New Group</span>
                  </button>
                  <button onClick={() => searchInputRef.current?.focus()} className="bg-white border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 hover:shadow-md transition-all px-6 py-4 rounded-2xl flex flex-col items-center gap-3 group min-w-[140px]">
                    <div className="w-12 h-12 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center group-hover:scale-110 transition-transform"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg></div>
                    <span className="text-sm font-bold text-gray-900">Find Friends</span>
                  </button>
                </div>
              </div>
            </div>
            {showRightSidebar && <RightSidebar user={user} selectedConv={null} onlineUsers={onlineUsers} onEditProfile={() => setShowProfile(user.id)} />}
          </>
        )}
      </main>

      <div className="absolute top-4 right-4 flex gap-2 z-50">
         <button onClick={() => setShowRightSidebar(s => !s)} className={`w-10 h-10 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm transition-colors ${showRightSidebar ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:text-gray-600'}`} title="Toggle Sidebar">
           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
             <rect x="3" y="3" width="18" height="18" rx="2" ry="2" strokeWidth={2} />
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 3v18" />
             {showRightSidebar && <rect x="15" y="3" width="6" height="18" fill="currentColor" rx="2" />}
           </svg>
         </button>
         <button onClick={logout} className="w-10 h-10 bg-white border border-gray-200 rounded-full flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 shadow-sm transition-colors" title="Logout">
           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
         </button>
      </div>
    </div>
  );
}
