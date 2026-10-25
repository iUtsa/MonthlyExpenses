// Browser builds of npm dependencies, served at /vendor/<name> (and copied into the static build).
export const VENDOR_FILES = {
  'chart.umd.min.js': 'node_modules/chart.js/dist/chart.umd.min.js',
  'xlsx.full.min.js': 'node_modules/xlsx/dist/xlsx.full.min.js',
  'tesseract.min.js': 'node_modules/tesseract.js/dist/tesseract.min.js',
  'tesseract.worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'pdf.min.mjs': 'node_modules/pdfjs-dist/build/pdf.min.mjs',
  'pdf.worker.min.mjs': 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
};
