/**
 * Tests de la fusion « journal front + journal daemon » de la section Session du BRIEF.
 */
import { describe, expect, it } from "vitest";
import type { AlerteDeclencheeBrief } from "../../data/brief";
import type { DeclenchementDaemon } from "../../data/daemon";
import { fusionnerAlertesSession } from "./sessionAlertes";

const DEBUT = 1_700_000_000_000; // début du jour civil local (fixture)
const NOW = DEBUT + 12 * 3_600_000;

function locale(alertId: string, ts: number): AlerteDeclencheeBrief {
  return { alertId, ts, message: `msg ${alertId}`, valeur: 1 };
}

function daemon(alertId: string, ts: number, symbol = "BTCUSDT"): DeclenchementDaemon {
  return { alertId, symbol, ts, valeur: 1, message: `msg ${alertId}`, notifie: true };
}

describe("fusionnerAlertesSession", () => {
  it("sans daemon, renvoie le journal front inchangé (toutes locales)", () => {
    const locales = [locale("a1", DEBUT + 1000), locale("a2", DEBUT + 2000)];
    expect(fusionnerAlertesSession(locales, [], DEBUT, NOW)).toEqual([
      { alertId: "a1", ts: DEBUT + 1000, message: "msg a1", valeur: 1, daemon: false },
      { alertId: "a2", ts: DEBUT + 2000, message: "msg a2", valeur: 1, daemon: false },
    ]);
  });

  it("ajoute les déclenchements daemon absents du front, marqués daemon, triés par ts", () => {
    const fusion = fusionnerAlertesSession(
      [locale("a1", DEBUT + 5000)],
      [daemon("a2", DEBUT + 1000, "ETHUSDT")],
      DEBUT,
      NOW,
    );
    expect(fusion.map((a) => [a.alertId, a.daemon])).toEqual([
      ["a2", true],
      ["a1", false],
    ]);
    expect(fusion[0]?.symbol).toBe("ETHUSDT");
  });

  it("dédoublonne un même déclenchement malgré l'écart d'horodatage front/daemon", () => {
    // Le front évalue à la clôture de bougie, le daemon sur son tick : même
    // déclenchement logique, ts différents de quelques secondes.
    const fusion = fusionnerAlertesSession(
      [locale("a1", DEBUT + 30_000)],
      [daemon("a1", DEBUT + 38_000)],
      DEBUT,
      NOW,
    );
    expect(fusion).toHaveLength(1);
    expect(fusion[0]?.daemon).toBe(false);
  });

  it("garde deux déclenchements distincts de la même alerte largement espacés", () => {
    const fusion = fusionnerAlertesSession(
      [locale("a1", DEBUT + 30_000)],
      [daemon("a1", DEBUT + 3_600_000)],
      DEBUT,
      NOW,
    );
    expect(fusion.map((a) => a.daemon)).toEqual([false, true]);
  });

  it("ignore les entrées daemon hors du jour civil courant", () => {
    const fusion = fusionnerAlertesSession(
      [],
      [daemon("hier", DEBUT - 60_000), daemon("futur", NOW + 60_000), daemon("ok", DEBUT + 10)],
      DEBUT,
      NOW,
    );
    expect(fusion.map((a) => a.alertId)).toEqual(["ok"]);
  });
});
