
import { createHeroMediaPlayerController } from '../android/app/src/main/assets/public/hero-media-player.js';

const mockOptions = {
  state: { currentUser: { id: 'test' } },
  elements: {
    heroPlayerHeader: {}, heroPlayerTitle: {}, heroPlayerCaption: {}, heroPlayerStatus: {},
    heroPlayerStage: { contains: () => true }, heroPlayerPlayPauseButton: { addEventListener: () => {} },
    heroPlayerOpenMediaButton: { addEventListener: () => {} }, heroPlayerPrevButton: { addEventListener: () => {} },
    heroPlayerNextButton: { addEventListener: () => {} }, heroPlayerVolumeSlider: { addEventListener: () => {} },
    heroPlayerVolumeValue: {}, heroPlayerOpenPhoneButton: { addEventListener: () => {} }
  },
  getControllablePlayerPost: () => null,
  getActivePlayerMediaElement: () => null,
  getPlayableVisiblePostIds: () => [],
  getAllPosts: () => [],
  getPostById: () => null,
  getProfileSummaryForPost: () => null,
  formatKind: () => '',
  getSignalLabel: () => '',
  formatTimestamp: () => '',
  normalizePlayerVolume: () => 0,
  savePlayerVolume: () => {},
  applyPlayerVolumeToActiveElement: () => {},
  stepMiniPlayer: () => {},
  renderMiniPlayer: () => {},
  postMessageToYouTubePlayer: () => {},
  getSpotifyPreviewImageUrl: () => '',
  getExternalPreviewMetadata: () => {},
  parseYouTubeUrl: () => null,
  resolveActivePlayerSource: () => '',
  getHeroPost: () => null,
  setHeroPost: () => {},
  playHeroMedia: () => {},
  stepHeroPlayer: () => {},
  getHeroPlayablePosts: () => [],
  resolveYouTubePreviewId: () => '',
  isNativeCapacitorApp: () => false,
  getCapacitorPlatform: () => 'web',
  openViewer: () => {},
  onStatusChange: () => {}
};

// Mock document and navigator for Node environment
global.document = {
  getElementById: () => ({ addEventListener: () => {} }),
  addEventListener: () => {},
  hidden: false
};
global.window = {
  setInterval: setInterval,
  clearInterval: clearInterval,
  setTimeout: setTimeout,
  localStorage: {
    getItem: () => null,
    setItem: () => {}
  },
  location: { href: 'http://localhost' }
};
global.navigator = { userAgent: 'node' };
global.HTMLElement = class {};
global.HTMLMediaElement = class {};
global.HTMLIFrameElement = class {};

try {
  const controller = createHeroMediaPlayerController(mockOptions);
  console.log('Controller created successfully');
} catch (err) {
  console.error('Failed to create controller:', err);
  process.exit(1);
}
