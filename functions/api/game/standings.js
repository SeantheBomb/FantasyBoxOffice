import { json } from "../_auth";
import { computeStandings } from "./_standings";

export async function onRequestGet({ env }) {
  return json(await computeStandings(env.DB));
}
