export type LineupSearchOrder = 'pubdate' | 'click';
export type LineupCategoryId = 'soul' | 'awakening' | 'exploration' | 'boss' | 'secret' | 'event' | 'duel' | 'barrier' | 'other';

export type LineupExternalSource = 'bilibili' | 'netease-community' | 'netease-official' | 'weibo' | 'nga';

export interface LineupSearchRequest {
  keyword: string;
  order: LineupSearchOrder;
  forceRefresh?: boolean;
  categoryId?: LineupCategoryId;
  extraKeyword?: string;
}

/** A public guide discovered from one supported source; details remain linked to the original page. */
export interface LineupSearchResult {
  /** Bilibili BV id, or a stable SRCH-* key for an indexed web page. */
  bvid: string;
  source: LineupExternalSource;
  url: string;
  title: string;
  author: string;
  description: string;
  publishedAt: number;
  duration: string;
  views: number;
  favorites: number;
  /** Public forum reply count, when available. */
  replies?: number;
}

export interface LineupSearchResponse {
  results: LineupSearchResult[];
  unavailableSources: LineupExternalSource[];
  /** Kept separate from the short status so each source can explain how to recover. */
  sourceErrors?: Array<{ source: LineupExternalSource; message: string }>;
}
