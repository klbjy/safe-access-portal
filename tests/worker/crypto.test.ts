import { describe, expect, it } from "vitest";
import { decryptValue, encryptValue, keyedHash } from "../../src/worker/crypto";

const key = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

describe("protected values", () => {
  it("round-trips AES-GCM data and uses a fresh IV", async () => {
    const first = await encryptValue(key, "001234");
    const second = await encryptValue(key, "001234");

    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.iv).not.toBe(second.iv);
    await expect(decryptValue(key, first.ciphertext, first.iv)).resolves.toBe("001234");
  });

  it("separates deterministic HMAC domains", async () => {
    const student = await keyedHash(key, "student-id", "001234");
    const session = await keyedHash(key, "session-token", "001234");

    expect(student).not.toBe(session);
    await expect(keyedHash(key, "student-id", "001234")).resolves.toBe(student);
  });

  it("rejects tampered ciphertext", async () => {
    const encrypted = await encryptValue(key, "secret");
    const tampered = `${encrypted.ciphertext.slice(0, -2)}AA`;
    await expect(decryptValue(key, tampered, encrypted.iv)).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
  });
});
