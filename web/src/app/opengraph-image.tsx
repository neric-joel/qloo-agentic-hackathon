import { ImageResponse } from "next/og";

/*
 * The card a shared link shows: the question the home page opens with, and a small drawing of the
 * one thing it does (a published slot, a tested slot, and the time the two share getting shorter).
 * No index, festival or figure, because a shared link may point at either published day.
 * Rendered once at build time with the font `next/og` bundles; colors are the dark theme's.
 */

export const alt = "Clash Control: which clash is worth moving?";
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

/**
 * Two stage rows on one time axis: the published slot is solid, the tested slot is dashed and a short
 * vermilion band is the time the two share, shorter in the second row.
 */
function SlotDiagram() {
  const label = { display: "flex", fontSize: 20, letterSpacing: "0.15em", color: MUTED } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 400 }}>
      <div style={label}>PUBLISHED</div>
      <svg width="400" height="110" viewBox="0 0 400 110">
        <rect x="0" y="8" width="216" height="34" rx="6" fill={FOREGROUND} />
        <rect x="1.5" y="54" width="297" height="34" rx="6" fill={BACKGROUND} stroke={FOREGROUND} strokeWidth="3" />
        <rect x="0" y="98" width="216" height="10" rx="5" fill={ACCENT} />
      </svg>
      <div style={{ ...label, marginTop: 18 }}>TESTED</div>
      <svg width="400" height="110" viewBox="0 0 400 110">
        <rect x="0" y="8" width="216" height="34" rx="6" fill={FOREGROUND} />
        <rect
          x="85"
          y="54"
          width="298"
          height="34"
          rx="6"
          fill={BACKGROUND}
          stroke={ACCENT}
          strokeWidth="3.5"
          strokeDasharray="12 8"
        />
        <rect x="84" y="98" width="132" height="10" rx="5" fill={ACCENT} />
      </svg>
    </div>
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
          padding: "64px 84px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
          <Mark />
          <div style={{ fontSize: 44, letterSpacing: "-0.01em" }}>Clash Control</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 92,
              lineHeight: 1,
              letterSpacing: "-0.035em",
              width: 640,
            }}
          >
            <div>Which clash</div>
            <div>is worth</div>
            <div>moving?</div>
          </div>
          <SlotDiagram />
        </div>

        <div
          style={{
            display: "flex",
            paddingTop: 24,
            borderTop: `2px solid ${BORDER}`,
            fontSize: 30,
            lineHeight: 1.3,
            color: MUTED,
          }}
        >
          Published-day examples · Qloo-derived taste rank, not attendance.
        </div>
      </div>
    ),
    { ...size },
  );
}
