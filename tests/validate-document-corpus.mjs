import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const corpus = path.join(here, "document-corpus");
const expected = JSON.parse(fs.readFileSync(path.join(corpus, "expected.json"), "utf8"));
const outputPath = path.resolve(process.argv[2] || path.join(corpus, "extracted-baseline.json"));
const actual = JSON.parse(fs.readFileSync(outputPath, "utf8"));
const normalize = (value) => String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
const failures = [];

for (const spec of expected.documents) {
  const document = actual.documents?.find((item) => item.document_id === spec.id);
  if (!document) { failures.push(`${spec.id}: documento ausente`); continue; }
  if (document.source !== spec.source) failures.push(`${spec.id}: source incorreto`);
  if ((document.pages || []).length < spec.pages) failures.push(`${spec.id}: paginas insuficientes`);
  const fullText = normalize((document.pages || []).map((page) => page.text).join(" "));
  for (const term of spec.required_terms) if (!fullText.includes(normalize(term))) failures.push(`${spec.id}: termo ausente: ${term}`);
  if (!document.citations?.length) failures.push(`${spec.id}: sem citacoes`);
  for (const citation of document.citations || []) {
    if (citation.document_id !== spec.id || citation.source !== spec.source) failures.push(`${spec.id}: identidade da citacao invalida`);
    if (!citation.chunk_id || !citation.quote || !Number.isInteger(citation.page) || citation.page < 1) failures.push(`${spec.id}: metadados da citacao invalidos`);
    const page = document.pages?.find((item) => item.page === citation.page);
    if (!page || !normalize(page.text).includes(normalize(citation.quote))) failures.push(`${spec.id}: citacao nao sustentada pela pagina ${citation.page}`);
  }
}
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log(`document corpus: ${expected.documents.length} documentos e citacoes validados`);
