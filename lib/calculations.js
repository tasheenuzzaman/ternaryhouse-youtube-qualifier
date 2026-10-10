/**
 * Ternary House YouTube Qualifier — pure business calculations.
 *
 * This module is deliberately free of DOM, network, and chrome.* APIs so the
 * same code runs in the extension service worker and in the Node test runner.
 *
 * Every number the UI shows must be traceable to a function in this file.
 */

/* ------------------------------------------------------------------------ *
 * Configuration — the single source of truth for Ternary House methodology.
 * ------------------------------------------------------------------------ */

export const CONFIG = Object.freeze({
  /** Calendar-month recency window for both metrics. */
  WINDOW_MONTHS: 3,
  /** Hard cap on sample size (most recent N). */
  MAX_SAMPLE: 12,
  /** At or above this count the normal trimmed average applies. */
  MIN_NORMAL_SAMPLE: 6,
  /** 4..5 videos => small-sample contextual mean, manual review recommended. */
  MIN_SMALL_SAMPLE: 4,
  /** Engagement screening floor, in percent. */
  ER_SCREEN_MIN_PCT: 2,
  /** Screening context bands for recent average views (context only, never a verdict). */
  AVG_VIEW_BANDS: Object.freeze({ core: 50000, conditional: 35000 }),

  /**
   * COACH-CONFIRMED creator-level engagement method.
   *
   * Compute each sampled video's own ER, drop exactly one highest and one
   * lowest ER observation, then take the arithmetic mean of the rest. The
   * view-weighted aggregate is explicitly NOT the production method and is
   * no longer calculated.
   */
  ER_METHOD: 'trimmed_mean_of_video_ers',

  /**
   * Coach-confirmed engagement sample bands. These are deliberately separate
   * from the average-views bands above: the coach confirmed that FIVE valid
   * ER observations are enough to trim, while FOUR is a manual assessment.
   */
  ER_MIN_TRIMMED_SAMPLE: 5,
  ER_MANUAL_REVIEW_SAMPLE: 4,
});

/** Human label for the production creator-level engagement figure. */
export const ER_METHOD_LABEL = 'Trimmed mean ER (one highest and one lowest ER removed)';

/* ------------------------------------------------------------------------ *
 * Date helpers
 * ------------------------------------------------------------------------ */

/**
 * Subtract whole calendar months using UTC calendar components, returning
 * 00:00:00.000 UTC of the resulting date. Clamps to the length of the target
 * month: 2025-05-31 minus 3 months => 2025-02-28 (not 2025-03-03), and
 * 2024-05-31 => 2024-02-29 in a leap year.
 *
 * UTC, and midnight, are both deliberate. The recency window is a CALENDAR
 * rule, so it must not depend on the operator's timezone or on the time of day
 * the tool happens to be run. See CHANGELOG 1.0.1.
 */
export function subtractCalendarMonthsUTC(date, months) {
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth() - months; // may be negative; Date.UTC normalises
  const day = date.getUTCDate();

  // Day 0 of the following month is the last day of the target month.
  const daysInTargetMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

  return new Date(Date.UTC(year, monthIndex, Math.min(day, daysInTargetMonth), 0, 0, 0, 0));
}

/**
 * The inclusive lower bound of the recency window: 00:00:00.000 UTC of the
 * cutoff date. Every video published at or after this instant is in window.
 */
export function recencyCutoff(now = new Date(), months = CONFIG.WINDOW_MONTHS) {
  return subtractCalendarMonthsUTC(now, months);
}

function publishedMs(video) {
  const t = Date.parse(video && video.publishedAt);
  return Number.isFinite(t) ? t : null;
}

/* ------------------------------------------------------------------------ *
 * Sample selection
 * ------------------------------------------------------------------------ */

/**
 * Pick the official sample: eligible long-form videos published within the
 * calendar window, newest first, capped at MAX_SAMPLE.
 *
 * @param {Array} videos normalized videos; `eligible === false` are dropped.
 * @returns {{cutoff: Date, sample: Array, inWindowCount: number, older: Array,
 *            ineligibleCount: number, undatedCount: number}}
 */
export function selectRecentSample(videos, now = new Date(), opts = {}) {
  const months = opts.months ?? CONFIG.WINDOW_MONTHS;
  const maxSample = opts.maxSample ?? CONFIG.MAX_SAMPLE;
  const cutoff = subtractCalendarMonthsUTC(now, months);
  const cutoffMs = cutoff.getTime();

  const list = Array.isArray(videos) ? videos : [];
  const eligible = list.filter((v) => v && v.eligible !== false);
  const ineligibleCount = list.length - eligible.length;

  const dated = eligible.filter((v) => publishedMs(v) !== null);
  const undatedCount = eligible.length - dated.length;

  const sorted = dated.slice().sort((a, b) => publishedMs(b) - publishedMs(a));
  const inWindow = sorted.filter((v) => publishedMs(v) >= cutoffMs);
  const older = sorted.filter((v) => publishedMs(v) < cutoffMs);

  return {
    cutoff,
    inWindowCount: inWindow.length,
    sample: inWindow.slice(0, maxSample),
    older,
    ineligibleCount,
    undatedCount,
  };
}

/* ------------------------------------------------------------------------ *
 * Average views
 * ------------------------------------------------------------------------ */

function arithmeticMean(numbers) {
  if (!numbers.length) return null;
  return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

/**
 * Ternary House recent average views.
 *
 * n >= 6  : drop exactly one highest observation and one lowest observation,
 *           then take the arithmetic mean of the rest.
 * n = 4-5 : untrimmed mean, flagged for manual outlier review.
 * n = 1-3 : no qualification average at all.
 * n = 0   : nothing eligible.
 *
 * Videos whose view count is hidden are excluded and counted separately;
 * they are never treated as zero.
 */
export function computeAverageViews(sample) {
  const list = Array.isArray(sample) ? sample : [];
  const usable = list.filter((v) => Number.isFinite(v.viewCount) && v.viewCount >= 0);
  const viewsHiddenCount = list.length - usable.length;

  const rows = usable.map((v) => ({
    videoId: v.id,
    title: v.title,
    publishedAt: v.publishedAt,
    viewCount: v.viewCount,
    status: 'INCLUDED',
  }));

  const hiddenRows = list
    .filter((v) => !Number.isFinite(v.viewCount) || v.viewCount < 0)
    .map((v) => ({
      videoId: v.id,
      title: v.title,
      publishedAt: v.publishedAt,
      viewCount: null,
      status: 'VIEWS UNAVAILABLE',
    }));

  const base = {
    status: 'NO_ELIGIBLE',
    method: 'none',
    sampleCount: list.length,
    eligibleCount: usable.length,
    viewsHiddenCount,
    averagedCount: 0,
    averageRaw: null,
    average: null,
    excludedHigh: null,
    excludedLow: null,
    rows: rows.concat(hiddenRows),
    note: null,
    confident: false,
  };

  const n = usable.length;

  if (n === 0) {
    return { ...base, note: 'No eligible long-form videos with a public view count in the window.' };
  }

  if (n <= 3) {
    rows.forEach((r) => { r.status = 'CONTEXT ONLY'; });
    return {
      ...base,
      status: 'INSUFFICIENT',
      note: 'Insufficient recent sample — inspect older context.',
      rows: rows.concat(hiddenRows),
    };
  }

  if (n <= 5) {
    rows.forEach((r) => { r.status = 'SMALL-SAMPLE CONTEXT'; });
    const raw = arithmeticMean(usable.map((v) => v.viewCount));
    return {
      ...base,
      status: 'SMALL_SAMPLE',
      method: 'untrimmed_mean',
      averagedCount: n,
      averageRaw: raw,
      average: Math.round(raw),
      note: 'Small sample — manual outlier review recommended.',
      rows: rows.concat(hiddenRows),
    };
  }

  // Normal rule: exactly one high observation and one low observation removed.
  // Sorting an index array means ties still resolve to two distinct videos,
  // including the all-equal case.
  const order = usable
    .map((_, i) => i)
    .sort((a, b) => (usable[a].viewCount - usable[b].viewCount) || (a - b));

  const lowIdx = order[0];
  const highIdx = order[order.length - 1];

  rows[highIdx].status = 'EXCLUDED HIGH';
  rows[lowIdx].status = 'EXCLUDED LOW';

  const kept = usable.filter((_, i) => i !== lowIdx && i !== highIdx);
  const raw = arithmeticMean(kept.map((v) => v.viewCount));

  return {
    ...base,
    status: 'OK',
    method: 'trimmed_high_low',
    averagedCount: kept.length,
    averageRaw: raw,
    average: Math.round(raw),
    excludedHigh: {
      videoId: usable[highIdx].id,
      title: usable[highIdx].title,
      viewCount: usable[highIdx].viewCount,
    },
    excludedLow: {
      videoId: usable[lowIdx].id,
      title: usable[lowIdx].title,
      viewCount: usable[lowIdx].viewCount,
    },
    rows: rows.concat(hiddenRows),
    confident: true,
  };
}

/**
 * Screening context band. Never a pass/fail verdict.
 */
export function averageViewsBand(average) {
  if (!Number.isFinite(average)) return null;
  if (average >= CONFIG.AVG_VIEW_BANDS.core) return 'core';
  if (average >= CONFIG.AVG_VIEW_BANDS.conditional) return 'conditional';
  return 'review';
}

/* ------------------------------------------------------------------------ *
 * Engagement
 * ------------------------------------------------------------------------ */

/**
 * Indices of exactly one lowest and one highest observation.
 *
 * Sorting an index array means ties resolve to two distinct entries, so
 * duplicate extremes lose only ONE occurrence and an all-equal set still
 * yields two distinct exclusions. Identical semantics to the average-views
 * rule, kept as a separate helper so that validated code stays untouched.
 */
function trimOneHighOneLow(values) {
  const order = values
    .map((_, i) => i)
    .sort((a, b) => (values[a] - values[b]) || (a - b));
  return { lowIdx: order[0], highIdx: order[order.length - 1] };
}

/**
 * Per-video engagement rate: (likes + comments) / views * 100.
 *
 * Any missing dependency makes the video's ER unavailable. A hidden like count
 * is never read as zero. A comment count the API omits (comments disabled or
 * otherwise not reported) is never read as a verified zero; an explicitly
 * reported 0 is valid.
 */
export function computeVideoEngagement(video) {
  const v = video || {};
  const out = {
    videoId: v.id,
    title: v.title,
    publishedAt: v.publishedAt,
    viewCount: Number.isFinite(v.viewCount) ? v.viewCount : null,
    likeCount: Number.isFinite(v.likeCount) ? v.likeCount : null,
    commentCount: Number.isFinite(v.commentCount) ? v.commentCount : null,
    er: null,
    available: false,
    reason: null,
  };

  if (!Number.isFinite(v.viewCount)) {
    out.reason = 'VIEWS_UNAVAILABLE';
    return out;
  }
  if (v.viewCount <= 0) {
    out.reason = 'ZERO_VIEWS';
    return out;
  }
  if (!Number.isFinite(v.likeCount)) {
    out.reason = 'LIKES_UNAVAILABLE';
    return out;
  }
  if (!Number.isFinite(v.commentCount)) {
    out.reason = 'COMMENTS_UNAVAILABLE';
    return out;
  }

  out.er = ((v.likeCount + v.commentCount) / v.viewCount) * 100;
  out.available = true;
  return out;
}

export const ENGAGEMENT_REASON_TEXT = Object.freeze({
  VIEWS_UNAVAILABLE: 'View count not reported by the API',
  ZERO_VIEWS: 'Zero views — ER undefined',
  LIKES_UNAVAILABLE: 'Like count hidden — ER unavailable',
  COMMENTS_UNAVAILABLE: 'Comment count not reported (comments disabled or hidden) — ER unavailable',
});

/**
 * Creator-level engagement, using the coach-confirmed method.
 *
 * Each eligible sampled video gets its own ER. One highest and one lowest ER
 * observation are removed, and the remaining individual percentages are
 * averaged. Only videos with complete, trustworthy data take part: a hidden
 * like count, an unreported comment count, or zero views makes that video's ER
 * unavailable, and unavailable observations never enter the trimmed mean.
 *
 * Coach-confirmed sample bands:
 *   valid >= 5  -> trimmed mean (one highest and one lowest ER removed)
 *   valid == 4  -> untrimmed contextual mean only. Nothing is excluded
 *                  automatically; the coach treats four as a manual outlier
 *                  assessment, and the tool deliberately does NOT invent a
 *                  numeric outlier threshold.
 *   valid 1-3   -> no creator-level rate at all
 *   valid 0     -> nothing to report
 *
 * The >=2% counts remain as secondary screening evidence.
 */
export function computeEngagement(sample, opts = {}) {
  const threshold = opts.threshold ?? CONFIG.ER_SCREEN_MIN_PCT;
  const list = Array.isArray(sample) ? sample : [];

  const rows = list.map((v) => {
    const row = computeVideoEngagement(v);
    row.status = row.available ? 'INCLUDED' : 'UNAVAILABLE';
    return row;
  });

  // Positions in `rows` of the observations that may be averaged.
  const validPositions = rows.map((r, i) => (r.available ? i : -1)).filter((i) => i >= 0);
  const ers = validPositions.map((i) => rows[i].er);
  const n = ers.length;

  const screening = {
    threshold,
    atOrAboveThreshold: ers.filter((e) => e >= threshold).length,
    belowThreshold: ers.filter((e) => e < threshold).length,
    erMin: n ? Math.min(...ers) : null,
    erMax: n ? Math.max(...ers) : null,
  };

  const base = {
    ...screening,
    method: CONFIG.ER_METHOD,
    methodLabel: ER_METHOD_LABEL,
    sampleCount: list.length,
    validCount: n,
    unavailableCount: rows.length - n,
    status: 'NO_DATA',
    appliedMethod: 'none',
    creatorEr: null,
    includedCount: 0,
    excludedHigh: null,
    excludedLow: null,
    note: null,
    confident: false,
  };

  if (n === 0) {
    return {
      rows,
      summary: { ...base, note: 'No video in the sample reports the data needed for an engagement rate.' },
    };
  }

  if (n <= 3) {
    for (const i of validPositions) rows[i].status = 'CONTEXT ONLY';
    return {
      rows,
      summary: {
        ...base,
        status: 'INSUFFICIENT',
        // Conservative Ternary House safeguard, not a coach-defined rule.
        // Worded for engagement specifically: older-than-3-month engagement
        // data is not part of the normal qualification workflow, so this does
        // NOT point the reviewer at older context the way Avg Views does.
        note: 'Insufficient recent engagement sample — review posting consistency and individual recent videos.',
      },
    };
  }

  if (n < CONFIG.ER_MIN_TRIMMED_SAMPLE) {
    // Exactly four valid observations. No automatic exclusion of any kind.
    for (const i of validPositions) rows[i].status = 'SMALL-SAMPLE CONTEXT';
    return {
      rows,
      summary: {
        ...base,
        status: 'SMALL_SAMPLE',
        appliedMethod: 'untrimmed_mean',
        creatorEr: arithmeticMean(ers),
        includedCount: n,
        note: `${n}-video sample — manual outlier assessment required. No ER automatically excluded.`,
      },
    };
  }

  const { lowIdx, highIdx } = trimOneHighOneLow(ers);
  const highRow = rows[validPositions[highIdx]];
  const lowRow = rows[validPositions[lowIdx]];
  highRow.status = 'EXCLUDED HIGHEST ER';
  lowRow.status = 'EXCLUDED LOWEST ER';

  const kept = ers.filter((_, i) => i !== lowIdx && i !== highIdx);

  return {
    rows,
    summary: {
      ...base,
      status: 'OK',
      appliedMethod: 'trimmed_high_low',
      creatorEr: arithmeticMean(kept),
      includedCount: kept.length,
      excludedHigh: { videoId: highRow.videoId, title: highRow.title, er: highRow.er },
      excludedLow: { videoId: lowRow.videoId, title: lowRow.title, er: lowRow.er },
      confident: true,
    },
  };
}

/**
 * The compact headline for the Engagement control: the creator-level trimmed
 * mean ER, to two decimal places. A small sample keeps the asterisk convention
 * used by Avg Views so the two controls read consistently.
 */
export function engagementCompactLabel(summary) {
  if (!summary) return 'N/A';
  if (summary.status === 'OK' && Number.isFinite(summary.creatorEr)) {
    return `${summary.creatorEr.toFixed(2)}%`;
  }
  if (summary.status === 'SMALL_SAMPLE' && Number.isFinite(summary.creatorEr)) {
    return `${summary.creatorEr.toFixed(2)}%*`;
  }
  if (summary.status === 'INSUFFICIENT') return 'insufficient';
  return 'N/A';
}

/* ------------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------------ */

/** 67814 -> "67.8K". Abbreviation is display only; the exact integer is copied. */
export function formatCompactNumber(value) {
  if (!Number.isFinite(value)) return 'N/A';
  const sign = value < 0 ? '-' : '';
  const n = Math.abs(value);
  const units = [
    { limit: 1e9, suffix: 'B' },
    { limit: 1e6, suffix: 'M' },
    { limit: 1e3, suffix: 'K' },
  ];
  for (const { limit, suffix } of units) {
    if (n >= limit) {
      const text = (n / limit).toFixed(1);
      return sign + text.replace(/\.0$/, '') + suffix;
    }
  }
  return sign + String(Math.round(n));
}

/** 67814 -> "67,814" */
export function formatExactNumber(value) {
  if (!Number.isFinite(value)) return 'N/A';
  return Math.round(value).toLocaleString('en-US');
}

/** 3.7512 -> "3.75%" */
export function formatPercent(value, digits = 2) {
  if (!Number.isFinite(value)) return 'N/A';
  return `${value.toFixed(digits)}%`;
}

/**
 * ISO timestamp -> "2025-07-14", rendered in UTC.
 *
 * UTC so that a displayed date always agrees with the UTC calendar rule the
 * recency window uses.
 */
export function formatDate(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'N/A';
  const d = new Date(t);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
