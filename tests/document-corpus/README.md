# Corpus documental de validação

Corpus pequeno, determinístico e sem dados pessoais para validar regressões de extração/OCR e citações. `digital-policy.html` representa documento com camada textual; `scanned-invoice.svg` é uma imagem (texto desenhado) que exige OCR quando rasterizada/enviada ao Docling.

O arquivo `expected.json` define termos obrigatórios, páginas e citações esperadas. `extracted-baseline.json` registra a saída aprovada do corpus. Para validar uma nova execução do Docling, serialize o texto/páginas no mesmo formato e execute:

```bash
node tests/validate-document-corpus.mjs tests/document-corpus/extracted-baseline.json
node tests/validate-document-corpus.mjs /tmp/docling-extracted.json
```

Uma citação é aceita somente se tiver `document_id`, `source`, `page >= 1`, `chunk_id`, trecho não vazio e se o trecho estiver contido no texto da página referenciada.
