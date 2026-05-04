import { state } from './app.js';

export async function getCurrentUserProfile() {
  if (!state.currentUser) return null;
  if (state.supabase) {
    try {
      const { data, error } = await state.supabase.from('profiles').select('*').eq('id', state.currentUser.id).single();
      if (error) { console.error('Error fetching user:', error); return null; }
      return data;
    } catch (err) {
      console.error('Error getting user profile:', err); return null;
    }
  }
  return state.currentUser;
}

export function addProfileToMenuBar() {
  const avatarImg = document.getElementById('profileNavAvatar');
  if (avatarImg) {
    if (state.currentUser && state.profileRecord?.avatar_url) {
      avatarImg.src = state.profileRecord.avatar_url;
    } else {
      avatarImg.src = './profile_avatar.png';
    }
  }
}
