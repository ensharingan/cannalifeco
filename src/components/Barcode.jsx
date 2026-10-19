// src/components/Barcode.jsx
// Renders a scannable Code128-B barcode as pure SVG — no external library.
// Drop-in replacement: same props as before (value, height, fontSize, displayValue, width).

import { useMemo } from "react";

// Code128 width patterns for symbol values 0–105 (6 modules each:
// bar,space,bar,space,bar,space). Stop pattern is appended separately.
var CODE128_PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412","211214","211232"
];
var CODE128_STOP = "2331112";
var START_B = 104;

function encodeCode128B(text) {
  var codes = [START_B];
  var sum = START_B;
  for (var i = 0; i < text.length; i++) {
    var v = text.charCodeAt(i) - 32;      // Code B: ASCII 32–126 → values 0–94
    if (v < 0 || v > 94) v = 0;           // fall back to space for anything odd
    codes.push(v);
    sum += v * (i + 1);
  }
  codes.push(sum % 103);                    // checksum symbol

  var widths = "";
  for (var c = 0; c < codes.length; c++) widths += CODE128_PATTERNS[codes[c]];
  widths += CODE128_STOP;
  return widths;                            // string of module widths, starts with a bar
}

export default function Barcode({
  value,
  height = 50,
  fontSize = 14,
  displayValue = true,
  width = 2,        // module (thinnest bar) width in px
  margin = 10,      // quiet zone in modules
  className = "",
}) {
  var svg = useMemo(function () {
    var text = value === undefined || value === null ? "" : String(value);
    if (!text) return null;

    var widths = encodeCode128B(text);

    // Total module count for sizing
    var totalModules = 0;
    for (var i = 0; i < widths.length; i++) totalModules += parseInt(widths[i], 10);

    var quiet = margin;
    var svgWidth = (totalModules + quiet * 2) * width;
    var textHeight = displayValue ? fontSize + 4 : 0;
    var svgHeight = height + textHeight;

    // Build black bars (even index = bar, odd = space)
    var rects = [];
    var x = quiet * width;
    for (var j = 0; j < widths.length; j++) {
      var w = parseInt(widths[j], 10) * width;
      if (j % 2 === 0) {
        rects.push({ x: x, w: w });
      }
      x += w;
    }

    return { svgWidth: svgWidth, svgHeight: svgHeight, height: height, rects: rects, textY: height + fontSize, textX: svgWidth / 2 };
  }, [value, height, fontSize, displayValue, width, margin]);

  if (!svg) return null;

  return (
    <svg
      className={className}
      width={svg.svgWidth}
      height={svg.svgHeight}
      viewBox={"0 0 " + svg.svgWidth + " " + svg.svgHeight}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="0" y="0" width={svg.svgWidth} height={svg.svgHeight} fill="#ffffff" />
      {svg.rects.map(function (r, i) {
        return <rect key={i} x={r.x} y="0" width={r.w} height={svg.height} fill="#000000" />;
      })}
      {displayValue && (
        <text
          x={svg.textX}
          y={svg.textY}
          textAnchor="middle"
          fontFamily="monospace"
          fontSize={fontSize}
          fill="#000000"
        >
          {String(value)}
        </text>
      )}
    </svg>
  );
}
