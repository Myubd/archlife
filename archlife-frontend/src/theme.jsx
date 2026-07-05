import React, { createContext, useContext, useEffect, useMemo, useState } from "react";

// ---------- テーマ(背景)定義 ----------
// 各テーマは元のデザイントークン(COLORS)と同じキー構成を持つ。
// これによりアプリ全体の見た目(紙の色・墨の色・朱色など)を丸ごと差し替えられる。
export const THEMES = {
  washi: {
    label: "和紙(既定)",
    colors: {
      paper: "#EDE7DA",
      paperDark: "#E3DCC9",
      ink: "#2A2823",
      inkFaint: "#7A7469",
      hanko: "#A13D3F",
      moss: "#56684A",
      gold: "#C99A3E",
      line: "#C6BFAE",
    },
  },
  sumi: {
    label: "墨(ダーク)",
    colors: {
      paper: "#1E1E1C",
      paperDark: "#171715",
      ink: "#EDE7DA",
      inkFaint: "#9C968A",
      hanko: "#D9696B",
      moss: "#7C9268",
      gold: "#D9AE55",
      line: "#3A3934",
    },
  },
  ai: {
    label: "藍(ブルー)",
    colors: {
      paper: "#E7EEF2",
      paperDark: "#DBE5EB",
      ink: "#1F2B38",
      inkFaint: "#5C6B78",
      hanko: "#2F5D8A",
      moss: "#3E6B5C",
      gold: "#C99A3E",
      line: "#B9C9D2",
    },
  },
  sakura: {
    label: "桜(ピンク)",
    colors: {
      paper: "#F7EBEE",
      paperDark: "#F0DFE3",
      ink: "#3A2A2E",
      inkFaint: "#8A7378",
      hanko: "#B5495B",
      moss: "#6E7F5A",
      gold: "#C99A3E",
      line: "#E3C7CD",
    },
  },
};

export const THEME_LIST = Object.entries(THEMES).map(([id, t]) => ({ id, label: t.label }));
export const DEFAULT_THEME_ID = "washi";
const THEME_STORAGE_KEY = "archlife_theme";

// ---------- 背景画像(ユーザーが選んだ好きな画像) ----------
// 端末のlocalStorageに保存するため、そのままだと大きすぎて保存できない/重くなるので
// アップロード時にリサイズ・圧縮したデータURLを保存する(SettingsView.jsx側で処理)。
const BG_IMAGE_STORAGE_KEY = "archlife_bg_image";
const BG_OVERLAY_STORAGE_KEY = "archlife_bg_overlay";
export const DEFAULT_BG_OVERLAY = 0.78; // 0(画像そのまま)〜1(ほぼ紙色で覆う)

function readStoredBgImage() {
  try {
    return localStorage.getItem(BG_IMAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}
function readStoredBgOverlay() {
  try {
    const v = localStorage.getItem(BG_OVERLAY_STORAGE_KEY);
    const n = v === null ? NaN : Number(v);
    return Number.isFinite(n) ? n : DEFAULT_BG_OVERLAY;
  } catch {
    return DEFAULT_BG_OVERLAY;
  }
}

// "#RRGGBB" と 0〜1 の不透明度から rgba() 文字列を作る(背景画像の上に重ねる紙色フィルター用)
export function hexToRgba(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  if (!m) return `rgba(0,0,0,${alpha})`;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

function readStoredThemeId() {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v && THEMES[v] ? v : DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

const ThemeContext = createContext({
  themeId: DEFAULT_THEME_ID,
  colors: THEMES[DEFAULT_THEME_ID].colors,
  setThemeId: () => {},
  bgImage: null,
  bgOverlay: DEFAULT_BG_OVERLAY,
  bgSaveError: false,
  setBgImage: () => {},
  setBgOverlay: () => {},
});

export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(readStoredThemeId);
  const [bgImage, setBgImageState] = useState(readStoredBgImage);
  const [bgOverlay, setBgOverlayState] = useState(readStoredBgOverlay);
  const [bgSaveError, setBgSaveError] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themeId);
    } catch {}
  }, [themeId]);

  function setBgImage(dataUrlOrNull) {
    setBgImageState(dataUrlOrNull);
    setBgSaveError(false);
    try {
      if (dataUrlOrNull) {
        localStorage.setItem(BG_IMAGE_STORAGE_KEY, dataUrlOrNull);
      } else {
        localStorage.removeItem(BG_IMAGE_STORAGE_KEY);
      }
    } catch {
      // 画像が大きすぎる等でlocalStorageに保存できなかった場合。
      // 今回の表示上は反映されるが、再読み込みすると消える旨をUI側で伝える。
      setBgSaveError(true);
    }
  }

  function setBgOverlay(value) {
    const v = Math.max(0, Math.min(1, value));
    setBgOverlayState(v);
    try {
      localStorage.setItem(BG_OVERLAY_STORAGE_KEY, String(v));
    } catch {}
  }

  const value = useMemo(
    () => ({
      themeId,
      colors: (THEMES[themeId] || THEMES[DEFAULT_THEME_ID]).colors,
      setThemeId: (id) => setThemeId(THEMES[id] ? id : DEFAULT_THEME_ID),
      bgImage,
      bgOverlay,
      bgSaveError,
      setBgImage,
      setBgOverlay,
    }),
    [themeId, bgImage, bgOverlay, bgSaveError]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// コンポーネント内では `const COLORS = useTheme();` として使う
// (元のモジュール直下の COLORS 定数と同じ形で使えるようにしている)
export function useTheme() {
  return useContext(ThemeContext).colors;
}

export function useThemeControls() {
  const { themeId, setThemeId } = useContext(ThemeContext);
  return { themeId, setThemeId, themes: THEME_LIST };
}

// 背景画像(ユーザーが選んだ好きな画像)の状態と操作をまとめて返す
export function useBackgroundControls() {
  const { bgImage, bgOverlay, bgSaveError, setBgImage, setBgOverlay } = useContext(ThemeContext);
  return { bgImage, bgOverlay, bgSaveError, setBgImage, setBgOverlay };
}
