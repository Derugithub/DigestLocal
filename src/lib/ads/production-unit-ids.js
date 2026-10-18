/**
 * Production AdMob unit IDs, one per placement. Test, development, and preview builds never use these.
 * Plain JavaScript so app.config.ts can check them before a live build.
 */
const PRODUCTION_UNIT_IDS = {
  shelf_banner: 'ca-app-pub-4342572133101591/5889882153',
  article_end_banner: 'ca-app-pub-4342572133101591/7526222443',
  save_interstitial: 'ca-app-pub-4342572133101591/3978034680',
  study_rewarded: 'ca-app-pub-4342572133101591/3387841891',
};

const UNIT_ID_PATTERN = /^ca-app-pub-\d{16}\/\d{10}$/;
const GOOGLE_SAMPLE_UNIT_PREFIX = 'ca-app-pub-3940256099942544/';

function isRealUnitId(value) {
  return typeof value === 'string' && UNIT_ID_PATTERN.test(value) && !value.startsWith(GOOGLE_SAMPLE_UNIT_PREFIX);
}

/** Placements whose production unit ID is missing, a placeholder, or a Google test unit. */
function missingProductionUnits(units = PRODUCTION_UNIT_IDS) {
  return Object.keys(units).filter((placement) => !isRealUnitId(units[placement]));
}

/** Stops a live build before it ships with a placement that has no real unit ID. */
function assertProductionUnitIds(units = PRODUCTION_UNIT_IDS) {
  const missing = missingProductionUnits(units);
  if (missing.length > 0) {
    throw new Error(`Set real AdMob unit IDs before a production build. Missing: ${missing.join(', ')}`);
  }
}

module.exports = { PRODUCTION_UNIT_IDS, isRealUnitId, missingProductionUnits, assertProductionUnitIds };
