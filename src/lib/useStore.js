import { useState, useEffect } from "react";

const STORE_KEY = "selected_store_id";

export function getSelectedStoreId() {
  return localStorage.getItem(STORE_KEY) || "all";
}

export function setSelectedStoreId(id) {
  if (id === "all") {
    localStorage.removeItem(STORE_KEY);
  } else {
    localStorage.setItem(STORE_KEY, id);
  }
  window.dispatchEvent(new Event("store-changed"));
}

export function useStore() {
  const [storeId, setStoreId] = useState(getSelectedStoreId);

  useEffect(() => {
    const handler = () => setStoreId(getSelectedStoreId());
    window.addEventListener("store-changed", handler);
    return () => window.removeEventListener("store-changed", handler);
  }, []);

  return storeId;
}

// Filter helper: pass to .filter() on any entity array
export function byStore(storeId) {
  return (record) => storeId === "all" || record.store_id === storeId;
}