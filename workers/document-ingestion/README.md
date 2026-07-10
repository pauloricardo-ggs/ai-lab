# document-ingestion

Responsavel por ler documentos enviados, extrair texto, normalizar conteudo e quebrar em chunks.

## Formatos Esperados

- PDF
- DOCX
- XLSX
- PPTX
- TXT
- Markdown
- HTML

## Saida

- registros em `documents`
- registros em `document_chunks`
- eventos para `embedding-worker`

## Regras

- toda entrada deve conter `workspace_id`
- chunks devem preservar fonte e metadados suficientes para citacao
- nenhuma escrita deve ocorrer fora do workspace informado

