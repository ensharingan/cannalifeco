import { createContext, useContext, useEffect } from "react";

// Canna Life Co is light-only per the client. This used to read/write a
// 'cannalife_theme' localStorage key and follow the OS preference; that's all
// gone now — theme is hardcoded to "light" and setTheme/toggleTheme are
// no-ops so any old caller doesn't blow up. See index.html for the matching
// first-paint lock (it no longer adds the 'dark' class either).
var THEME = "light";

var ThemeContext = createContext({
  theme: THEME,
  setTheme: function () {},
  toggleTheme: function () {},
});

function applyTheme() {
  try {
    var root = document.documentElement;
    root.classList.remove("dark");
    root.style.colorScheme = "light";
  } catch (_) {}
}

export function ThemeProvider({ children }) {
  useEffect(function () {
    applyTheme();
  }, []);

  var noop = function () {};

  return (
    <ThemeContext.Provider value={{ theme: THEME, setTheme: noop, toggleTheme: noop }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
