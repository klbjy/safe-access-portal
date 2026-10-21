import type { EncryptedValue } from "./types.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

export function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return new Uint8Array(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function textBytes(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(encoder.encode(value));
}

export function decodeText(value: Uint8Array): string {
  return decoder.decode(value);
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textBytes(value));
  return encodeBase64Url(new Uint8Array(digest));
}

export async function deriveWrappingKey(material: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", textBytes(material), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt), iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function importAesKey(raw: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new Uint8Array(raw), { name: "AES-GCM" }, false, usage);
}

export async function encryptBytes(rawKey: Uint8Array | CryptoKey, value: Uint8Array, aad: string): Promise<EncryptedValue> {
  const key = rawKey instanceof CryptoKey ? rawKey : await importAesKey(rawKey, ["encrypt"]);
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: textBytes(aad), tagLength: 128 },
    key,
    new Uint8Array(value),
  );
  return { iv: encodeBase64Url(iv), ciphertext: encodeBase64Url(new Uint8Array(ciphertext)) };
}

export async function decryptBytes(rawKey: Uint8Array | CryptoKey, value: EncryptedValue, aad: string): Promise<Uint8Array> {
  const key = rawKey instanceof CryptoKey ? rawKey : await importAesKey(rawKey, ["decrypt"]);
  const iv = decodeBase64Url(value.iv);
  if (iv.length !== 12) throw new Error("加密向量长度无效");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: textBytes(aad), tagLength: 128 },
    key,
    new Uint8Array(decodeBase64Url(value.ciphertext)),
  );
  return new Uint8Array(plaintext);
}

export async function encryptJson(rawKey: Uint8Array, value: unknown, aad: string): Promise<EncryptedValue> {
  return encryptBytes(rawKey, textBytes(JSON.stringify(value)), aad);
}

export async function decryptJson(rawKey: Uint8Array, value: EncryptedValue, aad: string): Promise<unknown> {
  return JSON.parse(decodeText(await decryptBytes(rawKey, value, aad))) as unknown;
}
