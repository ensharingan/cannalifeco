import { useOnlineStatus } from "../lib/useOnlineStatus";
import { offlineDB } from "../lib/offlineDB";
import { useEffect, useState } from "react";
import { WifiOff, Wifi, RefreshCw } from "lucide-react";

export default function OfflineBanner() {
  const isOnline = useOnlineStatus();
  const [justReconnected, setJustReconnected] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncedCount, setSyncedCount] = useState(0);
  const [queueSize, setQueueSize] = useState(0);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    setQueueSize(offlineDB.queue.getAll().length);
  }, [isOnline]);

  useEffect(() => {
    if (!isOnline) {
      setWasOffline(true);
      return;
    }
    if (wasOffline) {
      setJustReconnected(true);
      handleSync();
      const t = setTimeout(() => setJustReconnected(false), 5000);
      return () => clearTimeout(t);
    }
  }, [isOnline]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const count = await offlineDB.queue.flush();
      setSyncedCount(count);
      setQueueSize(offlineDB.queue.getAll().length);
    } catch (err) {
      console.warn("Offline queue sync failed", err);
    } finally {
      setSyncing(false);
      setWasOffline(false);
    }
  };

  if (isOnline && !justReconnected) return null;

  if (!isOnline) {
    return (
      <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 flex items-center gap-3 text-sm text-red-400">
        <WifiOff className="w-4 h-4 flex-shrink-0" />
        <span className="flex-1">
          <strong>Offline mode</strong> — changes are queued and will sync when reconnected.
          {queueSize > 0 && <span className="ml-1 font-medium">({queueSize} pending)</span>}
        </span>
      </div>
    );
  }

  return (
    <div className="bg-green-500/10 border-b border-green-500/20 px-4 py-2 flex items-center gap-3 text-sm text-green-400">
      <Wifi className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1">
        {syncing ? (
          <span className="flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Syncing offline changes...</span>
        ) : (
          <span>Back online{syncedCount > 0 ? ` — ${syncedCount} change${syncedCount !== 1 ? "s" : ""} synced` : ""}.</span>
        )}
      </span>
    </div>
  );
}
