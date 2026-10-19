/**
 * entities.js
 * Drop-in replacement for base44.entities.X.list/filter/create/update/delete
 * Usage: import { entities } from '@/api/entities'
 *        const members = await entities.members.filter({ company_id: id })
 */
import { supabase } from './supabaseClient';

// Error code 42P01 = "undefined_table" in Postgres.
// If a table doesn't exist yet, silently return empty so the UI doesn't crash.
const isMissingTable = (error) =>
  error?.code === '42P01' || /does not exist/i.test(error?.message || '');

function makeEntity(tableName) {
  return {
    /** List all records, optional order and limit */
    async list(orderBy = '-created_at', limit = 1000) {
      const col = orderBy.startsWith('-') ? orderBy.slice(1) : orderBy;
      const asc = !orderBy.startsWith('-');
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .order(col, { ascending: asc })
        .limit(limit);
      if (error) {
        if (isMissingTable(error)) return [];
        throw error;
      }
      return data || [];
    },

    /** Filter by exact field matches */
    async filter(filters = {}, orderBy = '-created_at', limit = 1000) {
      const col = orderBy.startsWith('-') ? orderBy.slice(1) : orderBy;
      const asc = !orderBy.startsWith('-');
      let query = supabase.from(tableName).select('*');
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          query = query.eq(key, value);
        }
      });
      const { data, error } = await query.order(col, { ascending: asc }).limit(limit);
      if (error) {
        if (isMissingTable(error)) return [];
        throw error;
      }
      return data || [];
    },

    /** Get single record by ID */
    async get(id) {
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },

    /** Create a new record */
    async create(payload) {
      const { data, error } = await supabase
        .from(tableName)
        .insert([{ ...payload, created_at: new Date().toISOString() }])
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    /** Update a record by ID */
    async update(id, payload) {
      const { data, error } = await supabase
        .from(tableName)
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    /** Delete a record by ID */
    async delete(id) {
      const { error } = await supabase.from(tableName).delete().eq('id', id);
      if (error) throw error;
      return { success: true };
    },

    /** Search text fields */
    async search(column, term, extraFilters = {}) {
      let query = supabase
        .from(tableName)
        .select('*')
        .ilike(column, `%${term}%`);
      Object.entries(extraFilters).forEach(([key, value]) => {
        query = query.eq(key, value);
      });
      const { data, error } = await query.limit(100);
      if (error) {
        if (isMissingTable(error)) return [];
        throw error;
      }
      return data || [];
    },
  };
}

// All entities mapped to Supabase table names
export const entities = {
  Company:              makeEntity('companies'),
  Store:                makeEntity('stores'),
  Product:              makeEntity('products'),
  Member:               makeEntity('members'),
  Patient:              makeEntity('patients'),
  Order:                makeEntity('orders'),
  Expense:              makeEntity('expenses'),
  InventoryMovement:    makeEntity('inventory_movements'),
  CashierSession:       makeEntity('cashier_sessions'),
  Supplier:             makeEntity('suppliers'),
  SupplierReturn:       makeEntity('supplier_returns'),
  Promotion:            makeEntity('promotions'),
  LoyaltySetting:       makeEntity('loyalty_settings'),
  MemberActivity:       makeEntity('member_activities'),
  StockTransfer:        makeEntity('stock_transfers'),
  CashierProfile:       makeEntity('cashier_profiles'),
  Profile:              makeEntity('profiles'),
  CustomerNotification: makeEntity('customer_notifications'),
  Lead:                 makeEntity('leads'),
  Subscription:         makeEntity('subscriptions'),
  Invoice:              makeEntity('invoices'),
};

// ─── Storage helpers (replaces Base44 file upload) ────────────────────────────
export const storage = {
  /**
   * Upload a file to Supabase Storage
   * @param {string} bucket - e.g. 'avatars', 'documents', 'products'
   * @param {string} path - e.g. 'company_id/filename.jpg'
   * @param {File} file
   * @returns {string} public URL
   */
  async upload(bucket, path, file) {
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      upsert: true,
      contentType: file.type,
    });
    if (error) throw error;
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  },

  async remove(bucket, path) {
    const { error } = await supabase.storage.from(bucket).remove([path]);
    if (error) throw error;
  },
};
