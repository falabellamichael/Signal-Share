/**
 * Signal Share Arcade API
 * Handles persistent storage of game stats and leaderboard data via Supabase.
 */

import { createSupabaseClient } from './api-v3.js';

let supabase = null;

/**
 * Initialize the Arcade API with the main app state/config
 * @param {object} state - The main application state containing supabase client
 */
export function initArcadeApi(state) {
    supabase = state.supabase;
}
window.initArcadeApi = initArcadeApi;

/**
 * Save a game score and rank to Supabase
 * @param {string} gameId - Unique identifier for the game (e.g., 'pinball')
 * @param {number} score - The score achieved
 * @param {string} rank - The rank achieved (e.g., 'LEGENDARY')
 * @param {object} metadata - Optional additional data
 */
export async function saveGameScore(gameId, score, rank = "", metadata = {}) {
    if (!supabase) {
        console.error('[Arcade API] Supabase client not initialized');
        return null;
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
        console.warn('[Arcade API] User not logged in, score will not be saved to profile');
        return null;
    }

    const payload = {
        user_id: user.id,
        game_id: gameId,
        score: Math.round(score),
        rank: rank,
        metadata: metadata
    };

    const { data, error } = await supabase
        .from('game_stats')
        .upsert(payload, { 
            onConflict: 'user_id,game_id',
            ignoreDuplicates: false 
        })
        .select();

    if (error) {
        console.error('[Arcade API] Error saving score:', error.message || error);
        throw error;
    }

    const savedRecord = data && data.length > 0 ? data[0] : null;
    console.log('[Arcade API] Score/Rank saved successfully:', savedRecord);
    return savedRecord;
}
window.saveGameScore = saveGameScore;

/**
 * Load global leaderboard for a specific game
 * @param {string} gameId - The game to load stats for
 * @param {number} limit - Maximum number of entries
 */
export async function getLeaderboard(gameId, limit = 10) {
    if (!supabase) return [];

    // Join with profiles to get display names
    const { data, error } = await supabase
        .from('game_stats')
        .select(`
            id,
            score,
            created_at,
            metadata,
            user_id,
            profiles!game_stats_user_id_profiles_fkey (
                display_name,
                id
            )
        `)
        .eq('game_id', gameId)
        .order('score', { ascending: false })
        .limit(limit);

    if (error) {
        console.error('[Arcade API] Error fetching leaderboard:', error);
        return [];
    }

    return data.map(row => {
        // Disambiguate profile data which might come as an object or array depending on relationship hints
        const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        return {
            id: row.id,
            score: row.score,
            createdAt: row.created_at,
            metadata: row.metadata,
            displayName: profile?.display_name || 'Anonymous Player',
            userId: row.user_id
        };
    });
}
window.getLeaderboard = getLeaderboard;

/**
 * Load personal bests for the current user
 * @param {string} gameId - Optional filter by game
 */
export async function getPersonalBest(gameId = null) {
    if (!supabase) return null;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    let query = supabase
        .from('game_stats')
        .select('*')
        .eq('user_id', user.id)
        .order('score', { ascending: false });

    if (gameId) {
        query = query.eq('game_id', gameId);
    }

    const { data, error } = await query.maybeSingle();

    if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows returned"
        console.error('[Arcade API] Error fetching personal best:', error);
        return null;
    }

    return data;
}
window.getPersonalBest = getPersonalBest;
