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

const BACKGROUND = "#0a0e15";
const FOREGROUND = "#eceff2";
const MUTED = "#aab2bd";
// Raspberry, the dark theme's shared-time colour: used on the two shared-time bands and nowhere else.
const ACCENT = "#f180b5";
const BORDER = "#323843";

/** The site mark (components/site/logo-mark.tsx): a solid set slot and its moved place as an outline, in ink only. */
function Mark() {
  return (
    <svg width="72" height="72" viewBox="0 0 32 32">
      <path
        fill={FOREGROUND}
        d="M9 3h9.5a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-7a1.5 1.5 0 0 0-1.5 1.5v16.5a1 1 0 0 1-1 1a6 6 0 0 1-6-6v-14a6 6 0 0 1 6-6z"
      />
      <path
        fill="none"
        stroke={FOREGROUND}
        strokeWidth="2"
        strokeLinejoin="round"
        d="M23 28h-9.5a.5.5 0 0 1-.5-.5v-4a.5.5 0 0 1 .5-.5h7a2.5 2.5 0 0 0 2.5-2.5v-16.5a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5z"
      />
    </svg>
  );
}

/**
 * Two stage rows on one time axis: the published slot is solid, the tested slot is dashed (in ink: it is
 * a set) and a short raspberry band is the time the two share, shorter in the second row.
 */
function SlotDiagram() {
  const label = { display: "flex", fontSize: 20, letterSpacing: 0, color: MUTED } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 400 }}>
      <div style={label}>Published</div>
      <svg width="400" height="110" viewBox="0 0 400 110">
        <rect x="0" y="8" width="216" height="34" rx="6" fill={FOREGROUND} />
        <rect x="1.5" y="54" width="297" height="34" rx="6" fill={BACKGROUND} stroke={FOREGROUND} strokeWidth="3" />
        <rect x="0" y="98" width="216" height="10" rx="5" fill={ACCENT} />
      </svg>
      <div style={{ ...label, marginTop: 18 }}>Tested move</div>
      <svg width="400" height="110" viewBox="0 0 400 110">
        <rect x="0" y="8" width="216" height="34" rx="6" fill={FOREGROUND} />
        <rect
          x="85"
          y="54"
          width="298"
          height="34"
          rx="6"
          fill={BACKGROUND}
          stroke={FOREGROUND}
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
