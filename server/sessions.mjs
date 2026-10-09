import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

const directory = join(process.cwd(), ".data");
const file = join(directory, "sessions.json");

const sessions = new Map();
const states = new Map();

function revive() {
  if (!existsSync(file)) return;
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    for (const session of saved.sessions || []) sessions.set(session.id, session);
  } catch {
    sessions.clear();
  }
}

function persist() {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({ sessions: [...sessions.values()] }),
  );
}

revive();

export function createState() {
  const state = randomBytes(16).toString("hex");
  states.set(state, Date.now());
  return state;
}

export function takeState(state) {
  const created = states.get(state);
  states.delete(state);
  if (!created) return false;
  return Date.now() - created < 15 * 60 * 1000;
}

export function createSession(data) {
  const id = randomBytes(24).toString("hex");
  const session = { id, ...data };
  sessions.set(id, session);
  persist();
  return session;
}

export function getSession(id) {
  if (!id) return null;
  return sessions.get(id) || null;
}

export function updateSession(id, patch) {
  const current = sessions.get(id);
  if (!current) return null;
  Object.assign(current, patch);
  persist();
  return current;
}

export function deleteSession(id) {
  sessions.delete(id);
  persist();
}
