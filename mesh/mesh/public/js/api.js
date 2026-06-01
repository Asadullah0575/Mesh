// public/js/api.js

const BASE = '/api';
const token = () => localStorage.getItem('sq_token');

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Auth
export async function apiSignUp(email, password) {
  const d = await req('/auth?action=signup', { method: 'POST', body: { email, password } });
  localStorage.setItem('sq_token', d.token); localStorage.setItem('sq_user', JSON.stringify(d.user)); return d.user;
}
export async function apiSignIn(email, password) {
  const d = await req('/auth?action=signin', { method: 'POST', body: { email, password } });
  localStorage.setItem('sq_token', d.token); localStorage.setItem('sq_user', JSON.stringify(d.user)); return d.user;
}
export async function apiForgotPassword(email) {
  return req('/auth?action=forgot', { method: 'POST', body: { email } });
}
export async function apiResetPassword(token, password) {
  return req('/auth?action=reset', { method: 'POST', body: { token, password } });
}
export function apiSignOut() { localStorage.removeItem('sq_token'); localStorage.removeItem('sq_user'); }
export function getCurrentUser() { try { return JSON.parse(localStorage.getItem('sq_user')); } catch { return null; } }

// Profiles
export async function apiGetProfiles() { return (await req('/profiles')).profiles; }
export async function apiPostProfile(p) { return (await req('/profiles', { method: 'POST', body: p })).profile; }
export async function apiEditProfile(id, p) { return (await req(`/profiles?id=${id}`, { method: 'PUT', body: p })).profile; }
export async function apiDeleteProfile(id) { await req(`/profiles?id=${id}`, { method: 'DELETE' }); }

// Upload
export async function apiUploadAvatar(image) { return (await req('/upload', { method: 'POST', body: { image } })).url; }

// Invites
export async function apiGetSentInvites() { return (await req('/invites')).invites; }
export async function apiGetReceivedInvites() { return (await req('/invites?type=inbox')).invites; }
export async function apiSendInvite(toProfileId) { await req('/invites', { method: 'POST', body: { toProfileId } }); }
export async function apiRespondInvite(id, action) { return req(`/invites?id=${id}&action=${action}`, { method: 'PUT' }); }

// Teams
export async function apiGetTeams() { return (await req('/teams')).teams; }

// Messages
export async function apiGetMessages(teamId, after = null) {
  const q = after ? `&after=${encodeURIComponent(after)}` : '';
  return (await req(`/messages?teamId=${teamId}${q}`)).messages;
}
export async function apiSendMessage(teamId, body) { return (await req('/messages', { method: 'POST', body: { teamId, body } })).message; }

// Groups
export async function apiGetGroups() { return (await req('/groups')).groups; }
export async function apiCreateGroup(name, memberUserIds) { return (await req('/groups', { method: 'POST', body: { name, memberUserIds } })).group; }
export async function apiGetGroupMessages(groupId, after=null) {
  const q = after ? `&after=${encodeURIComponent(after)}` : '';
  return req(`/groups?id=${groupId}&msgs=1${q}`);
}
export async function apiSendGroupMessage(groupId, body, fileBase64=null, fileName=null) {
  return (await req(`/groups?id=${groupId}&msg=1`, { method: 'POST', body: { body, fileBase64, fileName } })).message;
}
export async function apiDeleteGroupMessage(groupId, messageId) { return req(`/groups?id=${groupId}&deleteMsg=${messageId}`, { method: 'DELETE' }); }
export async function apiAddGroupMember(groupId, userIdToAdd) { return req(`/groups?id=${groupId}&add=1`, { method: 'POST', body: { userIdToAdd } }); }
export async function apiRemoveGroupMember(groupId, userId) { return req(`/groups?id=${groupId}&remove=${userId}`, { method: 'DELETE' }); }
export async function apiLeaveGroup(groupId) { return req(`/groups?id=${groupId}&leave=1`, { method: 'DELETE' }); }

// Draft
export async function apiGetDraft(teamId) { return (await req(`/draft?teamId=${teamId}`)).draft; }
export async function apiSaveDraft(teamId, content) { return req(`/draft?teamId=${teamId}`, { method: 'PUT', body: { content } }); }