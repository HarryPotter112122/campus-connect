const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  // Auth
  register: (name, username, email, password) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify({ name, username, email, password }) }),
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),

  // Users
  searchUsers: (search) => request(`/users?search=${encodeURIComponent(search)}`),
  getProfile: (userId) => request(`/users/${userId}`),
  updateProfile: (data) => request('/users/profile', { method: 'PUT', body: JSON.stringify(data) }),

  // Conversations
  getConversations: () => request('/conversations'),
  getRequests: () => request('/conversations/requests'),
  createDirect: (targetUserId) =>
    request('/conversations/direct', { method: 'POST', body: JSON.stringify({ targetUserId }) }),
  createGroup: (name, memberIds) =>
    request('/conversations/group', { method: 'POST', body: JSON.stringify({ name, memberIds }) }),
  addGroupMember: (conversationId, userId) =>
    request(`/conversations/${conversationId}/members`, { method: 'POST', body: JSON.stringify({ userId }) }),
  removeGroupMember: (conversationId, userId) =>
    request(`/conversations/${conversationId}/members/${userId}`, { method: 'DELETE' }),
  transferOwnership: (conversationId, userId) =>
    request(`/conversations/${conversationId}/transfer-owner`, { method: 'POST', body: JSON.stringify({ userId }) }),
  leaveGroup: (conversationId) =>
    request(`/conversations/${conversationId}/leave`, { method: 'POST' }),
  deleteGroup: (conversationId) =>
    request(`/conversations/${conversationId}`, { method: 'DELETE' }),
  renameGroup: (conversationId, name) =>
    request(`/conversations/${conversationId}/rename`, { method: 'PUT', body: JSON.stringify({ name }) }),
  muteConversation: (conversationId, value) =>
    request(`/conversations/${conversationId}/mute`, { method: 'PUT', body: JSON.stringify({ value }) }),
  pinConversation: (conversationId, value) =>
    request(`/conversations/${conversationId}/pin`, { method: 'PUT', body: JSON.stringify({ value }) }),
  blockUser: (conversationId) =>
    request(`/conversations/${conversationId}/block`, { method: 'POST' }),
  getMessages: (conversationId, cursor) =>
    request(`/conversations/${conversationId}/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
  acceptRequest: (conversationId) =>
    request(`/conversations/${conversationId}/accept`, { method: 'POST' }),
  blockRequest: (conversationId) =>
    request(`/conversations/${conversationId}/block`, { method: 'POST' }),
  markRead: (conversationId, lastMessageId) =>
    request(`/conversations/${conversationId}/read`, {
      method: 'POST',
      body: JSON.stringify({ lastMessageId }),
    }),

  // AI Summary
  getSummary: (conversationId, limit = 50) =>
    request(`/conversations/${conversationId}/summary`, {
      method: 'POST',
      body: JSON.stringify({ limit }),
    }),
};
