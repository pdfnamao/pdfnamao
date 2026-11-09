# PDF na Mão: Comprimir

Compressor de PDF que roda **no próprio navegador**. O arquivo nunca é enviado a um servidor: o Ghostscript e o qpdf rodam em WebAssembly, em um Web Worker, e a memória é liberada ao fim de cada tarefa.

Este repositório é o código-fonte da ferramenta **Comprimir** do PDF na Mão, oferecido conforme a licença AGPL. As outras ferramentas e páginas do site são programas separados e não fazem parte dele.

## Executar

Requer Node.js, usado só para o servidor local. Os motores já estão em `comprimir/vendor/`.

```bash
npm run serve    # http://127.0.0.1:8080/comprimir/
```

Os links do cabeçalho para as outras páginas do site não abrem nesta cópia, porque essas páginas não fazem parte dela.

Navegador recomendado: Chrome para computador. Celulares e tablets não são compatíveis.

## Publicar

Publique a pasta `comprimir/`. A configuração do servidor precisa de:

- `.wasm` servido como `application/wasm`;
- política de segurança (CSP) e `X-Content-Type-Options: nosniff` no **cabeçalho HTTP**, porque a CSP do HTML não alcança o Worker.

Há exemplos em `deploy/.htaccess` (Apache) e `deploy/_headers` (Cloudflare). No Apache, a pasta precisa de `AllowOverride All` e do `mod_headers`.

As configurações ficam em `comprimir/assets/config.js`.

## Reconstruir os motores

Os arquivos em `comprimir/vendor/` vêm dos pacotes npm com as versões fixadas em `package-lock.json`:

```bash
npm ci --ignore-scripts
npm run vendor
```

O comando grava os hashes em `comprimir/vendor/VERSIONS.txt`.

Para compilar os motores a partir do código-fonte, use os repositórios indicados em `comprimir/LICENSES/NOTICE.txt`.

## Como funciona

- `comprimir/assets/app.js`: interface.
- `comprimir/assets/engine.js`: limites, tempo máximo, cancelamento e erros.
- `comprimir/assets/worker.js`: processamento. Cria um Worker novo por tarefa.
- `comprimir/assets/config.js`: configurações e níveis de compressão.

## Limitações

A compressão regrava o PDF:

- campos de formulário deixam de ser editáveis;
- assinaturas são removidas;
- a criptografia de proprietário sai do arquivo;
- as tags, o idioma e a identificação PDF/A se perdem.

A interface exige confirmação antes de continuar, exceto para tags, que geram só um aviso.

## Licença

[GNU AGPL 3.0 ou posterior](LICENSE). Componentes de terceiros e seus códigos-fonte estão em `comprimir/LICENSES/NOTICE.txt`.
