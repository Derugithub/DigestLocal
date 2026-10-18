export type ProductionUnitIds = Record<'shelf_banner' | 'article_end_banner' | 'save_interstitial' | 'study_rewarded', string>;

/** null while real ad units are commented out (closed testing). */
export const PRODUCTION_UNIT_IDS: ProductionUnitIds | null;

export const LIVE_AD_UNITS_ENABLED: boolean;

export function isRealUnitId(value: unknown): boolean;

export function missingProductionUnits(units?: Record<string, string> | null): string[];

export function assertProductionUnitIds(units?: Record<string, string> | null): void;

export function checkLiveAdUnits(liveBuild: boolean, enabled?: boolean, units?: Record<string, string> | null): void;
