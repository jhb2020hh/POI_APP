const BASE_URL = process.env.LOADTEST_URL ?? "http://localhost:3001";
const email = process.argv[2];
const password = process.argv[3];
const CONCURRENCY = Number(process.argv[4] ?? 200);
const TOTAL = Number(process.argv[5] ?? 2000);

if (!email || !password) {
  console.error(
    "Verwendung: npm run loadtest:points -w packages/backend -- <email> <passwort> [concurrency] [total]"
  );
  process.exit(1);
}

const MINIMAL_PDF = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 20 >>
stream
BT /F1 24 Tf ET
endstream
endobj
xref
0 5
0000000000 65535 f
trailer
<< /Size 5 /Root 1 0 R >>
startxref
0
%%EOF
`;

async function login(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login fehlgeschlagen: HTTP ${res.status}`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

async function createProjectAndPlan(token: string): Promise<string> {
  const authHeaders = { Authorization: `Bearer ${token}` };

  const projectRes = await fetch(`${BASE_URL}/api/projects`, {
    method: "POST",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ name: `Lasttest-${Date.now()}`, projectNumber: `LT-${Date.now()}` }),
  });
  if (!projectRes.ok) throw new Error(`Projekt anlegen fehlgeschlagen: HTTP ${projectRes.status}`);
  const project = (await projectRes.json()) as { id: string };

  const formData = new FormData();
  formData.append("name", "Lasttest-Plan");
  formData.append(
    "file",
    new Blob([MINIMAL_PDF], { type: "application/pdf" }),
    "loadtest.pdf"
  );
  const planRes = await fetch(`${BASE_URL}/api/projects/${project.id}/plans`, {
    method: "POST",
    headers: authHeaders,
    body: formData,
  });
  if (!planRes.ok) throw new Error(`Plan anlegen fehlgeschlagen: HTTP ${planRes.status}`);
  const plan = (await planRes.json()) as { id: string };
  return plan.id;
}

async function run(): Promise<void> {
  console.log(`Login als ${email} ...`);
  const token = await login();
  console.log("Lege Lasttest-Projekt und -Plan an ...");
  const planId = await createProjectAndPlan(token);
  console.log(`Plan bereit: ${planId}. Starte Lasttest (Concurrency=${CONCURRENCY}, Total=${TOTAL}) ...`);

  let completed = 0;
  let failed = 0;
  let conflicted = 0;
  let next = 0;
  const latencies: number[] = [];

  async function worker(): Promise<void> {
    while (next < TOTAL) {
      const i = next++;
      const start = performance.now();
      try {
        const res = await fetch(`${BASE_URL}/api/points`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: crypto.randomUUID(),
            planId,
            x: Math.random(),
            y: Math.random(),
            title: `Lasttest-Punkt-${i}`,
            pointType: i % 5 === 0 ? "clarification" : "defect",
          }),
        });
        latencies.push(performance.now() - start);
        if (res.status === 201) {
          completed++;
        } else if (res.status === 409) {
          conflicted++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }
  }

  const start = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const durationSec = (performance.now() - start) / 1000;

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] ?? 0;

  console.log(`Requests: ${TOTAL}, Concurrency: ${CONCURRENCY}`);
  console.log(`Erfolgreich: ${completed}, Konflikt (409): ${conflicted}, Fehlgeschlagen: ${failed}`);
  console.log(`Dauer: ${durationSec.toFixed(2)}s`);
  console.log(`Durchsatz: ${(completed / durationSec).toFixed(1)} Punkte/Sekunde`);
  console.log(`Latenz p50/p95/p99: ${p50.toFixed(1)}ms / ${p95.toFixed(1)}ms / ${p99.toFixed(1)}ms`);
}

run();
