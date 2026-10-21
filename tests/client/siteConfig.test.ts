import { beforeAll, describe, expect, it } from "vitest";
import { parseSiteConfig } from "../../src/client/config/schema";
import { createSiteConfig, serializeSiteConfig, unlockSiteConfig } from "../../src/client/config/siteConfig";
import type { PersonRecord, SiteConfigV1 } from "../../src/client/config/types";

const people: PersonRecord[] = [
  { id: "10000000-0000-4000-8000-000000000001", name: "测试管理员", studentId: "ADMIN-001", role: "admin" },
  { id: "10000000-0000-4000-8000-000000000002", name: "测试志愿者", studentId: "VOL-001", role: "volunteer" },
];

let config: SiteConfigV1;

beforeAll(async () => {
  config = await createSiteConfig(people, "86420975", { version: "test-version-1" });
});

describe("static site configuration", () => {
  it("does not serialize protected plaintext", () => {
    const serialized = serializeSiteConfig(config);
    for (const protectedValue of ["测试管理员", "测试志愿者", "ADMIN-001", "VOL-001", "86420975"]) {
      expect(serialized).not.toContain(protectedValue);
    }
  });

  it("unlocks the vault for a volunteer without exposing the roster", async () => {
    const session = await unlockSiteConfig(config, "测试志愿者", "VOL-001");
    expect(session.user.role).toBe("volunteer");
    expect(session.password).toBe("86420975");
    expect(session.people).toBeUndefined();
  });

  it("unlocks and verifies the roster for an administrator", async () => {
    const session = await unlockSiteConfig(config, "测试管理员", "ADMIN-001");
    expect(session.user.role).toBe("admin");
    expect(session.people).toEqual(people);
  });

  it("uses one generic failure for invalid credentials", async () => {
    await expect(unlockSiteConfig(config, "测试管理员", "WRONG")).rejects.toThrow(
      "姓名或学号不正确，或尚未获得权限",
    );
  });

  it("fails closed when encrypted content is modified", async () => {
    const tampered = {
      ...config,
      vault: { ...config.vault, ciphertext: `${config.vault.ciphertext.slice(0, -1)}A` },
    };
    await expect(unlockSiteConfig(tampered, "测试管理员", "ADMIN-001")).rejects.toThrow(
      "姓名或学号不正确，或尚未获得权限",
    );
  });

  it("rotates keys so a removed person cannot unlock a later configuration", async () => {
    const next = await createSiteConfig([people[0]!], "73518642", { version: "test-version-2" });
    expect(next.vault).not.toEqual(config.vault);
    await expect(unlockSiteConfig(next, "测试志愿者", "VOL-001")).rejects.toThrow();
    expect((await unlockSiteConfig(next, "测试管理员", "ADMIN-001")).password).toBe("73518642");
  });

  it("rejects duplicate published lookups", () => {
    const duplicate = { ...config, users: [config.users[0], config.users[0]] };
    expect(() => parseSiteConfig(duplicate)).toThrow("配置包含重复人员条目");
  });

  it("rejects drafts without an administrator or with duplicate student IDs", async () => {
    await expect(createSiteConfig([{ ...people[1]!, role: "volunteer" }], "73518642")).rejects.toThrow("必须至少保留一名管理者");
    await expect(createSiteConfig([people[0]!, { ...people[1]!, studentId: "ADMIN-001" }], "73518642")).rejects.toThrow("学号重复");
  });
});
