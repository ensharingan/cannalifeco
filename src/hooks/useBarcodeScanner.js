// src/hooks/useBarcodeScanner.js
// Detects a USB "keyboard-wedge" barcode scanner (the normal kind).
// These scanners type the code very fast and finish with an Enter key.
// We tell them apart from a human by measuring the gap between keystrokes:
// a scanner fires characters milliseconds apart, a person is much slower.
//
// Usage in a POS component:
//   useBarcodeScanner((code) => {
//     const product = products.find(p => p.barcode === code);
//     if (product) addToCart(product);
//   });

import { useEffect, useRef } from "react";

export default function useBarcodeScanner(onScan, options = {}) {
  const {
    minLength = 4,     // ignore anything shorter than this (stray keys)
    maxGapMs = 60,     // scanners fire chars < ~60ms apart; humans are slower
    enabled = true,
  } = options;

  const bufferRef = useRef("");
  const lastTimeRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e) {
      const now = Date.now();
      const gap = now - lastTimeRef.current;
      lastTimeRef.current = now;

      // A slow keystroke means a human is typing — throw away the buffer.
      if (gap > maxGapMs) {
        bufferRef.current = "";
      }

      if (e.key === "Enter") {
        const code = bufferRef.current;
        bufferRef.current = "";
        if (code.length >= minLength) {
          e.preventDefault();
          onScan(code);
        }
        return;
      }

      // Only collect single printable characters (digits/letters).
      if (e.key.length === 1) {
        bufferRef.current += e.key;
        // Once the buffer is clearly a scan in progress, stop the characters
        // reaching the focused input. Otherwise the code lands in the search
        // box and filters the whole product grid away.
        if (gap <= maxGapMs && bufferRef.current.length > 1) {
          e.preventDefault();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onScan, minLength, maxGapMs, enabled]);
}
