const BASE_URL = process.env.LOADTEST_URL ?? "http://localhost:3001";
const CONCURRENCY = Number(process.argv[2] ?? 20);
const TOTAL = Number(process.argv[3] ?? 500);

async function fireOne(): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/debug/loadtest-write`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
}

async function run(): Promise<void> {
  let completed = 0;
  let failed = 0;
  let next = 0;

  async function worker(): Promise<void> {
    while (next < TOTAL) {
      next++;
      try {
        await fireOne();
        completed++;
      } catch {
        failed++;
      }
    }
  }

  const start = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const durationSec = (performance.now() - start) / 1000;

  console.log(`Requests: ${TOTAL}, Concurrency: ${CONCURRENCY}`);
  console.log(`Completed: ${completed}, Failed: ${failed}`);
  console.log(`Duration: ${durationSec.toFixed(2)}s`);
  console.log(`Throughput: ${(completed / durationSec).toFixed(1)} writes/sec`);
}

run();
