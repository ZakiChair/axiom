/**
 * connecterBoucleWs (daemon) — boucle WS reconnectante PARTAGÉE remplaçant les deux
 * copies privées de marketFeed.ts et liqFeed.ts. Invariants recopiés de
 * apps/web/src/data/wsLoop.test.ts : backoff exponentiel NON remis à zéro dans onopen
 * (anti-flap), reset au 1er message de DONNÉES, watchdog qui ferme une socket zombie,
 * arrêt propre. bun:test n'a pas de fake timers → horloge et WebSocket INJECTÉES.
 *
 * Heartbeat (lot B.4, ruling R5d) : testé via l'option `heartbeat` de
 * `connecterBoucleWs` (pas seulement `armerHeartbeatWs` isolément) — c'est cette
 * option que consommera la bascule de liqFeed.ts (Task E.3).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { connecterBoucleWs, PERIODE_HEARTBEAT_WS_MS, type HorlogeWs } from "./wsLoop";

/** Horloge factice déterministe : file de minuteurs déclenchés par `avancer(ms)`. */
class HorlogeFactice implements HorlogeWs {
  t = 0;
  private seq = 1;
  private minuteurs: Array<{ id: number; echeance: number; fn: () => void; periode?: number }> = [];
  now = (): number => this.t;
  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = this.seq++;
    this.minuteurs.push({ id, echeance: this.t + ms, fn });
    return id;
  };
  clearTimeout = (id: unknown): void => {
    this.minuteurs = this.minuteurs.filter((m) => m.id !== id);
  };
  setInterval = (fn: () => void, ms: number): unknown => {
    const id = this.seq++;
    this.minuteurs.push({ id, echeance: this.t + ms, fn, periode: ms });
    return id;
  };
  clearInterval = (id: unknown): void => this.clearTimeout(id);
  /** Avance le temps en déclenchant les minuteurs échus dans l'ordre chronologique. */
  avancer(ms: number): void {
    const fin = this.t + ms;
    for (;;) {
      const prochain = this.minuteurs
        .filter((m) => m.echeance <= fin)
        .sort((a, b) => a.echeance - b.echeance)[0];
      if (!prochain) break;
      this.t = prochain.echeance;
      if (prochain.periode !== undefined) prochain.echeance = this.t + prochain.periode;
      else this.minuteurs = this.minuteurs.filter((m) => m.id !== prochain.id);
      prochain.fn();
    }
    this.t = fin;
  }
}

/** WebSocket factice : enregistre les instances, expose des déclencheurs manuels. */
class WsFactice {
  static instances: WsFactice[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  ferme = false;
  /** Payloads envoyés PAR CETTE instance (souscription + heartbeats) — un par socket. */
  envois: string[] = [];
  constructor(public url: string) {
    WsFactice.instances.push(this);
  }
  send(data: string): void {
    this.envois.push(data);
  }
  close(): void {
    if (this.ferme) return;
    this.ferme = true;
    this.onclose?.();
  }
  ouvrir(): void {
    this.onopen?.();
  }
  message(data: string): void {
    this.onmessage?.({ data });
  }
}

function derniere(): WsFactice {
  const w = WsFactice.instances[WsFactice.instances.length - 1];
  if (!w) throw new Error("aucune socket créée");
  return w;
}

interface OptionsTest {
  onOpen?: (ws: WebSocket) => void;
  onMessage?: (d: string) => boolean;
  staleMs?: number;
  heartbeat?: { message: string; intervalleMs?: number };
}

function boucle(horloge: HorlogeFactice, options: OptionsTest = {}): () => void {
  return connecterBoucleWs({
    url: "wss://exemple",
    onMessage: options.onMessage ?? (() => true),
    ...(options.onOpen ? { onOpen: options.onOpen } : {}),
    ...(options.staleMs !== undefined ? { staleMs: options.staleMs } : {}),
    ...(options.heartbeat ? { heartbeat: options.heartbeat } : {}),
    creerWs: (url) => new WsFactice(url) as unknown as WebSocket,
    horloge,
  });
}

beforeEach(() => {
  WsFactice.instances = [];
});

describe("connecterBoucleWs (daemon)", () => {
  test("appelle onOpen à l'ouverture avec la socket (souscription Bybit/OKX)", () => {
    const horloge = new HorlogeFactice();
    let recue: unknown = null;
    boucle(horloge, { onOpen: (ws) => (recue = ws) });
    expect(WsFactice.instances).toHaveLength(1);
    derniere().ouvrir();
    expect(recue).toBe(derniere() as unknown as WebSocket);
  });

  test("reconnecte après une chute, avec backoff exponentiel (1000 puis 2000 ms)", () => {
    const horloge = new HorlogeFactice();
    boucle(horloge, { onMessage: () => false });
    derniere().ouvrir();
    derniere().close(); // chute → reconnexion planifiée à 1000 ms (2^0)
    horloge.avancer(999);
    expect(WsFactice.instances).toHaveLength(1); // pas encore
    horloge.avancer(1);
    expect(WsFactice.instances).toHaveLength(2); // reconnexion no 1
    derniere().ouvrir();
    derniere().close(); // 2e chute → 2000 ms (2^1 : backoff NON remis à zéro dans onopen)
    horloge.avancer(1999);
    expect(WsFactice.instances).toHaveLength(2);
    horloge.avancer(1);
    expect(WsFactice.instances).toHaveLength(3); // backoff doublé confirmé
  });

  test("un message de DONNÉES remet le backoff à zéro (délai suivant = 1000 ms)", () => {
    const horloge = new HorlogeFactice();
    boucle(horloge, { onMessage: (d) => d === "data" });
    derniere().ouvrir();
    derniere().close(); // essai 0→1
    horloge.avancer(1000);
    derniere().ouvrir(); // reconnexion no 1 (essai=1)
    derniere().message("data"); // onMessage true → essai remis à 0
    derniere().close(); // délai suivant : 1000 (2^0), pas 2000
    horloge.avancer(999);
    expect(WsFactice.instances).toHaveLength(2);
    horloge.avancer(1);
    expect(WsFactice.instances).toHaveLength(3);
  });

  test("le watchdog ferme une socket silencieuse après staleMs et relance", () => {
    const horloge = new HorlogeFactice();
    boucle(horloge, { staleMs: 1000 });
    derniere().ouvrir();
    // Watchdog (période min(staleMs, 15 s) = 1000 ms) : tick à t=1000 → diff 1000 ≤ stale
    // (sain) ; tick à t=2000 → diff 2000 > stale → fermeture forcée de la zombie.
    horloge.avancer(2000);
    expect(derniere().ferme).toBe(true);
    horloge.avancer(1000); // délai de reconnexion (2^0)
    expect(WsFactice.instances.length).toBeGreaterThanOrEqual(2);
  });

  test("la fonction d'arrêt ferme la socket et n'ouvre plus aucune reconnexion", () => {
    const horloge = new HorlogeFactice();
    const stop = boucle(horloge);
    derniere().ouvrir();
    stop();
    expect(derniere().ferme).toBe(true);
    horloge.avancer(120_000);
    expect(WsFactice.instances).toHaveLength(1);
  });

  describe("heartbeat (option, lot B.4 / ruling R5d)", () => {
    // staleMs large (10 min, config liqFeed réelle) pour ne pas laisser le watchdog
    // fermer la socket pendant qu'on avance le temps pour observer les heartbeats.
    const STALE_LARGE_MS = 10 * 60_000;

    test("armé à l'ouverture : envoie le message à l'intervalle configuré", () => {
      const horloge = new HorlogeFactice();
      boucle(horloge, {
        staleMs: STALE_LARGE_MS,
        heartbeat: { message: "ping", intervalleMs: 20_000 },
      });
      derniere().ouvrir();
      expect(derniere().envois).toEqual([]); // rien avant le 1er tick
      horloge.avancer(60_000); // 3 ticks : 20s, 40s, 60s
      expect(derniere().envois).toEqual(["ping", "ping", "ping"]);
    });

    test("défaut d'intervalle = PERIODE_HEARTBEAT_WS_MS (20 s)", () => {
      const horloge = new HorlogeFactice();
      boucle(horloge, { staleMs: STALE_LARGE_MS, heartbeat: { message: "ping" } });
      derniere().ouvrir();
      horloge.avancer(PERIODE_HEARTBEAT_WS_MS - 1);
      expect(derniere().envois).toEqual([]);
      horloge.avancer(1);
      expect(derniere().envois).toEqual(["ping"]);
    });

    test("désarmé à la fermeture : l'ancienne socket ne reçoit plus rien, la nouvelle est armée à son ouverture", () => {
      const horloge = new HorlogeFactice();
      boucle(horloge, {
        staleMs: STALE_LARGE_MS,
        heartbeat: { message: "ping", intervalleMs: 20_000 },
      });
      const premiere = derniere();
      premiere.ouvrir();
      horloge.avancer(20_000);
      expect(premiere.envois).toEqual(["ping"]);

      premiere.close(); // chute → reconnexion à 1000 ms (2^0)
      horloge.avancer(1_000);
      expect(WsFactice.instances).toHaveLength(2);
      const seconde = derniere();
      seconde.ouvrir();
      horloge.avancer(20_000); // heartbeat de la 1re instance NE reprend PAS
      expect(premiere.envois).toEqual(["ping"]); // inchangé après sa fermeture
      expect(seconde.envois).toEqual(["ping"]); // armé indépendamment sur la nouvelle socket
    });

    test("la fonction d'arrêt désarme le heartbeat (plus aucun envoi après stop)", () => {
      const horloge = new HorlogeFactice();
      const stop = boucle(horloge, {
        staleMs: STALE_LARGE_MS,
        heartbeat: { message: "ping", intervalleMs: 20_000 },
      });
      derniere().ouvrir();
      horloge.avancer(20_000);
      expect(derniere().envois).toEqual(["ping"]);
      stop();
      horloge.avancer(100_000);
      expect(derniere().envois).toEqual(["ping"]); // aucun envoi supplémentaire
    });

    test("sans option heartbeat, aucun envoi (marketFeed/Binance : pas de souscription à ping)", () => {
      const horloge = new HorlogeFactice();
      boucle(horloge, { staleMs: STALE_LARGE_MS });
      derniere().ouvrir();
      horloge.avancer(120_000);
      expect(derniere().envois).toEqual([]);
    });
  });
});
