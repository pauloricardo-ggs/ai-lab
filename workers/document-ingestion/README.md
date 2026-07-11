# document-ingestion

Componente reservado para um possivel pipeline futuro de documentos tecnicos por
workspace. Nao processa arquivos enviados para Knowledge Bases do Open WebUI.

No fluxo atual de regras de negocio, o Open WebUI e a autoridade sobre bases,
arquivos, permissoes e chunks, e usa o Docling Serve somente como extrator. Nao
implementar sincronizacao do Open WebUI neste worker sem uma nova decisao de
arquitetura.

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
