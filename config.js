// ─────────────────────────────────────────────────────────────────────────────
// CONFIG & CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
  IST_OFFSET_S: 19800,
  IST_OFFSET_MS: 19800000,
  MAX_BUBBLES: 1500,
  MIN_BUBBLE_RADIUS: 3,
  DEBOUNCE_MS: 50,
  WEBSOCKET_URL: 'ws://localhost:8765',
  TPS_INTERVAL_MS: 1000,
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
const debounce = (fn, ms) => {
  let timer; return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

const safeCall = (fn, ctx = null, fallback = null) => {
  try { return fn.call(ctx); }
  catch (e) { console.error('Error:', e); return fallback; }
};

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL STATE
// ─────────────────────────────────────────────────────────────────────────────
// IST = UTC+5:30. Upstox sends true Unix epoch (UTC-based). Add offset to display IST.
const IST_OFFSET_S  = CONFIG.IST_OFFSET_S;     // seconds
const IST_OFFSET_MS = CONFIG.IST_OFFSET_MS;  // milliseconds

let ws=null, lwChart=null, cSeries=null, vSeries=null;
let cData=[], vData=[], cMap={};
let selSym=null, selIv=60, tokSaved=false;
// Client-side candle aggregation for 1m/15m chart display (bubbles always use raw 1s candles)
let aggBucket = null;   // { time, open, high, low, close, volume }  — current forming bucket

let tickCnt=0, tpsTmr=null, bubOn=true;
let _atRealTime = true;  // tracks if user is at the live edge; false = user has dragged away
let LOT_SIZE      = 65;           // contracts per lot — editable from sidebar
let agbubMinContracts = 25 * LOT_SIZE; // minimum contracts to show a bubble (25 lots)
let agbubScale        = 3;    // radius scale factor (from slider)
let agbubOpacity      = 0.60; // circle fill opacity (from slider)
let agbubMaxRadius    = 20;   // hard cap on bubble radius (px) — editable from sidebar
let agbubMultiplier   = 1.0;  // master size multiplier (0.1–5.0) — side of scale slider

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTERS
// ─────────────────────────────────────────────────────────────────────────────
const fN = v => Number(v).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const fV = v => { if(!v) return '—'; if(v>=1e7) return (v/1e7).toFixed(2)+' Cr'; if(v>=1e5) return (v/1e5).toFixed(2)+' L'; return Number(v).toLocaleString('en-IN'); };
// fT: ltt is true Unix ms from Upstox. Add IST offset for display.
const fT = ms => {
  const d = new Date(ms + IST_OFFSET_MS);
  return String(d.getUTCHours()).padStart(2,'0') + ':' +
         String(d.getUTCMinutes()).padStart(2,'0') + ':' +
         String(d.getUTCSeconds()).padStart(2,'0') + ' IST';
};

const ivLabel = v => { if(v>=3600) return (v/3600)+'h'; if(v>=60) return (v/60)+'m'; return v+'s'; };
