/**
 * Tests des fonctions PURES des notes (parse de tags, recherche/filtre antichrono, tags
 * distincts) + du conteneur (création / édition / suppression). Env node : `localStorage`
 * absent → la persistance interne est un no-op (try/catch), sans effet sur la logique.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  notesStore,
  parseTags,
  rechercherNotes,
  tousLesTags,
  type Note,
  type NouvelleNote,
} from "./notes";

/** Fabrique une note de test. */
function note(over: Partial<Note>): Note {
  return {
    id: over.id ?? "n1",
    symbole: over.symbole ?? "BTCUSDT",
    source: over.source ?? "binance",
    timestamp: over.timestamp ?? 0,
    prix: over.prix,
    texte: over.texte ?? "",
    tags: over.tags ?? [],
  };
}

describe("parseTags", () => {
  it("découpe sur virgules et espaces, minuscules, sans #, dédoublonné", () => {
    expect(parseTags("#Setup, breakout  SETUP")).toEqual(["setup", "breakout"]);
  });

  it("chaîne vide → aucun tag", () => {
    expect(parseTags("   ")).toEqual([]);
  });
});

describe("rechercherNotes", () => {
  const notes = [
    note({ id: "a", symbole: "BTCUSDT", timestamp: 100, texte: "cassure de range", tags: ["breakout"] }),
    note({ id: "b", symbole: "ETHUSDT", timestamp: 300, texte: "support tenu", tags: ["support"] }),
    note({ id: "c", symbole: "BTCUSDT", timestamp: 200, texte: "range serré", tags: ["breakout", "range"] }),
  ];

  it("sans filtre : tout, en ordre antichrono", () => {
    const r = rechercherNotes(notes, {});
    expect(r.map((n) => n.id)).toEqual(["b", "c", "a"]); // ts 300, 200, 100
  });

  it("filtre par symbole (insensible à la casse)", () => {
    const r = rechercherNotes(notes, { symbole: "btcusdt" });
    expect(r.map((n) => n.id)).toEqual(["c", "a"]);
  });

  it("filtre par tag exact", () => {
    const r = rechercherNotes(notes, { tag: "support" });
    expect(r.map((n) => n.id)).toEqual(["b"]);
  });

  it("recherche plein texte sur le texte", () => {
    const r = rechercherNotes(notes, { texte: "range" });
    expect(r.map((n) => n.id).sort()).toEqual(["a", "c"]); // "cassure de range" + "range serré"
  });

  it("recherche plein texte sur les tags et le symbole", () => {
    expect(rechercherNotes(notes, { texte: "support" }).map((n) => n.id)).toEqual(["b"]);
    expect(rechercherNotes(notes, { texte: "eth" }).map((n) => n.id)).toEqual(["b"]);
  });

  it("combine les filtres en ET", () => {
    const r = rechercherNotes(notes, { symbole: "BTCUSDT", tag: "range" });
    expect(r.map((n) => n.id)).toEqual(["c"]);
  });
});

describe("tousLesTags", () => {
  it("liste triée des tags distincts", () => {
    const notes = [
      note({ tags: ["breakout", "range"] }),
      note({ tags: ["support", "breakout"] }),
    ];
    expect(tousLesTags(notes)).toEqual(["breakout", "range", "support"]);
  });
});

describe("notesStore", () => {
  beforeEach(() => notesStore.setState({ notes: [] }));

  const NOUVELLE: NouvelleNote = {
    symbole: "btcusdt",
    source: "binance",
    prix: 42000,
    texte: "test",
    tags: ["setup"],
  };

  it("ajouter : crée une note horodatée, symbole normalisé, id généré", () => {
    notesStore.getState().ajouter(NOUVELLE);
    const n = notesStore.getState().notes[0];
    expect(n?.symbole).toBe("BTCUSDT");
    expect(n?.prix).toBe(42000);
    expect(n?.tags).toEqual(["setup"]);
    expect(typeof n?.id).toBe("string");
    expect(typeof n?.timestamp).toBe("number");
  });

  it("modifier : met à jour texte et tags, laisse le reste intact", () => {
    notesStore.getState().ajouter(NOUVELLE);
    const n0 = notesStore.getState().notes[0];
    const id = n0?.id ?? "";
    notesStore.getState().modifier(id, { texte: "revu", tags: ["revu"] });
    const n = notesStore.getState().notes[0];
    expect(n?.texte).toBe("revu");
    expect(n?.tags).toEqual(["revu"]);
    expect(n?.symbole).toBe("BTCUSDT"); // inchangé
    expect(n?.timestamp).toBe(n0?.timestamp); // inchangé
  });

  it("supprimer : retire la note par id", () => {
    notesStore.getState().ajouter(NOUVELLE);
    const id = notesStore.getState().notes[0]?.id ?? "";
    notesStore.getState().supprimer(id);
    expect(notesStore.getState().notes).toHaveLength(0);
  });
});
