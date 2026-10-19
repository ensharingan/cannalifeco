import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { X, Camera } from "lucide-react";

export default function BarcodeScanner({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const readerRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;

    reader.decodeFromVideoDevice(undefined, videoRef.current, (result, err) => {
      if (result) {
        onDetected(result.getText());
      }
    }).catch(e => setError("Camera access denied or unavailable."));

    return () => {
      try { BrowserMultiFormatReader.releaseAllStreams(); } catch (_) {}
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="relative w-full max-w-sm mx-4 bg-card rounded-2xl overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-primary" />
            <span className="font-semibold">Scan Barcode</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error ? (
          <div className="p-8 text-center text-sm text-red-400">{error}</div>
        ) : (
          <div className="relative">
            <video ref={videoRef} className="w-full aspect-square object-cover" />
            {/* Targeting overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-48 h-48 border-2 border-primary rounded-xl opacity-70" />
            </div>
          </div>
        )}

        <p className="text-xs text-center text-muted-foreground p-3">
          Point the camera at a product barcode or SKU
        </p>
      </div>
    </div>
  );
}