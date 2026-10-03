import { ImageResponse } from "next/og";

/*
 * The card a shared link shows. Words only: the name, the headline the home page opens with and
 * its caveat. No figure, chart or claim, so the card can never disagree with the page.
 * Rendered once at build time with the font `next/og` bundles; colors are the dark theme's.
 */

export const alt = "Clash Control: every clash has a price";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BACKGROUND = "#140e0a";
const FOREGROUND = "#f1eee7";
const MUTED = "#b0aaa0";
const ACCENT = "#ff7643";
const BORDER = "#39312c";

/** The site mark: two rings whose overlap is filled, drawn without a clip path. */
function Mark() {
  return (
    <svg width="72" height="72" viewBox="0 0 32 32">
      <path d="M16 7.938A9 9 0 0 1 16 24.062A9 9 0 0 1 16 7.938Z" fill={ACCENT} />
      <circle cx="12" cy="16" r="9" fill="none" stroke={FOREGROUND} strokeWidth="2.5" />
      <circle cx="20" cy="16" r="9" fill="none" stroke={FOREGROUND} strokeWidth="2.5" />
    </svg>
  );
}

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BACKGROUND,
          color: FOREGROUND,
          padding: "72px 84px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <Mark />
          <div style={{ fontSize: 44, letterSpacing: "-0.01em" }}>Clash Control</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", fontSize: 116, lineHeight: 1, letterSpacing: "-0.035em" }}>
          <div>Every clash</div>
          <div>has a price.</div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            paddingTop: 26,
            borderTop: `2px solid ${BORDER}`,
            fontSize: 34,
            lineHeight: 1.3,
            color: MUTED,
          }}
        >
          <div>Set-time clashes priced with Qloo audience data.</div>
          <div style={{ color: FOREGROUND }}>Taste, not attendance.</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
