type AnalyticsValue = string | number | boolean | AnalyticsValue[] | { [key: string]: AnalyticsValue };
type AnalyticsParams = Record<string, unknown>;
type CleanParams = Record<string, AnalyticsValue>;
type LayoutShiftEntry = PerformanceEntry & { hadRecentInput: boolean; value: number };
type InteractionEntry = PerformanceEntry & { duration: number; interactionId: number };

const EVENT_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const PARAM_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const RESERVED_PREFIX = /^(firebase_|google_|ga_)/;
const BLOCKED_PARAM = /^(?:event|email|e_mail|mail|phone|phone_number|mobile|tel|telephone|user_id|uid|username|user_name|full_name|first_name|last_name|birth|birthday|birth_date|resident_number|ssn|ip|ip_address|client_id)$/;
const EMAIL = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/i;
const PHONE = /(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/;
const RESIDENT_NUMBER = /(?:^|\D)\d{6}[-.\s]?[1-4]\d{6}(?:\D|$)/;

const hasPii = (value: string) => EMAIL.test(value) || PHONE.test(value) || RESIDENT_NUMBER.test(value);

const sanitizeValue = (value: unknown, depth = 0): AnalyticsValue | undefined => {
  if (typeof value === 'string') {
    const text = value.trim().slice(0, 300);
    return text && !hasPii(text) ? text : undefined;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (depth >= 2 || value === null || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    const items = value
      .slice(0, 10)
      .map((item) => sanitizeValue(item, depth + 1))
      .filter((item): item is AnalyticsValue => item !== undefined);
    return items.length ? items : undefined;
  }

  const clean: Record<string, AnalyticsValue> = {};
  let count = 0;
  for (const [key, nestedValue] of Object.entries(value)) {
    if (count >= 20 || !PARAM_NAME.test(key) || BLOCKED_PARAM.test(key) || RESERVED_PREFIX.test(key)) continue;
    const sanitized = sanitizeValue(nestedValue, depth + 1);
    if (sanitized === undefined) continue;
    clean[key] = sanitized;
    count += 1;
  }
  return count ? clean : undefined;
};

const sanitizeParams = (params: AnalyticsParams): CleanParams => {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return {};
  const clean: CleanParams = {};
  let count = 0;
  for (const [key, value] of Object.entries(params)) {
    if (count >= 25 || !PARAM_NAME.test(key) || BLOCKED_PARAM.test(key) || RESERVED_PREFIX.test(key)) continue;
    const sanitized = sanitizeValue(value);
    if (sanitized === undefined) continue;
    clean[key] = sanitized;
    count += 1;
  }
  return clean;
};

const stableStringify = (value: AnalyticsValue): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${key}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

export const initializeAnalytics = (useDirectGa: boolean) => {
  const recentEvents = new Map<string, number>();

  window.danjipyoTrack = (eventName, params = {}) => {
    if (typeof eventName !== 'string') return false;
    const name = eventName.trim();
    if (!EVENT_NAME.test(name) || RESERVED_PREFIX.test(name)) return false;

    const cleanParams = sanitizeParams(params);
    const fingerprint = `${name}:${stableStringify(cleanParams)}`;
    const now = Date.now();
    const previous = recentEvents.get(fingerprint) || 0;
    if (now - previous < 1000) return false;
    recentEvents.set(fingerprint, now);
    if (recentEvents.size > 100) {
      for (const [key, timestamp] of recentEvents) {
        if (now - timestamp > 5000) recentEvents.delete(key);
      }
      while (recentEvents.size > 100) {
        const oldest = recentEvents.keys().next().value;
        if (typeof oldest !== 'string') break;
        recentEvents.delete(oldest);
      }
    }

    window.dataLayer = window.dataLayer || [];
    if (useDirectGa && typeof window.gtag === 'function') window.gtag('event', name, cleanParams);
    else window.dataLayer.push({ event: name, ...cleanParams });
    return true;
  };

  if (!('PerformanceObserver' in window)) return;
  const supported = PerformanceObserver.supportedEntryTypes || [];
  const sent = new Set<string>();
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const navigationType = navigation?.type || 'navigate';
  const metricSeed = Math.random().toString(36).slice(2, 10);
  const interactions = new Map<number, number>();
  let preferBeacon = false;
  let lcpValue: number | undefined;
  let lcpObserver: PerformanceObserver | undefined;
  let clsValue = 0;
  let clsWindowValue = 0;
  let clsWindowStart = 0;
  let clsWindowEnd = 0;
  let clsObserver: PerformanceObserver | undefined;
  let inpObserver: PerformanceObserver | undefined;

  const rating = (name: string, value: number) => {
    const limits = name === 'LCP' ? [2500, 4000] : name === 'CLS' ? [0.1, 0.25] : [200, 500];
    return value <= limits[0] ? 'good' : value <= limits[1] ? 'needs_improvement' : 'poor';
  };

  const reportMetric = (name: 'LCP' | 'CLS' | 'INP', value: number | undefined) => {
    if (sent.has(name) || typeof value !== 'number' || !Number.isFinite(value)) return;
    sent.add(name);
    const rounded = name === 'CLS' ? Math.round(value * 10000) / 10000 : Math.round(value);
    window.danjipyoTrack('web_vital', {
      metric_name: name,
      metric_value: rounded,
      metric_rating: rating(name, rounded),
      metric_id: `${metricSeed}_${name.toLowerCase()}`,
      navigation_type: navigationType,
      transport_type: preferBeacon || document.visibilityState === 'hidden' ? 'beacon' : 'xhr'
    });
  };

  const collectLcp = (entries: PerformanceEntry[]) => {
    const last = entries.at(-1);
    if (last) lcpValue = last.startTime;
  };
  const finalizeLcp = () => {
    if (lcpObserver) {
      collectLcp(lcpObserver.takeRecords());
      lcpObserver.disconnect();
      lcpObserver = undefined;
    }
    reportMetric('LCP', lcpValue);
  };

  const collectCls = (entries: PerformanceEntry[]) => {
    for (const rawEntry of entries) {
      const entry = rawEntry as LayoutShiftEntry;
      if (entry.hadRecentInput) continue;
      if (clsWindowValue && entry.startTime - clsWindowEnd < 1000 && entry.startTime - clsWindowStart < 5000) {
        clsWindowValue += entry.value;
        clsWindowEnd = entry.startTime;
      } else {
        clsWindowValue = entry.value;
        clsWindowStart = entry.startTime;
        clsWindowEnd = entry.startTime;
      }
      clsValue = Math.max(clsValue, clsWindowValue);
    }
  };

  const collectInp = (entries: PerformanceEntry[]) => {
    for (const rawEntry of entries) {
      const entry = rawEntry as InteractionEntry;
      if (!entry.interactionId) continue;
      interactions.set(entry.interactionId, Math.max(interactions.get(entry.interactionId) || 0, entry.duration));
      if (interactions.size > 500) {
        const oldest = interactions.keys().next().value;
        if (typeof oldest === 'number') interactions.delete(oldest);
      }
    }
  };

  if (supported.includes('largest-contentful-paint')) {
    try {
      lcpObserver = new PerformanceObserver((list) => collectLcp(list.getEntries()));
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
      addEventListener('pointerdown', finalizeLcp, { once: true, capture: true });
      addEventListener('keydown', finalizeLcp, { once: true, capture: true });
    } catch {}
  }

  if (supported.includes('layout-shift')) {
    try {
      clsObserver = new PerformanceObserver((list) => collectCls(list.getEntries()));
      clsObserver.observe({ type: 'layout-shift', buffered: true });
    } catch {
      clsObserver = undefined;
    }
  }

  if (supported.includes('event')) {
    try {
      inpObserver = new PerformanceObserver((list) => collectInp(list.getEntries()));
      inpObserver.observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit & { durationThreshold: number });
    } catch {
      inpObserver = undefined;
    }
  }

  const flushVitals = (useBeacon = false) => {
    if (useBeacon) preferBeacon = true;
    finalizeLcp();
    if (clsObserver) {
      collectCls(clsObserver.takeRecords());
      clsObserver.disconnect();
      clsObserver = undefined;
      reportMetric('CLS', clsValue);
    }
    if (inpObserver) {
      collectInp(inpObserver.takeRecords());
      inpObserver.disconnect();
      inpObserver = undefined;
      const values = [...interactions.values()].sort((a, b) => b - a);
      if (values.length) reportMetric('INP', values[Math.min(Math.floor(values.length / 50), values.length - 1)]);
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushVitals(true);
  }, { capture: true });
  addEventListener('pagehide', () => flushVitals(true), { once: true, capture: true });
};
