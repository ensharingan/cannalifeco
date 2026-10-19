import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { Button } from "@/components/ui/button";
import { ClipboardList } from "lucide-react";

/**
 * Stock count button for the POS toolbar.
 *
 *   <StockCountLauncher storeId={effectiveStoreId} />
 *
 * Turns amber and reads "Resume Count" while a count is open at this store.
 */
export default function StockCountLauncher({ storeId }) {
  var navigate = useNavigate();
  var [openCount, setOpenCount] = useState(null);

  useEffect(function () {
    var cancelled = false;
    if (!storeId) { setOpenCount(null); return; }

    supabase
      .from("stock_counts")
      .select("id, name, status")
      .eq("store_id", storeId)
      .in("status", ["in_progress", "paused"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .then(function (res) {
        if (cancelled) return;
        setOpenCount(res.data && res.data[0] ? res.data[0] : null);
      })
      .catch(function () { if (!cancelled) setOpenCount(null); });

    return function () { cancelled = true; };
  }, [storeId]);

  var go = function () {
    navigate(openCount ? "/stock-counts/" + openCount.id : "/stock-counts");
  };

  return (
    <Button
      variant={openCount ? "default" : "outline"}
      onClick={go}
      className={"gap-2 whitespace-nowrap " + (openCount ? "bg-amber-500 hover:bg-amber-600 text-white" : "")}
      title={openCount ? "Resume the open stock count" : "Count stock"}
    >
      <ClipboardList className="w-4 h-4" />
      {openCount ? "Resume Count" : "Stock Count"}
    </Button>
  );
}
