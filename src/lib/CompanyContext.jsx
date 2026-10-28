import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/api/supabaseClient';

var CompanyContext = createContext(null);

export function CompanyProvider({ children }) {
  var [companyId, setCompanyId] = useState(null);
  var [company, setCompany] = useState(null);
  var [loading, setLoading] = useState(true);
  var [stores, setStores] = useState([]);
  var [role, setRole] = useState(null);
  var [activeStoreId, setActiveStoreId] = useState(null);

  // Once the first load has finished, `loading` must never go back to true.
  // Anything gating on it swaps the page for a spinner, which unmounts every
  // open form and loses whatever was being typed.
  var loadedOnceRef = useRef(false);
  var loadedForUserRef = useRef(null);

  // Only replace state when the value actually differs, so a background
  // refresh does not hand consumers new object identities for the same data.
  var setIfChanged = useCallback(function (setter, next, current) {
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    setter(next);
  }, []);

  var refresh = useCallback(async function (opts) {
    var silent = !!(opts && opts.silent);
    try {
      if (!silent && !loadedOnceRef.current) setLoading(true);

      var sessionRes = await supabase.auth.getUser();
      var user = sessionRes.data ? sessionRes.data.user : null;
      var userError = sessionRes.error;
      if (userError || !user) {
        loadedForUserRef.current = null;
        setCompanyId(null);
        setCompany(null);
        setStores([]);
        loadedOnceRef.current = true;
        setLoading(false);
        return;
      }
      var userId = user.id;
      var profileData = null;
      var rpcRes = await supabase.rpc('get_my_profile');
      if (!rpcRes.error && rpcRes.data && rpcRes.data.length > 0) {
        profileData = rpcRes.data[0];
      } else {
        var directRes = await supabase
          .from('profiles')
          .select('company_id, role, store_id')
          .eq('id', userId)
          .maybeSingle();
        profileData = directRes.data;
      }
      setRole(profileData && profileData.role ? profileData.role : null);
      var cid = null;
      if (profileData && profileData.company_id) {
        cid = profileData.company_id;
        var coRes = await supabase
          .from('companies')
          .select('*')
          .eq('id', cid)
          .maybeSingle();
        if (coRes.data) {
          setCompany(function (prev) {
            if (prev && JSON.stringify(prev) === JSON.stringify(coRes.data)) return prev;
            return coRes.data;
          });
          setCompanyId(function (prev) {
            return prev === coRes.data.id ? prev : coRes.data.id;
          });
        }
      } else {
        var fallbackRes = await supabase
          .from('companies')
          .select('*')
          .eq('created_by', userId)
          .order('created_at', { ascending: false })
          .limit(1);
        if (fallbackRes.data && fallbackRes.data.length > 0) {
          var firstCompany = fallbackRes.data[0];
          setCompany(function (prev) {
            if (prev && JSON.stringify(prev) === JSON.stringify(firstCompany)) return prev;
            return firstCompany;
          });
          setCompanyId(function (prev) {
            return prev === firstCompany.id ? prev : firstCompany.id;
          });
          cid = firstCompany.id;
          await supabase
            .from('profiles')
            .update({ company_id: firstCompany.id })
            .eq('id', userId);
        }
      }

      // Load stores for this company
      if (cid) {
        var storesRes = await supabase
          .from('stores')
          .select('*')
          .eq('company_id', cid)
          .eq('is_active', true)
          .order('name');
        var loadedStores = storesRes.data || [];
        setStores(function (prev) {
          if (JSON.stringify(prev) === JSON.stringify(loadedStores)) return prev;
          return loadedStores;
        });

        // Set activeStoreId from profile.store_id if user has one assigned
        // This ensures cashiers see their assigned store, not the first alphabetically
        if (profileData && profileData.store_id) {
          var storeExists = false;
          for (var i = 0; i < loadedStores.length; i++) {
            if (loadedStores[i].id === profileData.store_id) {
              storeExists = true;
              break;
            }
          }
          if (storeExists) {
            setActiveStoreId(function (prev) {
              if (!prev) return profileData.store_id;
              return prev;
            });
          }
        }
        // Auto-select first store if only one exists and none is set
        if (loadedStores.length >= 1) {
          setActiveStoreId(function (prev) {
            if (!prev) return loadedStores[0].id;
            return prev;
          });
        }
      }

      loadedForUserRef.current = userId;
    } catch (err) {
      console.error('CompanyContext error:', err);
    } finally {
      loadedOnceRef.current = true;
      setLoading(false);
    }
  }, []);

  useEffect(function () {
    refresh();

    var listener = supabase.auth.onAuthStateChange(function (event, session) {
      // Routine background token housekeeping — nothing about the company
      // has changed, so touching state here only causes remounts.
      if (event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') return;

      if (event === 'SIGNED_IN') {
        var incomingId = session && session.user ? session.user.id : null;
        // Supabase re-fires SIGNED_IN whenever the tab regains focus. If it is
        // the same user we already loaded, do nothing at all.
        if (incomingId && incomingId === loadedForUserRef.current) return;
        refresh({ silent: true });
        return;
      }

      if (event === 'SIGNED_OUT') {
        loadedForUserRef.current = null;
        setCompanyId(null);
        setCompany(null);
        setStores([]);
        setActiveStoreId(null);
        setLoading(false);
      }
    });

    return function () {
      listener.data.subscription.unsubscribe();
    };
  }, [refresh]);

  var value = useMemo(function () {
    return {
      companyId,
      company,
      loading,
      setCompany,
      setCompanyId,
      refresh,
      stores,
      activeStoreId,
      setActiveStoreId,
      role,
    };
  }, [companyId, company, loading, refresh, stores, activeStoreId, role]);

  return (
    <CompanyContext.Provider value={value}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  return useContext(CompanyContext);
}
