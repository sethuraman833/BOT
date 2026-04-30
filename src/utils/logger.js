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

export function log(module, message, data) {
  const style = STYLES[module] || STYLES.info;
  const tag = `[${module.toUpperCase()}]`;
  if (data !== undefined) {
    console.log(`%c${tag} ${message}`, style, data);
  } else {
    console.log(`%c${tag} ${message}`, style);
  }
}

export function logError(module, message, err) {
  console.error(`%c[${module.toUpperCase()}] ${message}`, STYLES.error, err);
}
