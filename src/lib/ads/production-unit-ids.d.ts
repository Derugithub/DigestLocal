export const PRODUCTION_UNIT_IDS: Record<
  'shelf_banner' | 'article_end_banner' | 'save_interstitial' | 'study_rewarded',
  string
>;

export function isRealUnitId(value: unknown): boolean;

export function missingProductionUnits(units?: Record<string, string>): string[];

export function assertProductionUnitIds(units?: Record<string, string>): void;
