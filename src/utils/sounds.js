// ─────────────────────────────────────────────────────────
//  Sound Effects — Audio Notifications for Signals
// ─────────────────────────────────────────────────────────

// Generate tones using Web Audio API (no external files needed)
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

/**
 * Play a tone with the Web Audio API.
 * @param {number} frequency - Hz
 * @param {number} duration - seconds
 * @param {string} type - 'sine' | 'square' | 'triangle' | 'sawtooth'
 * @param {number} volume - 0.0 to 1.0
 */
function playTone(frequency, duration = 0.15, type = 'sine', volume = 0.3) {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.value = volume;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch {
    // Audio not supported or blocked — silently ignore
  }
}

/**
 * Signal found: ascending 3-note chime (C5→E5→G5).
 */
export function playSignalSound() {
  playTone(523, 0.12, 'sine', 0.25);         // C5
  setTimeout(() => playTone(659, 0.12, 'sine', 0.25), 130);  // E5
  setTimeout(() => playTone(784, 0.2, 'sine', 0.3), 260);   // G5
}

/**
 * Analysis complete: single soft ping.
 */
export function playAnalysisComplete() {
  playTone(880, 0.15, 'sine', 0.15); // A5
}

/**
 * Error/rejection: low buzz.
 */
export function playRejectSound() {
  playTone(220, 0.25, 'square', 0.1); // A3 square wave
}

/**
 * Price alert: double beep.
 */
export function playAlertSound() {
  playTone(1047, 0.1, 'sine', 0.2);  // C6
  setTimeout(() => playTone(1047, 0.1, 'sine', 0.2), 150);
}
