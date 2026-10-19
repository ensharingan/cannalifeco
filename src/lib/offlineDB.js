/**
 * Offline DB — localStorage-backed cache and write queue.
 * Uses Supabase directly instead of Base44 entities.
 */
import { supabase } from '@/api/supabaseClient';

const CACHE_PREFIX = '__cannalife_cache_';
const QUEUE_KEY = '__cannalife_write_queue';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Maps entity names to Supabase table names
const ENTITY_MAP = {
  Product: 'products',
  Member: 'members',
  Order: 'orders',
  Expense: 'expenses',
  Store: 'stores',
  Supplier: 'suppliers',
  SupplierReturn: 'supplier_returns',
  Promotion: 'promotions',
  CashierSession: 'cashier_sessions',
  InventoryMovement: 'inventory_movements',
  MemberActivity: 'member_activities',
  StockTransfer: 'stock_transfers',
  Patient: 'patients',
};

function getTable(entityName) {
  const table = ENTITY_MAP[entityName];
  if (!table) throw new Error(`Unknown entity: ${entityName}`);
  return table;
}

async function supabaseCreate(entityName, payload) {
  const table = getTable(entityName);
  const { data, error } = await supabase.from(table).insert(payload).select().single();
  if (error) throw error;
  return data;
}

async function supabaseUpdate(entityName, id, payload) {
  const table = getTable(entityName);
  const { data, error } = await supabase.from(table).update(payload).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

async function supabaseDelete(entityName, id) {
  const table = getTable(entityName);
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
  return true;
}

export const offlineDB = {
  cache: {
    set(key, data) {
      try {
        localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ ts: Date.now(), data }));
      } catch (_) {}
    },
    get(key) {
      try {
        const raw = localStorage.getItem(CACHE_PREFIX + key);
        if (!raw) return null;
        return JSON.parse(raw).data;
      } catch (_) { return null; }
    },
    getFresh(key) {
      try {
        const raw = localStorage.getItem(CACHE_PREFIX + key);
        if (!raw) return null;
        const { ts, data } = JSON.parse(raw);
        if (Date.now() - ts > CACHE_TTL_MS) return null;
        return data;
      } catch (_) { return null; }
    },
    isStale(key) {
      try {
        const raw = localStorage.getItem(CACHE_PREFIX + key);
        if (!raw) return true;
        const { ts } = JSON.parse(raw);
        return Date.now() - ts > CACHE_TTL_MS;
      } catch (_) { return true; }
    },
    invalidate(key) {
      try { localStorage.removeItem(CACHE_PREFIX + key); } catch (_) {}
    },
    invalidateAll() {
      try {
        Object.keys(localStorage)
          .filter(k => k.startsWith(CACHE_PREFIX))
          .forEach(k => localStorage.removeItem(k));
      } catch (_) {}
    },
    keys() {
      return Object.keys(localStorage)
        .filter(k => k.startsWith(CACHE_PREFIX))
        .map(k => k.replace(CACHE_PREFIX, ''));
    },
  },

  queue: {
    getAll() {
      try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
      catch (_) { return []; }
    },
    push(item) {
      const q = this.getAll();
      q.push({ ...item, queuedAt: Date.now() });
      localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    },
    clear() { localStorage.removeItem(QUEUE_KEY); },
    async flush() {
      const items = this.getAll();
      if (!items.length) return 0;
      let synced = 0;
      for (const item of items) {
        try {
          if (item.action === 'create') await supabaseCreate(item.entityName, item.payload);
          else if (item.action === 'update') await supabaseUpdate(item.entityName, item.id, item.payload);
          else if (item.action === 'delete') await supabaseDelete(item.entityName, item.id);
          synced++;
        } catch (_) {}
      }
      if (synced === items.length) this.clear();
      else {
        const remaining = items.slice(synced);
        localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
      }
      return synced;
    },
  },
};

/**
 * Fetch with TTL-based cache.
 * - Online + cache stale/missing → fetch fresh, update cache
 * - Online + cache fresh → return cache (fast)
 * - Offline + cache exists → return cache (any age)
 * - Offline + no cache → throw
 */
export async function fetchWithCache(cacheKey, fetcher) {
  if (navigator.onLine) {
    if (offlineDB.cache.isStale(cacheKey)) {
      const data = await fetcher();
      offlineDB.cache.set(cacheKey, data);
      return data;
    }
    return offlineDB.cache.getFresh(cacheKey);
  }
  const cached = offlineDB.cache.get(cacheKey);
  if (cached) return cached;
  throw new Error('Offline and no cached data available.');
}

/**
 * Write with offline queue fallback.
 * Online → write directly to Supabase.
 * Offline → queue for later sync.
 */
export async function writeWithQueue(entityName, action, payload, id = null) {
  if (navigator.onLine) {
    if (action === 'create') return supabaseCreate(entityName, payload);
    if (action === 'update') return supabaseUpdate(entityName, id, payload);
    if (action === 'delete') return supabaseDelete(entityName, id);
  } else {
    offlineDB.queue.push({ entityName, action, payload, id });
    return { ...payload, id: id || `offline_${Date.now()}`, _offline: true };
  }
}
