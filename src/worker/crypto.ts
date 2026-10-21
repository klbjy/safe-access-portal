import { AppError } from "./errors";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const hmacKeys = new Map<string, Promise<CryptoKey>>();
const aesKeys = new Map<string, Promise<CryptoKey>>();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  try {
    const binary = atob(value);
    return new Uint8Array(Array.from(binary, (character) => character.charCodeAt(0)));
  } catch {
    throw new AppError(500, "INTERNAL_ERROR", "服务配置无效");
  }
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function dataKeyBytes(encoded: string): Uint8Array<ArrayBuffer> {
  const bytes = fromBase64(encoded);
  if (bytes.byteLength !== 32) {
    throw new AppError(500, "INTERNAL_ERROR", "服务配置无效");
  }
  return bytes;
}

function hmacKey(encodedKey: string): Promise<CryptoKey> {
  let key = hmacKeys.get(encodedKey);
  if (!key) {
    key = crypto.subtle.importKey(
      "raw",
      dataKeyBytes(encodedKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    hmacKeys.set(encodedKey, key);
  }
  return key;
}

function aesKey(encodedKey: string, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  const cacheKey = `${encodedKey}:${usage}`;
  let key = aesKeys.get(cacheKey);
  if (!key) {
    key = crypto.subtle.importKey("raw", dataKeyBytes(encodedKey), "AES-GCM", false, [usage]);
    aesKeys.set(cacheKey, key);
  }
  return key;
}

export async function keyedHash(encodedKey: string, domain: string, value: string): Promise<string> {
  const key = await hmacKey(encodedKey);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${domain}\0${value}`));
  return toBase64Url(new Uint8Array(signature));
}

export async function encryptValue(encodedKey: string, plaintext: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await aesKey(encodedKey, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plaintext));
  return { ciphertext: toBase64(new Uint8Array(ciphertext)), iv: toBase64(iv) };
}

export async function decryptValue(encodedKey: string, ciphertext: string, encodedIv: string): Promise<string> {
  try {
    const key = await aesKey(encodedKey, "decrypt");
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(encodedIv) },
      key,
      fromBase64(ciphertext),
    );
    return decoder.decode(plaintext);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(500, "INTERNAL_ERROR", "无法读取受保护数据");
  }
}

export function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function normalizeName(value: string): string {
  return value.trim().normalize("NFKC").replace(/\s+/gu, " ").toLocaleLowerCase("zh-CN");
}
