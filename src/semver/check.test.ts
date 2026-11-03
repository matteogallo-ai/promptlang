import { describe, expect, test } from "bun:test";
import { checkFile, checkVersion } from "./check";
import type { Change } from "./interface";

const major: Change = { level: "major", declaration: "p", description: "parameter 'y' removed" };
const minor: Change = {
  level: "minor",
  declaration: "p",
  description: "optional parameter 'y' added",
};
const patch: Change = { level: "patch", declaration: "p", description: "prompt text changed" };

describe("checkVersion", () => {
  test("no change needs no bump, even with no @version", () => {
    expect(checkVersion("1.0.0", "1.0.0", []).ok).toBe(true);
    expect(checkVersion(null, null, []).ok).toBe(true);
  });

  test("each level is satisfied by a bump of that level or higher", () => {
    expect(checkVersion("1.2.3", "2.0.0", [major]).ok).toBe(true);
    expect(checkVersion("1.2.3", "1.3.0", [minor]).ok).toBe(true);
    expect(checkVersion("1.2.3", "2.0.0", [minor]).ok).toBe(true);
    expect(checkVersion("1.2.3", "1.2.4", [patch]).ok).toBe(true);
    expect(checkVersion("1.2.3", "1.3.0", [patch]).ok).toBe(true);
  });

  test("a bump below the required level fails with the expected version", () => {
    const r = checkVersion("1.2.3", "1.3.0", [patch, major]);
    expect(r).toMatchObject({ ok: false, required: "major", actual: "minor", expected: "2.0.0" });
    expect(r.reason).toBe("a major change needs at least 2.0.0, got 1.3.0");
    expect(checkVersion("1.2.3", "1.2.4", [minor])).toMatchObject({ ok: false, expected: "1.3.0" });
    expect(checkVersion("1.2.3", "1.2.3", [patch])).toMatchObject({ ok: false, expected: "1.2.4" });
  });

  test("a downgrade fails", () => {
    const r = checkVersion("2.0.0", "1.9.0", [patch]);
    expect(r).toMatchObject({ ok: false, actual: "downgrade" });
    expect(r.reason).toBe("@version went down from 2.0.0 to 1.9.0");
  });

  test("build metadata alone is not a bump; a pre-release of the required version is", () => {
    expect(checkVersion("1.0.0", "1.0.0+build.7", [patch]).ok).toBe(false);
    expect(checkVersion("1.0.0", "2.0.0-rc.1", [major]).ok).toBe(true);
  });

  test("within a pre-release cycle any change passes once the version moves forward", () => {
    // Pre-releases promise no compatibility (SemVer 2.0.0, item 9), and ^ ranges skip them.
    expect(checkVersion("2.0.0-rc.1", "2.0.0-rc.2", [major])).toMatchObject({
      ok: true,
      actual: "prerelease",
    });
    expect(checkVersion("2.0.0-rc.1", "2.0.0", [major])).toMatchObject({
      ok: true,
      actual: "prerelease",
    });
    expect(checkVersion("2.0.0-rc.1", "2.0.0-rc.1", [patch])).toMatchObject({
      ok: false,
      expected: "2.0.0",
      reason:
        "a patch change after 2.0.0-rc.1 needs a later pre-release of 2.0.0, or 2.0.0; got 2.0.0-rc.1",
    });
  });

  test("leaving a pre-release for a later release is judged against the release", () => {
    // ^1.0.0-rc.1 accepts 1.0.1, so a breaking change there would reach its consumers.
    expect(checkVersion("1.0.0-rc.1", "1.0.1", [major])).toMatchObject({
      ok: false,
      expected: "2.0.0",
      reason:
        "a major change after 1.0.0-rc.1 needs a later pre-release of 1.0.0, 1.0.0 itself, or at least 2.0.0; got 1.0.1",
    });
    expect(checkVersion("1.0.0-rc.1", "1.0.1", [patch]).ok).toBe(true);
  });

  test("a lower version fails even when nothing else changed", () => {
    expect(checkVersion("1.5.0", "1.4.0", [])).toMatchObject({ ok: false, actual: "downgrade" });
    expect(checkVersion("1.2.3", "1.2.3-beta", [])).toMatchObject({
      ok: false,
      actual: "downgrade",
    });
  });

  test("at 0.0.x every bump is breaking, as for ^0.0.z", () => {
    expect(checkVersion("0.0.3", "0.0.4", [minor])).toMatchObject({ ok: true, actual: "major" });
    expect(checkVersion("0.0.3", "0.0.3", [patch])).toMatchObject({ ok: false, expected: "0.0.4" });
  });

  test("below 1.0.0 a minor bump is breaking, as for ^0.y.z", () => {
    expect(checkVersion("0.2.3", "0.3.0", [major]).ok).toBe(true);
    expect(checkVersion("0.2.3", "0.2.4", [minor]).ok).toBe(true);
    expect(checkVersion("0.2.3", "0.2.4", [major])).toMatchObject({ ok: false, expected: "0.3.0" });
  });

  test("a change without a current @version fails", () => {
    expect(checkVersion("1.0.0", null, [patch])).toMatchObject({
      ok: false,
      reason: "the file changed but declares no @version",
    });
  });

  test("a file versioned for the first time passes", () => {
    expect(checkVersion(null, "1.0.0", [major]).ok).toBe(true);
  });

  test("the strictest change sets the required level, whatever the order", () => {
    expect(checkVersion("1.2.3", "1.2.4", [major, patch])).toMatchObject({
      ok: false,
      required: "major",
    });
    expect(checkVersion(null, null, [])).toMatchObject({ ok: true, actual: "none" });
  });

  test("leaving 0.y.z for 1.0.0 is a major bump", () => {
    expect(checkVersion("0.5.0", "1.0.0", [major])).toMatchObject({ ok: true, actual: "major" });
  });

  test("the expected version below 1.0.0 follows ^: 0.0.z bumps the patch, 0.y.z the minor or patch", () => {
    expect(checkVersion("0.0.3", "0.0.3", [major])).toMatchObject({ expected: "0.0.4" });
    expect(checkVersion("0.2.3", "0.2.3", [minor])).toMatchObject({ expected: "0.2.4" });
  });

  test("an unparsable current version counts as no version", () => {
    expect(checkVersion("1.0.0", "1.0", [patch])).toMatchObject({
      ok: false,
      actual: "none",
      reason: "the file changed but declares no @version",
    });
  });
});

describe("checkFile", () => {
  const v = (version: string, param = "x: string") =>
    `@version "${version}"\n@model claude-opus-5-5\nprompt p(${param}) -> string {\n  user: "Hi {{x}}"\n}\n`;

  test("a breaking change without a major bump fails, naming the change", () => {
    const r = checkFile("a.prompt", v("1.0.0", "x: string, y: string"), v("1.1.0", "x: string"));
    expect(r).toMatchObject({ status: "fail", required: "major", expected: "2.0.0" });
    expect(r.changes?.map((c) => c.description)).toEqual(["parameter 'y' removed"]);
  });

  test("a file absent at the base is new", () => {
    expect(checkFile("a.prompt", null, v("1.0.0"))).toMatchObject({
      status: "new",
      currentVersion: "1.0.0",
    });
  });

  test("the version is read from @version, wherever it sits among the metadata", () => {
    const body = `prompt p(x: string) -> string {\n  user: "Hi {{x}}"\n}\n`;
    const base = `@model claude-opus-5-5\n@version "1.0.0"\n${body}`;
    expect(checkFile("a.prompt", base, base)).toMatchObject({
      status: "ok",
      baseVersion: "1.0.0",
      currentVersion: "1.0.0",
    });
  });

  test("a version that does not parse is an error naming which side", () => {
    const r = checkFile("a.prompt", "prompt {", v("1.0.0"));
    expect(r.status).toBe("error");
    expect(r.error).toStartWith("base version: ");
    expect(checkFile("a.prompt", v("1.0.0"), '@version "x"').error).toStartWith(
      "current version: "
    );
    expect(checkFile("a.prompt", null, '@version "x"').status).toBe("error");
  });
});
