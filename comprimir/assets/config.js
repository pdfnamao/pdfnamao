// Configurações da aplicação. Os valores vêm das medições da Fase 1 (ver README).
export const CONFIG = Object.freeze({
  // 200 MB deixam folga em 3,9 GB de RAM com outros programas abertos.
  MAX_FILE_MB: 200,
  TIMEOUT_MS: 600_000,
  DEFAULT_PROFILE: 'recommended',
  // Abaixo deste ganho, não compensa regravar o documento com perda.
  MIN_REDUCTION_PERCENT: 1,
  SOURCE_URL: 'https://github.com/pdfnamao/pdfnamao',
});

// Os presets são fixos: nenhum valor do usuário chega à linha de comando.
export const PROFILES = Object.freeze({
  light: Object.freeze({ preset: 'printer', label: 'Leve' }),
  recommended: Object.freeze({ preset: 'ebook', label: 'Recomendado' }),
  high: Object.freeze({ preset: 'screen', label: 'Alto' }),
});
