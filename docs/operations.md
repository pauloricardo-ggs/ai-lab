# Operacao

## Subir

```bash
docker compose up -d
```

## Parar

```bash
docker compose down
```

## Logs

```bash
docker compose logs -f
```

## Health Check

```bash
./scripts/check-health.sh
```

## Admin UI

URL padrao:

```text
http://<IP_DO_SERVIDOR>:8080
```

Use a Admin UI para:

- abrir os servicos da plataforma
- visualizar containers e status de runtime
- criar workspaces
- adicionar e remover repositorios
- testar tools do MCP Gateway

## Volumes

O PostgreSQL usa `data/postgres/db` como diretório real de dados. O diretório `data/postgres` fica reservado para metadados versionáveis como `.gitkeep`; montar esse diretório diretamente em `/var/lib/postgresql/data` faz o `initdb` falhar porque ele encontra arquivo oculto no mount point.

## Modelos Locais

O `install.sh` baixa automaticamente os modelos configurados em `LOCAL_CHAT_MODEL` e `EMBEDDING_MODEL`.

Para baixar outro modelo manualmente:

```bash
docker exec -it ai-ollama ollama pull <modelo>
```

Verifique os modelos disponiveis:

```bash
curl http://localhost:11434/api/tags
```

## Performance de indexacao e GPU

GPU acelera principalmente os embeddings executados pelo Ollama; scan de arquivos, parsing/Roslyn e escritas nos bancos continuam sendo limitados por CPU, disco e rede local. Antes de depender de GPU, acompanhe as metricas do job e ajuste os limites de chunk, timeouts e a concorrencia da fila.

Em um host com GPU e drivers compativeis, confirme nos logs do Ollama que ela foi detectada:

```bash
docker compose logs ollama
```

Mantenha GPU opcional: a stack continua suportada somente com CPU. Em hosts NVIDIA, instale o NVIDIA Container Toolkit e inicie a stack com o override opcional:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

Valide a detecção no log antes de aumentar a concorrência de indexação. O arquivo `docker-compose.gpu.yml` só reserva GPU para o Ollama e não altera os demais serviços.

## Backup

```bash
./scripts/backup.sh
```

## Upgrade de Imagens

Nunca use `latest` ou `main`.

Edite `.env` com tags fixas e execute:

```bash
docker compose pull
docker compose up -d
```
