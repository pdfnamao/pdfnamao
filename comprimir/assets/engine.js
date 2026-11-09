// Fronteira entre a interface e o Worker: valida o básico, aplica o timeout e
// transforma cancelamento e falhas em erros com código e mensagem.
import { CONFIG, PROFILES } from './config.js';

const WORKER_URL = new URL('./worker.js', import.meta.url);

const MESSAGES = Object.freeze({
  'invalid-extension': 'Selecione um arquivo com extensão .pdf.',
  'too-large': 'O arquivo excede o tamanho máximo permitido.',
  'not-pdf': 'O conteúdo do arquivo não é um PDF, apesar da extensão.',
  invalid: 'O PDF está corrompido ou não pôde ser lido.',
  password: 'Este PDF exige senha para ser aberto e não pode ser comprimido.',
  // O Chrome também usa este erro quando falta memória para carregar o arquivo.
  'file-read': 'Não foi possível ler o arquivo. Verifique se ele ainda existe, feche outros programas e tente novamente.',
  'engine-load': 'Não foi possível carregar o motor de compressão. Recarregue a página.',
  'engine-failed': 'Ocorreu um erro inesperado durante o processamento.',
  'compress-failed': 'O motor de compressão não conseguiu processar este PDF.',
  'output-invalid': 'O resultado não passou na validação e foi descartado. O original não foi alterado.',
  'out-of-memory': 'Não há memória suficiente. Feche outros programas ou tente um arquivo menor.',
  timeout: 'O processamento excedeu o tempo máximo e foi interrompido.',
  cancelled: 'Processamento cancelado.',
  'worker-crash': 'O processamento foi interrompido inesperadamente. Tente novamente.',
});

export class EngineError extends Error {
  constructor(code, detail = '') {
    super(MESSAGES[code] ?? MESSAGES['engine-failed']);
    this.name = 'EngineError';
    this.code = code;
    this.detail = detail;
  }
}

function runTask(message, { timeoutMs = CONFIG.TIMEOUT_MS, onEvent = () => {} } = {}) {
  const worker = new Worker(WORKER_URL);
  let settle;
  let timer;

  const promise = new Promise((resolve, reject) => {
    settle = (fn, value) => {
      clearTimeout(timer);
      worker.terminate();
      settle = () => {};
      fn(value);
    };

    timer = setTimeout(() => settle(reject, new EngineError('timeout')), timeoutMs);

    worker.onmessage = ({ data }) => {
      if (data.type === 'result') settle(resolve, data.result);
      else if (data.type === 'failure') settle(reject, new EngineError(data.code, data.detail));
      else onEvent(data);
    };
    worker.onerror = (event) => settle(reject, new EngineError('worker-crash', event.message));
    worker.onmessageerror = () => settle(reject, new EngineError('worker-crash', 'messageerror'));

    worker.postMessage(message);
  });

  return { promise, cancel: () => settle(() => {}, undefined) };
}

export function checkFile(file, { maxFileMb = CONFIG.MAX_FILE_MB } = {}) {
  if (!/\.pdf$/i.test(file.name)) throw new EngineError('invalid-extension');
  if (file.size > maxFileMb * 1_048_576) throw new EngineError('too-large');
}

// Devolve { pages, formFields, signatures, encrypted, tagged, pdfa }.
export async function analyze(file, options = {}) {
  checkFile(file, options);
  return runTask({ task: 'analyze', file }, options).promise;
}

// Devolve { promise, cancel }. A promise resolve com status 'completed' (com blob)
// ou 'no-gain' (sem blob). onStage e onPage acompanham o progresso real.
// `pages` vem de analyze() e é a referência para validar a saída.
export function compress(file, { profile = CONFIG.DEFAULT_PROFILE, pages, onStage, onPage, ...options } = {}) {
  const selected = Object.hasOwn(PROFILES, profile) ? PROFILES[profile] : null;
  if (!selected) throw new TypeError(`Perfil desconhecido: ${profile}`);
  if (!Number.isInteger(pages) || pages < 1) throw new TypeError('compress() exige o total de páginas de analyze().');
  checkFile(file, options);

  let rejectCancelled;
  const task = runTask(
    {
      task: 'compress',
      file,
      preset: selected.preset,
      pages,
      minReductionPercent: options.minReductionPercent ?? CONFIG.MIN_REDUCTION_PERCENT,
    },
    {
      timeoutMs: options.timeoutMs,
      onEvent: (event) => {
        if (event.type === 'stage') onStage?.(event.stage);
        else if (event.type === 'page') onPage?.(event.page, event.pages);
      },
    },
  );

  const promise = new Promise((resolve, reject) => {
    rejectCancelled = reject;
    task.promise.then(resolve, reject);
  });

  return {
    promise,
    cancel: () => {
      task.cancel();
      rejectCancelled(new EngineError('cancelled'));
    },
  };
}
