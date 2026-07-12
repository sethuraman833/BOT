// ─────────────────────────────────────────────────────────
//  Logger — Structured Console Output
// ─────────────────────────────────────────────────────────

const STYLES = {
  engine: 'color:#00d4aa;font-weight:bold',
  ws:     'color:#3d9cf0;font-weight:bold',
  api:    'color:#9b6dff;font-weight:bold',
  error:  'color:#ff4d6a;font-weight:bold',
  info:   'color:#7a8a9a',
};

const IS_DEV = typeof window !== 'undefined' 
  ? (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  : true;

export function log(module, message, data) {
  if (!IS_DEV) return;
  const style = STYLES[module] || STYLES.info;
  const tag = `[${module.toUpperCase()}]`;
  const time = new Date().toLocaleTimeString();
  if (data !== undefined) {
    console.log(`%c[${time}] ${tag} ${message}`, style, data);
  } else {
    console.log(`%c[${time}] ${tag} ${message}`, style);
  }
}

export function logError(module, message, err) {
  const time = new Date().toLocaleTimeString();
  console.error(`%c[${time}] [${module.toUpperCase()}] ${message}`, STYLES.error, err);
}
