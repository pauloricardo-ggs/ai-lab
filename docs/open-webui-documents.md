# Documentos e bases de conhecimento no Open WebUI

## Responsabilidades e isolamento

O Open WebUI e a autoridade sobre documentos de negocio. Ele controla usuarios,
permissoes, bases de conhecimento, arquivos, chunks e recuperacao. O Admin Panel
continua dedicado a workspaces tecnicos, repositorios e codigo.

Nao existe vinculo implicito entre uma Knowledge Base do Open WebUI e um
`workspace_id` do Admin Panel. O fluxo documental tambem nao depende do Knowledge
MCP nem grava nas tabelas locais `documents` e `document_chunks`.
Nao existe Knowledge MCP no runtime: agentes tecnicos consultam apenas codigo e Git local pelo Gateway. Consultas documentais devem acontecer pela interface/API e pelos controles de acesso do proprio Open WebUI.

Quando um arquivo e adicionado a uma base, o Open WebUI preserva a relacao entre a
base (`knowledge_id`) e o arquivo (`file_id`). O Docling apenas converte o arquivo
em conteudo estruturado; ele nao escolhe a base, nao gera permissoes e nao grava
diretamente no Qdrant. Portanto, a melhoria de extracao nao altera o isolamento
entre bases de conhecimento.

## Fluxo

```text
usuario -> Knowledge Base do Open WebUI -> arquivo
                                      |
                                      v
                              Docling Serve
                     layout + tabelas + OCR seletivo
                                      |
                                      v
                       Open WebUI cria chunks e vetores
                                      |
                                      v
                         Qdrant administrado pelo Open WebUI
```

O parser tenta aproveitar a camada textual de PDFs digitais e usa OCR nas paginas
ou imagens que precisarem. `force_ocr=false` evita refazer por OCR um PDF digital
inteiro, o que reduz tempo e costuma preservar melhor o texto original.

## Servicos e configuracao padrao

O Compose executa `ai-docling` na rede privada `ai-platform` e publica a porta
5001 para diagnostico. Os artefatos/modelos ficam em `data/docling`.

Configuracao recomendada em `.env`:

```dotenv
DOCLING_IMAGE=quay.io/docling-project/docling-serve:v1.18.0
DOCLING_PORT=5001
CONTENT_EXTRACTION_ENGINE=docling
DOCLING_SERVER_URL=http://docling:5001
DOCLING_PARAMS={"do_ocr":true,"force_ocr":false,"ocr_engine":"easyocr","ocr_lang":["pt","en"],"pdf_backend":"dlparse_v4","table_mode":"accurate","pipeline":"standard"}
DOCLING_MAX_SYNC_WAIT=600
DOCLING_NUM_WORKERS=1
DOCLING_CPU_THREADS=4
RAG_EMBEDDING_ENGINE=ollama
ENABLE_RAG_HYBRID_SEARCH=true
ENABLE_RAG_HYBRID_SEARCH_ENRICHED_TEXTS=true
```

`UVICORN_WORKERS` permanece fixo em `1`: o orquestrador local do Docling mantem
jobs em memoria e varios workers podem fazer uma consulta de status chegar a um
processo diferente daquele que criou o job.

`DOCLING_NUM_WORKERS` controla os motores de conversao e pode ser aumentado com
cuidado. `DOCLING_CPU_THREADS` controla os threads usados por cada processo.

## Instalacao nova

O `install.sh` cria `data/docling`, inclui as variaveis e sobe o novo servico. A
primeira conversao pode demorar enquanto o Docling prepara seus modelos.

Depois da instalacao:

1. acesse `http://<host>:5001/ui` e converta um arquivo simples;
2. crie duas bases de conhecimento no Open WebUI;
3. envie documentos diferentes para cada base;
4. confirme que cada arquivo aparece apenas na base escolhida;
5. consulte cada base separadamente e valide as citacoes.

## Atualizacao de uma instalacao existente

Execute novamente `./install.sh`, escolha atualizar o `.env` e mantenha ou ajuste
os novos valores. Alternativamente, copie as variaveis acima para o `.env` e rode:

```bash
mkdir -p data/docling
docker compose pull docling
docker compose up -d docling open-webui
./scripts/check-health.sh
```

As configuracoes de Documents do Open WebUI sao persistentes. Em uma instancia
que ja teve essas opcoes salvas no banco, o valor salvo pode prevalecer sobre o
novo default do ambiente. Nesse caso, acesse **Admin Panel -> Settings ->
Documents** e confirme:

- Content extraction engine: `Docling`;
- Docling server URL: `http://docling:5001`;
- OCR habilitado;
- Force OCR desabilitado;
- OCR engine: `easyocr`;

## Validação de OCR e citações

O corpus de regressão fica em `tests/document-corpus/` e inclui documento digital e imagem para OCR, com termos e citações esperados. Rode `node tests/validate-document-corpus.mjs` no baseline ou informe uma saída nova do Docling no formato documentado no README do corpus. Essa validação rejeita citação sem documento, fonte, página, chunk ou trecho sustentado pelo texto extraído.
- idiomas: `pt` e `en`;
- PDF backend: `dlparse_v4`;
- table mode: `accurate`.

Essa confirmacao nao move nem recria bases existentes. Para aproveitar a extracao
nova, arquivos processados anteriormente precisam ser reprocessados pelo Open
WebUI; um novo extrator nao altera chunks ja armazenados.

## Embeddings e busca

O Open WebUI usa o Ollama com `EMBEDDING_MODEL` (por padrao,
`qwen3-embedding:0.6b`). Nao troque o modelo em uma base ja indexada sem reprocessar
seus arquivos: vetores gerados por modelos ou dimensoes diferentes nao sao
comparaveis.

A busca hibrida combina correspondencia lexical e vetorial. A opcao de textos
enriquecidos inclui metadados como nome, titulo e secoes no indice lexical, o que
ajuda consultas por identificadores e nomes exatos. Reranking nao foi habilitado
por padrao porque carregaria mais um modelo local e aumentaria o consumo de RAM.

## Imagens e informacoes visuais

OCR recupera texto presente em imagens, mas nao interpreta graficos, diagramas ou
fotografias. O Docling oferece descricao de figuras por modelo visual, porem isso
fica desabilitado por padrao para nao baixar outro modelo grande nem aumentar a
latencia sem dimensionamento previo.

Caso seja habilitado no Open WebUI, prefira primeiro o modo local. O modo API
exige habilitar explicitamente `DOCLING_SERVE_ENABLE_REMOTE_SERVICES=true` no
servico Docling e configurar um modelo visual compativel no Ollama. Essa mudanca
deve ser avaliada quanto a CPU/GPU, RAM e tempo maximo de processamento.

## Diagnostico

```bash
docker compose ps docling open-webui
docker compose logs --tail=200 docling open-webui
curl -fsS http://localhost:5001/docs >/dev/null
```

Problemas comuns:

- `404` em `/v1/convert/file`: versoes incompativeis entre Open WebUI e Docling;
- job nao encontrado: confirme `UVICORN_WORKERS=1`;
- timeout em PDF grande: aumente `DOCLING_MAX_SYNC_WAIT`;
- OCR ruim: confirme os idiomas e teste uma imagem diretamente em `/ui`;
- arquivo antigo continua ruim: reprocese-o, pois chunks existentes nao mudam;
- configuracao parece ignorada: confira os valores persistidos em Settings ->
  Documents.

## Teste de isolamento obrigatorio

Crie `KB-A` e `KB-B`. Envie para `KB-A` um arquivo contendo um marcador unico,
por exemplo `SEGREDO-ALFA-9271`, e para `KB-B` outro com
`SEGREDO-BETA-4832`. Ao consultar exclusivamente `KB-A`, o segundo marcador nao
pode ser recuperado; o inverso tambem deve valer. Execute esse teste com usuarios
e permissoes diferentes antes de disponibilizar a stack fora de homologacao.
