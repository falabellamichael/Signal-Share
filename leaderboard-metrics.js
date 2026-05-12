/**
 * Signal Share Sophisticated Leaderboard Metrics
 * Comprehensive dictionary of telemetry keys and their premium display formats.
 */

const LEADERBOARD_METRICS = {
    // === CORE USER STATS ===
    'xp': { label: 'EXPERIENCE LEVEL', unit: 'XP', category: 'CORE' },
    'score': { label: 'TOTAL POINTS', unit: 'PTS', category: 'CORE' },
    'points-weekly': { label: 'WEEKLY MOMENTUM', unit: 'PTS', category: 'CORE' },
    'rank-all-time': { label: 'ALL-TIME RANK', unit: '#', category: 'CORE' },
    'streak': { label: 'CURRENT STREAK', unit: 'DAYS', category: 'CORE' },
    'streak-best': { label: 'LONGEST STREAK', unit: 'DAYS', category: 'CORE' },
    'age': { label: 'ACCOUNT AGE', unit: 'DAYS', category: 'CORE' },
    'sessions': { label: 'TOTAL SESSIONS', unit: 'PLAYS', category: 'CORE' },
    'session-time-avg': { label: 'AVG SESSION', unit: 'MIN', category: 'CORE' },
    'verified': { label: 'VERIFIED STATUS', unit: '', category: 'CORE' },
    'reputation': { label: 'REPUTATION SCORE', unit: 'REP', category: 'CORE' },

    // === CREATOR & POSTING STATS ===
    'posts-total': { label: 'CONTENT CREATED', unit: 'POSTS', category: 'CREATOR' },
    'posts-weekly': { label: 'WEEKLY UPLOADS', unit: 'POSTS', category: 'CREATOR' },
    'post-streak': { label: 'POSTING STREAK', unit: 'DAYS', category: 'CREATOR' },
    'most-used-type': { label: 'PRIMARY MEDIUM', unit: '', category: 'CREATOR' },
    'youtube-shares': { label: 'YOUTUBE CURATED', unit: 'LINKS', category: 'CREATOR' },
    'spotify-shares': { label: 'SPOTIFY CURATED', unit: 'TRACKS', category: 'CREATOR' },

    // === ENGAGEMENT & REACTIONS ===
    'likes-received': { label: 'TOTAL APPRECIATION', unit: 'LIKES', category: 'SOCIAL' },
    'likes-today': { label: 'DAILY LIKES', unit: 'LIKES', category: 'SOCIAL' },
    'like-ratio': { label: 'ENGAGEMENT RATIO', unit: '%', category: 'SOCIAL' },
    'comments-total': { label: 'COMMUNITY FEEDBACK', unit: 'CMTS', category: 'SOCIAL' },
    'shares-total': { label: 'COMMUNITY REACH', unit: 'SHARES', category: 'SOCIAL' },
    'saves-total': { label: 'COLLECTION ADDS', unit: 'SAVES', category: 'SOCIAL' },

    // === VIEWS & RETENTION ===
    'views-total': { label: 'TOTAL IMPRESSIONS', unit: 'VIEWS', category: 'VIEWS' },
    'unique-views': { label: 'UNIQUE AUDIENCE', unit: 'USERS', category: 'VIEWS' },
    'watch-time': { label: 'TOTAL WATCH TIME', unit: 'MIN', category: 'VIEWS' },
    'completion-rate': { label: 'RETENTION RATE', unit: '%', category: 'VIEWS' },
    'replay-count': { label: 'REPLAY VELOCITY', unit: 'PLAYS', category: 'VIEWS' },

    // === PERFORMANCE & DISCOVERY ===
    'search-hits': { label: 'SEARCH VISIBILITY', unit: 'HITS', category: 'DISCOVERY' },
    'trending-rank': { label: 'TRENDING RANK', unit: '#', category: 'DISCOVERY' },
    'discovery-score': { label: 'DISCOVERABILITY', unit: 'PTS', category: 'DISCOVERY' },
    'momentum': { label: 'GROWTH MOMENTUM', unit: 'MOM', category: 'DISCOVERY' },

    // === GAME SPECIFIC ===
    'food': { label: 'TOTAL FOOD CONSUMED', unit: 'QTY', category: 'GAME' },
    'hoops': { label: 'TOTAL BASKETS', unit: 'HITS', category: 'GAME' },
    'balls': { label: 'BALLS PLAYED', unit: 'QTY', category: 'GAME' },
    'wins': { label: 'MATCHES WON', unit: 'WINS', category: 'GAME' },
    'enemies': { label: 'FOES DEFEATED', unit: 'KILLS', category: 'GAME' },
    'bosses': { label: 'BOSSES CONQUERED', unit: 'BOSSES', category: 'GAME' },
    'damage': { label: 'DAMAGE DEALT', unit: 'DMG', category: 'GAME' },
    'coins': { label: 'CURRENCY EARNED', unit: 'COINS', category: 'GAME' },
    'waves': { label: 'HIGHEST WAVE', unit: 'WAVE', category: 'GAME' },

    // === ACHIEVEMENT & BADGES ===
    'achievements': { label: 'MEDALS EARNED', unit: 'QTY', category: 'PROGRESS' },
    'level-max': { label: 'MAX LEVEL', unit: 'LVL', category: 'PROGRESS' },
    'trophies': { label: 'SEASONAL TROPHIES', unit: 'QTY', category: 'PROGRESS' }
};

/**
 * Smart Discovery Logic for metrics
 */
const LEADERBOARD_ENGINE = {
    getMetric(key) {
        const lowerKey = key.toLowerCase();
        // Try exact match first
        if (LEADERBOARD_METRICS[lowerKey]) return LEADERBOARD_METRICS[lowerKey];
        
        // Try fuzzy keyword match
        for (const [k, info] of Object.entries(LEADERBOARD_METRICS)) {
            if (lowerKey.includes(k) || k.includes(lowerKey)) return info;
        }
        return null;
    },

    formatLabel(key, gameId) {
        const info = this.getMetric(key);
        if (info) return info.label;
        
        // Fallback formatting
        return key.replace(gameId + '-', '').replace(/-/g, ' ').toUpperCase() || 'RECORD';
    },

    getUnit(key) {
        const info = this.getMetric(key);
        return info ? info.unit : '';
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LEADERBOARD_METRICS, LEADERBOARD_ENGINE };
}
