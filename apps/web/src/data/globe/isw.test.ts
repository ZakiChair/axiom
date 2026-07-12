import { describe, expect, it } from "vitest";
import { parseFrontIsw } from "./isw";

// Forme VERBATIM d'une réponse ArcGIS f=geojson (vérifiée en direct le 2026-07-12 :
// 10 features Polygon, propriété EditDate en epoch ms).
const GEOJSON = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { OBJECTID: 250, EditDate: 1783204674229 }, geometry: { type: "Polygon", coordinates: [[[37.5, 47.9], [37.6, 47.9], [37.6, 48.0], [37.5, 47.9]]] } },
    { type: "Feature", properties: { OBJECTID: 251, EditDate: 1783100000000 }, geometry: { type: "MultiPolygon", coordinates: [[[[30, 46], [30.1, 46], [30.1, 46.1], [30, 46]]]] } },
  ],
};

describe("parseFrontIsw", () => {
  it("accepte une FeatureCollection et extrait le EditDate max", () => {
    const front = parseFrontIsw(GEOJSON);
    expect(front?.n).toBe(2);
    expect(front?.majMs).toBe(1783204674229);
    expect(front?.collection).toBe(GEOJSON); // la collection passe telle quelle à geoPath
  });
  it("tolère l'absence d'EditDate (majMs null)", () => {
    const front = parseFrontIsw({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [] } }] });
    expect(front?.majMs).toBeNull();
  });
  it("rejette sans jeter : null, mauvais type, features absentes, collection vide", () => {
    expect(parseFrontIsw(null)).toBeNull();
    expect(parseFrontIsw({ type: "Point" })).toBeNull();
    expect(parseFrontIsw({ type: "FeatureCollection" })).toBeNull();
    expect(parseFrontIsw({ type: "FeatureCollection", features: [] })).toBeNull();
  });
});
