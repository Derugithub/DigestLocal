export type DayCount = { date: string; count: number };

export type AdState = {
  firstOpenAt: number | null;
  sessionCount: number;
  lastBackgroundAt: number | null;
  sessionStartedAt: number;
  savedCount: number;
  saveInterstitialCounter: number;
  lastFullscreenAt: number | null;
  fullscreenToday: DayCount;
  rewardedToday: DayCount;
  quizUnlocksToday: DayCount;
  lastRewardedClosedAt: number | null;
  adFreeUntil: number | null;
  /** Faster TTS speeds (1.5× and 2×) stay unlocked until this time. */
  extraSpeedsUntil: number | null;
  quizUnlocks: string[];
};

const STORAGE_KEY = 'ads.state';
const REMOTE_CACHE_KEY = 'ads.remoteConfig';

export function emptyAdState(now = 0): AdState {
  return {
    firstOpenAt: null,
    sessionCount: 0,
    lastBackgroundAt: null,
    sessionStartedAt: now,
    savedCount: 0,
    saveInterstitialCounter: 0,
    lastFullscreenAt: null,
    fullscreenToday: { date: '', count: 0 },
    rewardedToday: { date: '', count: 0 },
    quizUnlocksToday: { date: '', count: 0 },
    lastRewardedClosedAt: null,
    adFreeUntil: null,
    extraSpeedsUntil: null,
    quizUnlocks: [],
  };
}

function isDayCount(value: unknown): value is DayCount {
  if (!value || typeof value !== 'object') return false;
  const day = value as DayCount;
  return typeof day.date === 'string' && typeof day.count === 'number' && Number.isFinite(day.count);
}

export function sanitizeAdState(value: unknown, now = Date.now()): AdState {
  const base = emptyAdState(now);
  if (!value || typeof value !== 'object') return base;
  const raw = value as Partial<AdState>;
  return {
    firstOpenAt: typeof raw.firstOpenAt === 'number' ? raw.firstOpenAt : null,
    sessionCount: typeof raw.sessionCount === 'number' && raw.sessionCount > 0 ? Math.floor(raw.sessionCount) : 0,
    lastBackgroundAt: typeof raw.lastBackgroundAt === 'number' ? raw.lastBackgroundAt : null,
    sessionStartedAt: typeof raw.sessionStartedAt === 'number' ? raw.sessionStartedAt : now,
    savedCount: typeof raw.savedCount === 'number' && raw.savedCount > 0 ? Math.floor(raw.savedCount) : 0,
    saveInterstitialCounter:
      typeof raw.saveInterstitialCounter === 'number' && raw.saveInterstitialCounter > 0
        ? Math.floor(raw.saveInterstitialCounter)
        : 0,
    lastFullscreenAt: typeof raw.lastFullscreenAt === 'number' ? raw.lastFullscreenAt : null,
    fullscreenToday: isDayCount(raw.fullscreenToday) ? raw.fullscreenToday : base.fullscreenToday,
    rewardedToday: isDayCount(raw.rewardedToday) ? raw.rewardedToday : base.rewardedToday,
    quizUnlocksToday: isDayCount(raw.quizUnlocksToday) ? raw.quizUnlocksToday : base.quizUnlocksToday,
    lastRewardedClosedAt: typeof raw.lastRewardedClosedAt === 'number' ? raw.lastRewardedClosedAt : null,
    adFreeUntil: typeof raw.adFreeUntil === 'number' ? raw.adFreeUntil : null,
    extraSpeedsUntil: typeof raw.extraSpeedsUntil === 'number' ? raw.extraSpeedsUntil : null,
    quizUnlocks: Array.isArray(raw.quizUnlocks) ? raw.quizUnlocks.filter((id) => typeof id === 'string') : [],
  };
}

async function storage() {
  const module = await import('expo-sqlite/kv-store');
  return module.default;
}

export async function loadAdState(now = Date.now()): Promise<AdState> {
  try {
    const raw = await (await storage()).getItem(STORAGE_KEY);
    if (!raw) return emptyAdState(now);
    return sanitizeAdState(JSON.parse(raw) as unknown, now);
  } catch {
    return emptyAdState(now);
  }
}

export async function saveAdState(state: AdState): Promise<void> {
  try {
    await (await storage()).setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The shelf still works if the counter store is unavailable. Ads stay on defaults.
  }
}

/**
 * Flush counters before Android freezes the process on background.
 * A cold start is its own session. This write keeps the warm-resume clock
 * and the other counters when the process is only backgrounded.
 */
export function saveAdStateSync(state: AdState): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const storage = require('expo-sqlite/kv-store').default as {
    setItemSync: (key: string, value: string) => void;
  };
  storage.setItemSync(STORAGE_KEY, JSON.stringify(state));
}

export type RemoteConfigCache = { fetchedAt: number; config: unknown };

export async function loadRemoteConfigCache(): Promise<RemoteConfigCache | null> {
  try {
    const raw = await (await storage()).getItem(REMOTE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RemoteConfigCache;
    if (!parsed || typeof parsed.fetchedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveRemoteConfigCache(cache: RemoteConfigCache): Promise<void> {
  try {
    await (await storage()).setItem(REMOTE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // A failed cache write falls back to bundled defaults on the next launch.
  }
}
