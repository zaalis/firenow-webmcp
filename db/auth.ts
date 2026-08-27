import { env } from 'cloudflare:workers';
import { cookies } from 'next/headers';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { authSchema } from './schema';

const SESSION_COOKIE = 'fireops_session';
const CSRF_COOKIE = 'fireops_csrf';
const SESSION_SECONDS = 60 * 60 * 8;

type UserRow = { id: string; email: string; password_hash: string };
type SessionUser = { id: string; email: string };

export async function ensureAuthSchema() {
  await env.DB.batch(authSchema.map((statement) => env.DB.prepare(statement)));
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await argon2idAsync(password, salt, {
    p: 4, t: 3, m: 65536, dkLen: 32, asyncTick: 8,
  });
  return '$argon2id$v=19$m=65536,t=3,p=4$' + bytesToBase64(salt) + '$' + bytesToBase64(hash);
}

export async function verifyPassword(password: string, hash: string) {
  const parts = hash.split('$');
  if (parts.length !== 6 || parts[1] !== 'argon2id' || parts[2] !== 'v=19') return false;
  const params = Object.fromEntries(parts[3].split(',').map((part) => part.split('=')));
  const memory = Number(params.m);
  const iterations = Number(params.t);
  const parallelism = Number(params.p);
  if (memory !== 65536 || iterations !== 3 || parallelism !== 4) return false;
  const salt = base64ToBytes(parts[4]);
  const expected = base64ToBytes(parts[5]);
  const actual = await argon2idAsync(password, salt, {
    p: parallelism, t: iterations, m: memory, dkLen: expected.length, asyncTick: 8,
  });
  return timingSafeBytes(actual, expected);
}

export async function findUser(email: string) {
  await ensureAuthSchema();
  return env.DB.prepare('SELECT id, email, password_hash FROM users WHERE email = ?')
    .bind(email.toLowerCase()).first<UserRow>();
}

export async function createUser(email: string, passwordHash: string) {
  await ensureAuthSchema();
  const user = { id: crypto.randomUUID(), email: email.toLowerCase(), createdAt: Date.now() };
  await env.DB.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .bind(user.id, user.email, passwordHash, user.createdAt).run();
  return user;
}

export async function createSession(userId: string) {
  await ensureAuthSchema();
  const token = randomToken();
  const tokenHash = await sha256(token);
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, tokenHash, now + SESSION_SECONDS * 1000, now).run();
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
    path: '/', maxAge: SESSION_SECONDS,
  });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  await ensureAuthSchema();
  const tokenHash = await sha256(token);
  const user = await env.DB.prepare('SELECT users.id, users.email FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?')
    .bind(tokenHash, Date.now()).first<SessionUser>();
  return user ?? null;
}

export async function deleteSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await ensureAuthSchema();
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  }
  cookieStore.delete(SESSION_COOKIE);
}

export async function issueCsrfToken() {
  const token = randomToken();
  const cookieStore = await cookies();
  cookieStore.set(CSRF_COOKIE, token, {
    httpOnly: false, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
    path: '/', maxAge: 60 * 30,
  });
  return token;
}

export async function validateCsrf(request: Request) {
  const cookieStore = await cookies();
  const cookieToken = cookieStore.get(CSRF_COOKIE)?.value;
  const headerToken = request.headers.get('x-csrf-token');
  return Boolean(cookieToken && headerToken && timingSafeEqual(cookieToken, headerToken));
}

export async function checkRateLimit(email: string, ip: string) {
  await ensureAuthSchema();
  const identifiers = ['account:' + email.toLowerCase(), 'ip:' + ip];
  const rows = await Promise.all(identifiers.map((identifier) =>
    env.DB.prepare('SELECT failures, locked_until FROM login_attempts WHERE identifier = ?')
      .bind(identifier).first<{ failures: number; locked_until: number }>(),
  ));
  const lockedUntil = Math.max(0, ...rows.map((row) => row?.locked_until ?? 0));
  return { allowed: lockedUntil <= Date.now(), retryAfterSeconds: Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000)) };
}

export async function recordLoginFailure(email: string, ip: string) {
  await ensureAuthSchema();
  const now = Date.now();
  for (const identifier of ['account:' + email.toLowerCase(), 'ip:' + ip]) {
    const row = await env.DB.prepare('SELECT failures FROM login_attempts WHERE identifier = ?')
      .bind(identifier).first<{ failures: number }>();
    const failures = (row?.failures ?? 0) + 1;
    const lockMinutes = failures >= 5 ? Math.min(60, 5 * 2 ** (failures - 5)) : 0;
    await env.DB.prepare('INSERT INTO login_attempts (identifier, failures, last_failed_at, locked_until) VALUES (?, ?, ?, ?) ON CONFLICT(identifier) DO UPDATE SET failures = excluded.failures, last_failed_at = excluded.last_failed_at, locked_until = excluded.locked_until')
      .bind(identifier, failures, now, lockMinutes ? now + lockMinutes * 60_000 : 0).run();
  }
}

export async function clearLoginFailures(email: string, ip: string) {
  await ensureAuthSchema();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_attempts WHERE identifier = ?').bind('account:' + email.toLowerCase()),
    env.DB.prepare('DELETE FROM login_attempts WHERE identifier = ?').bind('ip:' + ip),
  ]);
}

export async function isPwnedPassword(password: string) {
  const digest = await sha1(password);
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);
  try {
    const response = await fetch('https://api.pwnedpasswords.com/range/' + prefix, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'FireOps-beta' },
    });
    if (!response.ok) return false;
    const body = await response.text();
    return body.split('\n').some((line) => line.split(':')[0]?.trim() === suffix);
  } catch {
    return false;
  }
}

export function requestIp(request: Request) {
  return request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? 'local';
}

function randomToken() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}
async function sha256(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
async function sha1(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value)))).toUpperCase();
}
function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function bytesToBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/=+$/u, '');
}
function base64ToBytes(value: string) {
  const padded = value + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
function timingSafeBytes(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}
function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
