// Background-friendly library ingest: scan disk, apply to SQLite, report progress.
// Pure orchestration — testable without Electron.
function executeIngest(deps) {
  const {
    root: rootArg,
    defaultRoot,
    getSetting,
    setSetting,
    scanRoot,
    parseStrategy,
    applyIngest,
    onProgress,
  } = deps;
  const libRoot = rootArg || getSetting('library_root') || defaultRoot;
  const progress = (payload) => onProgress?.(payload);

  progress({ phase: 'scan', message: 'Scanning library…', done: 0, total: 0 });
  const scan = scanRoot(libRoot, {
    onModule: ({ folder, done, total }) => {
      progress({
        phase: 'scan',
        message: `Scanned ${folder}`,
        done,
        total,
      });
    },
  });

  let strategy = null;
  if (scan.strategyPath) {
    progress({ phase: 'scan', message: 'Reading study strategy…', done: 0, total: 0 });
    try {
      strategy = parseStrategy(scan.strategyPath);
    } catch {
      /* optional file */
    }
  }

  progress({ phase: 'db', message: 'Updating database…', done: 0, total: 0 });
  const stats = applyIngest(scan, strategy);
  setSetting('library_root', libRoot);
  return { root: libRoot, ...stats, strategyParsed: !!strategy };
}

module.exports = { executeIngest };
