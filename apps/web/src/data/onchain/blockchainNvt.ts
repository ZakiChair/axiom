const BASE = "https://api.blockchain.info/charts";
const DAY_MS = 86_400_000;
const MARKET_CAP_CHART = "market-cap";
const VOLUME_CHART = "estimated-transaction-volume-usd";

export interface NvtPoint {
  time: number;
  value: number;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function parseBlockchainChart(json: unknown): NvtPoint[] {
  const values = (json as { values?: unknown } | null)?.values;
  if (!Array.isArray(values)) return [];

  const points: NvtPoint[] = [];
  for (const raw of values) {
    if (raw === null || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const seconds = finiteNumber(row["x"]);
    const value = finiteNumber(row["y"]);
    if (seconds === undefined || value === undefined) continue;
    const time = seconds * 1000;
    if (!Number.isFinite(time)) continue;
    points.push({ time, value });
  }
  return points.sort((a, b) => a.time - b.time || a.value - b.value);
}

function utcDay(time: number): number {
  return Math.floor(time / DAY_MS) * DAY_MS;
}

function latestPointByUtcDay(points: readonly NvtPoint[]): Map<number, NvtPoint> {
  const byDay = new Map<number, NvtPoint>();
  for (const point of points) {
    if (!Number.isFinite(point.time) || !Number.isFinite(point.value)) continue;
    const day = utcDay(point.time);
    const previous = byDay.get(day);
    if (
      previous === undefined ||
      point.time > previous.time ||
      (point.time === previous.time && point.value > previous.value)
    ) {
      byDay.set(day, point);
    }
  }
  return byDay;
}

export function calculateNvtHistory(
  marketCaps: readonly NvtPoint[],
  transactionVolumes: readonly NvtPoint[],
): NvtPoint[] {
  const marketCapByDay = latestPointByUtcDay(marketCaps);
  const volumeByDay = latestPointByUtcDay(transactionVolumes);
  const points: NvtPoint[] = [];

  for (const [time, volume] of volumeByDay) {
    const marketCap = marketCapByDay.get(time);
    if (marketCap === undefined || volume.value <= 0) continue;
    const value = marketCap.value / volume.value;
    if (Number.isFinite(value)) points.push({ time, value });
  }
  return points.sort((a, b) => a.time - b.time);
}

function buildQuery(since: number): { query: string; firstDay: number } {
  const now = Date.now();
  if (!Number.isFinite(since) || since < 0 || since > now) {
    throw new Error("Blockchain.info NVT since invalide");
  }
  const firstDay = utcDay(since);
  const days = Math.max(1, Math.ceil((now - firstDay) / DAY_MS));
  const query = new URLSearchParams({
    start: new Date(firstDay).toISOString().slice(0, 10),
    timespan: `${days}days`,
    format: "json",
    sampled: "false",
    cors: "true",
  }).toString();
  return { query, firstDay };
}

async function fetchChart(chart: string, query: string, signal?: AbortSignal): Promise<NvtPoint[]> {
  const response = await fetch(`${BASE}/${chart}?${query}`, { signal });
  if (!response.ok) throw new Error(`Blockchain.info ${chart} HTTP ${response.status}`);

  let json: unknown;
  try {
    json = (await response.json()) as unknown;
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(`Blockchain.info ${chart} JSON inutilisable`);
  }
  const status =
    json !== null && typeof json === "object"
      ? (json as Record<string, unknown>)["status"]
      : undefined;
  const points = parseBlockchainChart(json);
  if (status !== "ok" || points.length === 0) {
    throw new Error(`Blockchain.info ${chart} format inutilisable`);
  }
  return points;
}

export async function fetchNvtHistory(since: number, signal?: AbortSignal): Promise<NvtPoint[]> {
  const { query, firstDay } = buildQuery(since);
  const [marketCaps, transactionVolumes] = await Promise.all([
    fetchChart(MARKET_CAP_CHART, query, signal),
    fetchChart(VOLUME_CHART, query, signal),
  ]);
  const points = calculateNvtHistory(marketCaps, transactionVolumes).filter(
    (point) => point.time >= firstDay,
  );
  if (points.length === 0) throw new Error("Blockchain.info NVT format inutilisable");
  return points;
}
