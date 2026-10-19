import { useState, useEffect } from "react";
import { Store } from "lucide-react";
import { getSelectedStoreId, setSelectedStoreId } from "../lib/useStore";
import { useCompany } from "../lib/CompanyContext";
import { supabase } from "@/api/supabaseClient";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function StoreSelector() {
  var { companyId, stores, setActiveStoreId } = useCompany();
  var [selected, setSelected] = useState(getSelectedStoreId() || "all");

  // Sync initial value to context on mount
  useEffect(
    function () {
      var stored = getSelectedStoreId();
      if (stored && stored !== "all") {
        setActiveStoreId(stored);
      } else {
        setActiveStoreId(null);
      }
    },
    [setActiveStoreId]
  );

  var handleChange = function (val) {
    setSelected(val);
    setSelectedStoreId(val);
    if (val === "all") {
      setActiveStoreId(null);
    } else {
      setActiveStoreId(val);
    }
  };

  if (!stores || !stores.length) return null;

  var typeLabel = {
    single: "Single",
    branch: "Branch",
    warehouse: "Warehouse",
    franchise: "Franchise",
  };

  return (
    <div className="px-3 pb-3">
      <p className="text-xs text-sidebar-foreground/50 px-1 mb-1 flex items-center gap-1">
        <Store className="w-3 h-3" /> Active Store
      </p>
      <Select value={selected} onValueChange={handleChange}>
        <SelectTrigger className="bg-sidebar-accent border-sidebar-border text-sidebar-accent-foreground text-xs h-8">
          <SelectValue placeholder="All Stores" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">🏢 All Stores</SelectItem>
          {stores
            .filter(function (s) {
              return s.is_active !== false;
            })
            .map(function (s) {
              return (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                  {s.type && (
                    <span className="text-muted-foreground ml-1 text-xs">
                      ({typeLabel[s.type] || s.type})
                    </span>
                  )}
                </SelectItem>
              );
            })}
        </SelectContent>
      </Select>
    </div>
  );
}
