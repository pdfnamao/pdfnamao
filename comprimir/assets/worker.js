// Worker de análise e compressão. Cada tarefa usa um Worker novo, encerrado ao
// final: é isso que libera a memória, inclusive em cancelamento e timeout.
//
// Worker clássico porque a build do qpdf é um script global, sem export ES. O
// Ghostscript é um módulo ES e entra por import() dinâmico.
const url = (path) => new URL(path, self.location).href;
const GS_JS = url('../vendor/gs/gs.js');
const GS_WASM = url('../vendor/gs/gs.wasm');
const QPDF_JS = url('../vendor/qpdf/qpdf.js');
const QPDF_WASM = url('../vendor/qpdf/qpdf.wasm');

const OUT_OF_MEMORY = /out of memory|\bOOM\b|allocation failed|Cannot enlarge memory|memory access out of bounds|Maximum call stack|VMerror/i;

class Failure extends Error {
  constructor(code, detail = '') {
    super(code);
    this.code = code;
    this.detail = String(detail).slice(0, 300);
  }
}

function classify(error) {
  if (error instanceof Failure) return error;
  const text = `${error?.name ?? ''} ${error?.message ?? error}`;
  if (error instanceof RangeError || OUT_OF_MEMORY.test(text)) return new Failure('out-of-memory', text);
  if (error?.name === 'NotReadableError' || error?.name === 'NotFoundError') return new Failure('file-read', text);
  return new Failure('engine-failed', text);
}

let createQpdf = null;

function loadQpdfScript() {
  if (createQpdf) return createQpdf;
  try {
    importScripts(QPDF_JS);
  } catch (error) {
    throw new Failure('engine-load', error?.message);
  }
  createQpdf = self.Module;
  return createQpdf;
}

// Esta build ignora print/printErr e fixa a saída em console.log/error, então a
// captura usa FS.init. O Blob entra por WORKERFS, sem cópia para a memória, com
// nome interno fixo: o nome original do arquivo não chega ao motor.
async function qpdf(args, blob) {
  const factory = loadQpdfScript();
  let out = '';
  let err = '';
  const collect = (add) => (c) => { if (c !== null) add(String.fromCharCode(c)); };

  let Module;
  try {
    Module = await factory({
      locateFile: () => QPDF_WASM,
      noInitialRun: true,
      preRun: [(m) => m.FS.init(null, collect((s) => { out += s; }), collect((s) => { err += s; }))],
    });
  } catch (error) {
    throw new Failure('engine-load', error?.message ?? error);
  }

  Module.FS.mkdir('/w');
  Module.FS.mount(Module.WORKERFS, { blobs: [{ name: 'in.pdf', data: blob }] }, '/w');
  const code = Module.callMain([...args, '/w/in.pdf']);
  return { code, out: out.trim(), err: err.trim() };
}

const parsePages = (text) => {
  const pages = Number.parseInt(text, 10);
  return Number.isInteger(pages) && pages > 0 ? pages : null;
};

async function hasPdfSignature(file) {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  return String.fromCharCode(...head).includes('%PDF-');
}

// Formulário, assinatura e criptografia se perdem na regravação. Detectar antes
// permite avisar o usuário enquanto ainda há o que decidir.
function detectLosses(json) {
  const fields = json.acroform?.fields ?? [];
  const signatures = fields.filter((field) => String(field.fieldtype) === '/Sig').length;
  return {
    formFields: fields.length - signatures,
    signatures,
    encrypted: Boolean(json.encrypt?.encrypted),
  };
}

// Tags e PDF/A também se perdem na regravação (medido em tests/fixtures-src). Os dois
// ficam no catálogo do PDF, que o qpdf lê sem carregar o documento na memória.
async function detectCatalogLosses(file) {
  const trailer = await qpdf(['--show-object=trailer'], file);
  const root = /\/Root (\d+) (\d+) R/.exec(trailer.out);
  if (!root) return { tagged: false, pdfa: false };

  const catalog = await qpdf([`--show-object=${root[1]},${root[2]}`], file);
  const metadata = /\/Metadata (\d+) (\d+) R/.exec(catalog.out);
  let pdfa = false;
  if (metadata) {
    const xmp = await qpdf([`--show-object=${metadata[1]},${metadata[2]}`, '--filtered-stream-data'], file);
    pdfa = /pdfaid:part/.test(xmp.out);
  }
  return { tagged: /\/StructTreeRoot\b/.test(catalog.out), pdfa };
}

async function analyze({ file }) {
  if (!(await hasPdfSignature(file))) throw new Failure('not-pdf');

  // --requires-password não serve: nesta build ele retorna 2 em PDF protegido,
  // o mesmo código de um PDF sem senha. --show-npages distingue os três casos.
  const count = await qpdf(['--show-npages'], file);
  if (/invalid password/i.test(count.err)) throw new Failure('password');
  const pages = parsePages(count.out);
  if (count.code === 2 || pages === null) throw new Failure('invalid', count.err);

  const details = await qpdf(['--json', '--json-key=acroform', '--json-key=encrypt'], file);
  let losses;
  try {
    losses = detectLosses(JSON.parse(details.out));
  } catch {
    throw new Failure('invalid', details.err);
  }
  return { pages, ...losses, ...(await detectCatalogLosses(file)) };
}

async function loadGhostscript(onLine) {
  let exitCode = null;
  const log = (line) => onLine(line);
  try {
    const factory = (await import(GS_JS)).default;
    const Module = await factory({
      locateFile: (name) => (name.endsWith('.wasm') ? GS_WASM : name),
      print: log,
      printErr: log,
      onExit: (code) => { exitCode = code; },
    });
    return { Module, exit: (returned) => exitCode ?? returned };
  } catch (error) {
    throw new Failure('engine-load', error?.message ?? error);
  }
}

async function compress({ file, preset, pages, minReductionPercent }) {
  postMessage({ type: 'stage', stage: 'loading-engine' });

  const log = [];
  let gs = await loadGhostscript((line) => {
    const match = /^Page (\d+)/.exec(line);
    if (match) {
      postMessage({ type: 'page', page: Number(match[1]), pages });
    } else if (log.length < 200) {
      log.push(line);
    }
  });

  postMessage({ type: 'stage', stage: 'compressing' });
  gs.Module.FS.writeFile('/in.pdf', new Uint8Array(await file.arrayBuffer()));

  let code;
  try {
    code = gs.exit(gs.Module.callMain([
      '-sDEVICE=pdfwrite',
      `-dPDFSETTINGS=/${preset}`,
      // Sem isto, parte dos JPEGs copiados perde o marcador EOI (ver README).
      '-dPassThroughJPEGImages=false',
      '-dSAFER',
      '-dNOPAUSE',
      '-dBATCH',
      '-sOutputFile=/out.pdf',
      '/in.pdf',
    ]));
  } catch (error) {
    if (typeof error?.status !== 'number') throw error;
    code = error.status;
  }

  const logText = log.join('\n');
  if (code !== 0) {
    throw OUT_OF_MEMORY.test(logText)
      ? new Failure('out-of-memory', logText)
      : new Failure('compress-failed', `codigo ${code}: ${logText}`);
  }

  // O Ghostscript tolera conteúdo defeituoso e continua. O documento pode ter sido
  // regravado sem parte do conteúdo, então isso precisa chegar ao usuário.
  const repairedErrors = log.filter((line) => /\*\*\*\*|\berror\b/i.test(line)).length;

  const output = new Blob([gs.Module.FS.readFile('/out.pdf')], { type: 'application/pdf' });
  gs = null; // libera o heap do Ghostscript antes de validar a saída

  const originalSize = file.size;
  const finalSize = output.size;
  const reductionPercent = +(100 * (1 - finalSize / originalSize)).toFixed(1);
  const base = { originalSize, finalSize, reductionPercent, pages, repairedErrors };

  if (reductionPercent < minReductionPercent) return { status: 'no-gain', ...base };

  postMessage({ type: 'stage', stage: 'validating-output' });
  const check = await qpdf(['--check'], output);
  if (check.code === 2) throw new Failure('output-invalid', check.err);

  const count = await qpdf(['--show-npages'], output);
  if (parsePages(count.out) !== pages) {
    throw new Failure('output-invalid', `paginas: ${pages} -> ${count.out}`);
  }

  // O Blob vale depois do fim do Worker e cruza a fronteira sem copiar bytes.
  return { status: 'completed', blob: output, ...base };
}

const TASKS = { analyze, compress };

onmessage = async ({ data }) => {
  try {
    postMessage({ type: 'result', result: await TASKS[data.task](data) });
  } catch (error) {
    const failure = classify(error);
    postMessage({ type: 'failure', code: failure.code, detail: failure.detail });
  }
};
