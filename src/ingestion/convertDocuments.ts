// Converts PDFs with docling-serve on the GPU node, one at a time: submit a book,
// poll until it's done, save the result, then submit the next. Running them in
// sequence keeps GPU memory predictable (each Docling worker loads its own models),
// and saving straight away matters because results can be downloaded only once
// and expire after DOCLING_SERVE_RESULT_REMOVAL_DELAY (1 hour on the node).
// Books whose output already exists are skipped, so the queue can be re-run.
// Requires the node in ingest mode (Docling + the vision model).
// Usage: npm run convert:documents
import { access, readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

const DOCLING = process.env.DOCLING_URL!;
// Docling's container calls the vision model itself, so this must be an address
// the container can reach (the node's Tailscale IP, not its MagicDNS name).
const VISION_URL = process.env.DOCLING_VISION_URL!;
const POLL_SECONDS = 30;

type Job = { pdf: string; out: string; formulas: boolean; figurePrompt: string };

const JOBS: Job[] = [
  {
    pdf: "data/data_intensive_apps_book.pdf",
    out: "out/ddia.json",
    formulas: false, // almost no equations; formula enrichment is the slowest step
    figurePrompt:
      "Describe this figure from a book on data systems: what it shows, the components and how they connect, and any labels. Be factual and concise.",
  },
  {
    pdf: "data/algo_trading_book.pdf",
    out: "out/algo-trading.json",
    formulas: true, // stochastic calculus throughout
    figurePrompt:
      "Describe this figure from a book on algorithmic trading: what it shows, the quantities plotted, axes and labels. Be factual and concise.",
  },
];

const log = (message: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);
const exists = (path: string) => access(path).then(() => true, () => false);

async function submit(job: Job): Promise<string> {
  const form = new FormData();
  form.append("files", new Blob([await readFile(job.pdf)], { type: "application/pdf" }), basename(job.pdf));
  for (const [key, value] of [
    ["to_formats", "json"],
    ["to_formats", "md"],
    ["do_ocr", "false"], // the PDFs have a text layer
    ["do_formula_enrichment", String(job.formulas)],
    ["do_picture_description", "true"],
    [
      "picture_description_api",
      JSON.stringify({
        url: VISION_URL,
        params: { model: "Qwen/Qwen3-VL-4B-Instruct-FP8", max_completion_tokens: 300 },
        timeout: 120,
        concurrency: 4,
        prompt: job.figurePrompt,
      }),
    ],
  ]) {
    form.append(key, value);
  }
  const response = await fetch(`${DOCLING}/v1/convert/file/async`, { method: "POST", body: form });
  if (!response.ok) throw new Error(`submit ${job.pdf}: ${response.status} ${await response.text()}`);
  return ((await response.json()) as { task_id: string }).task_id;
}

async function waitFor(taskId: string): Promise<void> {
  for (;;) {
    const response = await fetch(`${DOCLING}/v1/status/poll/${taskId}`);
    const { task_status } = (await response.json()) as { task_status: string };
    if (task_status === "success") return;
    if (task_status === "failure") throw new Error(`task ${taskId} failed`);
    await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
  }
}

for (const job of JOBS) {
  if (await exists(job.out)) {
    log(`skip ${job.pdf}: ${job.out} already exists`);
    continue;
  }
  const started = Date.now();
  const taskId = await submit(job);
  log(`submitted ${job.pdf} (task ${taskId})`);
  await waitFor(taskId);
  const result = await fetch(`${DOCLING}/v1/result/${taskId}`);
  if (!result.ok) throw new Error(`result ${taskId}: ${result.status}`);
  await writeFile(job.out, Buffer.from(await result.arrayBuffer()));
  log(`saved ${job.out} after ${Math.round((Date.now() - started) / 60000)} min`);
}
log("all documents converted");
