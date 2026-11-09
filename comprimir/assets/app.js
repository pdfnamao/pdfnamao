// Interface: controla as telas e delega todo o processamento a engine.js.
// Textos vindos do arquivo, como o nome, entram sempre por textContent.
import { CONFIG, PROFILES } from './config.js';
import { analyze, compress } from './engine.js';

const $ = (id) => document.getElementById(id);

const VIEWS = ['select', 'analyzing', 'ready', 'processing', 'result', 'no-gain', 'error'];
const STEP_ORDER = ['validating', 'loading-engine', 'compressing', 'validating-output'];
const STEP_STATUS = {
  'loading-engine': 'Carregando motor',
  compressing: 'Comprimindo',
  'validating-output': 'Validando resultado',
};

const state = {
  file: null,
  info: null,
  task: null,
  downloadUrl: null,
  elapsedTimer: null,
};

const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1_048_576) return `${numberFormat.format(bytes / 1024)} KB`;
  return `${numberFormat.format(bytes / 1_048_576)} MB`;
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function announce(text) {
  $('live-status').textContent = text;
}

function showView(name) {
  for (const view of VIEWS) $(`view-${view}`).hidden = view !== name;
}

function releaseDownload() {
  if (state.downloadUrl) URL.revokeObjectURL(state.downloadUrl);
  state.downloadUrl = null;
  $('download').removeAttribute('href');
}

function resetToSelect(message = '') {
  releaseDownload();
  state.file = null;
  state.info = null;
  $('file-input').value = '';
  $('select-error').textContent = message;
  $('select-error').hidden = !message;
  showView('select');
}

// ---------- Seleção e análise ----------

function renderLosses({ signatures, formFields, encrypted, tagged, pdfa }) {
  // As tags só geram aviso: Word e Chrome costumam incluí-las, e exigir confirmação
  // pararia boa parte dos documentos comuns.
  $('tags-notice').hidden = !tagged;

  const items = [];
  if (pdfa) items.push('PDF/A: o arquivo deixará de ser identificado como PDF/A, o que pode afetar exigências de arquivamento.');
  if (signatures) items.push(`Assinatura digital: ${plural(signatures, 'assinatura será removida', 'assinaturas serão removidas')}, e o documento deixará de estar assinado.`);
  if (formFields) items.push(`Formulário: ${plural(formFields, 'campo deixará', 'campos deixarão')} de ser editáveis.`);
  if (encrypted) items.push('Proteção: a criptografia e as restrições de permissão serão removidas.');

  $('losses-list').replaceChildren(...items.map((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
  $('losses').hidden = items.length === 0;
  $('losses-confirm').checked = false;
  syncStartButton();
}

function syncStartButton() {
  const blocked = !$('losses').hidden && !$('losses-confirm').checked;
  $('start').disabled = blocked;
  $('start-hint').hidden = !blocked;
}

function showReady(notice = '') {
  $('ready-notice').textContent = notice;
  $('ready-notice').hidden = !notice;
  showView('ready');
}

async function selectFile(file) {
  releaseDownload();
  state.file = file;
  showView('analyzing');
  announce('Validando arquivo');

  try {
    state.info = await analyze(file);
  } catch (error) {
    resetToSelect(error.message);
    announce(error.message);
    return;
  }

  $('ready-name').textContent = file.name;
  $('ready-details').textContent = `${formatSize(file.size)} · ${plural(state.info.pages, 'página', 'páginas')}`;
  renderLosses(state.info);
  showReady();
  announce('Arquivo pronto para compressão');
}

// ---------- Processamento ----------

function setActiveStep(step) {
  const active = STEP_ORDER.indexOf(step);
  for (const li of $('steps').children) {
    const index = STEP_ORDER.indexOf(li.dataset.step);
    li.classList.toggle('is-done', index < active);
    li.classList.toggle('is-active', index === active);
    if (index === active) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  }
  $('progress').hidden = step !== 'compressing';
  $('validation-hint').hidden = step !== 'validating-output';
  if (STEP_STATUS[step]) announce(STEP_STATUS[step]);
}

function setPageProgress(page, pages) {
  const percent = Math.min(100, Math.round((100 * page) / pages));
  $('page-progress').textContent = `página ${page} de ${pages}`;
  $('progress-bar').style.width = `${percent}%`;
  $('progress').setAttribute('aria-valuenow', String(percent));
}

function startElapsed() {
  const started = Date.now();
  const render = () => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    $('elapsed').textContent = `${mm}:${ss}`;
  };
  render();
  state.elapsedTimer = setInterval(render, 1000);
}

function stopElapsed() {
  clearInterval(state.elapsedTimer);
  state.elapsedTimer = null;
}

const selectedProfile = () => document.querySelector('input[name="profile"]:checked').value;

async function startCompression() {
  const profile = selectedProfile();
  releaseDownload();
  $('page-progress').textContent = '';
  $('progress-bar').style.width = '0%';
  $('progress').setAttribute('aria-valuenow', '0');
  setActiveStep('loading-engine');
  showView('processing');
  startElapsed();

  try {
    state.task = compress(state.file, {
      profile,
      pages: state.info.pages,
      onStage: setActiveStep,
      onPage: setPageProgress,
    });
    const result = await state.task.promise;
    if (result.status === 'completed') showResult(result, profile);
    else showNoGain(result);
  } catch (error) {
    if (error.code === 'cancelled') {
      showReady('Compressão cancelada. Nenhum arquivo foi gerado.');
      announce('Compressão cancelada');
    } else {
      showError(error);
    }
  } finally {
    state.task = null;
    stopElapsed();
  }
}

// ---------- Resultados ----------

function outputName(name) {
  return `${name.replace(/\.pdf$/i, '')}-comprimido.pdf`;
}

function showResult(result, profile) {
  const percent = numberFormat.format(result.reductionPercent);
  $('result-title').textContent = `${percent}% menor`;
  $('result-file').textContent = `${state.file.name} · Nível ${PROFILES[profile].label.toLowerCase()} · ${plural(result.pages, 'página', 'páginas')}`;
  $('size-original').textContent = formatSize(result.originalSize);
  $('size-final').textContent = formatSize(result.finalSize);
  // Mínimo de 1% só para a barra continuar visível em reduções muito grandes.
  $('bar-final').style.width = `${Math.max(1, (100 * result.finalSize) / result.originalSize)}%`;
  $('result-repaired').hidden = result.repairedErrors === 0;

  state.downloadUrl = URL.createObjectURL(result.blob);
  $('download').href = state.downloadUrl;
  $('download').download = outputName(state.file.name);

  showView('result');
  announce(`Concluído. O arquivo ficou ${percent}% menor.`);
}

function showNoGain(result) {
  $('no-gain-details').textContent = `Original: ${formatSize(result.originalSize)} · Resultado: ${formatSize(result.finalSize)}`;
  $('no-gain-repaired').hidden = result.repairedErrors === 0;
  showView('no-gain');
  announce('Não houve redução vantajosa');
}

function showError(error) {
  $('error-message').textContent = error.message;
  showView('error');
  announce(error.message);
}

// ---------- Eventos ----------

function bindDropzone() {
  const zone = $('dropzone');

  // Soltar fora da área abriria o PDF na aba e descartaria a página.
  for (const type of ['dragover', 'drop']) {
    document.addEventListener(type, (event) => event.preventDefault());
  }

  zone.addEventListener('dragover', () => zone.classList.add('is-over'));
  zone.addEventListener('dragleave', (event) => {
    if (!zone.contains(event.relatedTarget)) zone.classList.remove('is-over');
  });
  zone.addEventListener('drop', (event) => {
    zone.classList.remove('is-over');
    const { files } = event.dataTransfer;
    if (files.length > 1) {
      resetToSelect('Solte um arquivo por vez.');
    } else if (files.length === 1) {
      selectFile(files[0]);
    }
  });
}

function bindActions() {
  $('file-input').addEventListener('change', (event) => {
    const [file] = event.target.files;
    if (file) selectFile(file);
  });
  $('change-file').addEventListener('click', () => resetToSelect());
  $('losses-confirm').addEventListener('change', syncStartButton);
  $('start').addEventListener('click', startCompression);
  $('cancel').addEventListener('click', () => state.task?.cancel());

  document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'new-file') {
      resetToSelect();
    } else if (action === 'other-profile') {
      releaseDownload();
      showReady();
    }
  });
}

function isMobileDevice() {
  return Boolean(navigator.userAgentData?.mobile) || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
}

// No Firefox, medimos compressão de 5 a 6 vezes mais lenta; o Safari não foi testado.
// O aviso não bloqueia: arquivos pequenos funcionaram no Firefox.
function isNonRecommendedBrowser() {
  const ua = navigator.userAgent;
  return /Firefox\//.test(ua) || (/Safari\//.test(ua) && !/Chrom(e|ium)\//.test(ua));
}

function init() {
  $('notice-browser').hidden = isMobileDevice() || !isNonRecommendedBrowser();
  $('max-size').textContent = `Tamanho máximo: ${CONFIG.MAX_FILE_MB} MB`;
  document.querySelector(`input[name="profile"][value="${CONFIG.DEFAULT_PROFILE}"]`).checked = true;

  if (CONFIG.SOURCE_URL) {
    $('source-link').href = CONFIG.SOURCE_URL;
    $('source-link').hidden = false;
  }

  if (isMobileDevice()) {
    $('notice-mobile').hidden = false;
    $('view-select').hidden = true;
    return;
  }

  bindDropzone();
  bindActions();
}

init();
