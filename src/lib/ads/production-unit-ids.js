/**
 * Production AdMob unit IDs, one per placement. Plain JavaScript so app.config.ts can check them.
 *
 * CLOSED TESTING: real ad units are OFF. Every build, production included, requests Google's
 * test units (TestIds). The real AdMob app ID stays on in every build, as Google recommends.
 *
 * To turn on real ads at the public release:
 *   1. Below, delete the line `const PRODUCTION_UNIT_IDS = null;` and uncomment the block under it.
 *      That is the only code change. LIVE_AD_UNITS_ENABLED then becomes true.
 *   2. Keep ADS_MODE=live in the eas.json production profile (it already is).
 *      Development and preview stay on ADS_MODE=test and keep using test units.
 *   3. Build with the production profile. EAS raises versionCode automatically
 *      (appVersionSource remote + autoIncrement), so it is higher than every closed-test build.
 *      app.config.ts stops that build if any placement is missing or still a Google test unit.
 */
const PRODUCTION_UNIT_IDS = null;
// const PRODUCTION_UNIT_IDS = {
//   shelf_banner: 'ca-app-pub-4342572133101591/5889882153',
//   article_end_banner: 'ca-app-pub-4342572133101591/7526222443',
//   save_interstitial: 'ca-app-pub-4342572133101591/3978034680',
//   study_rewarded: 'ca-app-pub-4342572133101591/3387841891',
// };

/** True only once the real unit IDs above are uncommented. While false, live builds use test units. */
const LIVE_AD_UNITS_ENABLED = PRODUCTION_UNIT_IDS !== null;

const PLACEMENTS = ['shelf_banner', 'article_end_banner', 'save_interstitial', 'study_rewarded'];
const UNIT_ID_PATTERN = /^ca-app-pub-\d{16}\/\d{10}$/;
const GOOGLE_SAMPLE_UNIT_PREFIX = 'ca-app-pub-3940256099942544/';

function isRealUnitId(value) {
  return typeof value === 'string' && UNIT_ID_PATTERN.test(value) && !value.startsWith(GOOGLE_SAMPLE_UNIT_PREFIX);
}

/** Placements whose production unit ID is missing, a placeholder, or a Google test unit. */
function missingProductionUnits(units = PRODUCTION_UNIT_IDS) {
  if (units == null) return [...PLACEMENTS];
  return PLACEMENTS.filter((placement) => !isRealUnitId(units[placement]));
}

/** Stops a build with live ad units enabled when a placement has no real unit ID. */
function assertProductionUnitIds(units = PRODUCTION_UNIT_IDS) {
  const missing = missingProductionUnits(units);
  if (missing.length > 0) {
    throw new Error(`Set real AdMob unit IDs before a build with live ads. Missing: ${missing.join(', ')}`);
  }
}

/**
 * The build-time check for app.config.ts. It runs only when the build is live and the real units
 * are enabled, so a production build during closed testing (test units) does not fail.
 */
function checkLiveAdUnits(liveBuild, enabled = LIVE_AD_UNITS_ENABLED, units = PRODUCTION_UNIT_IDS) {
  if (liveBuild && enabled) assertProductionUnitIds(units);
}

module.exports = {
  PRODUCTION_UNIT_IDS,
  LIVE_AD_UNITS_ENABLED,
  isRealUnitId,
  missingProductionUnits,
  assertProductionUnitIds,
  checkLiveAdUnits,
};
