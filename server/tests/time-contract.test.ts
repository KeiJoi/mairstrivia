import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("UTC boundary serialization",()=>{
  it.each(["America/Chicago","Asia/Tokyo"])("remains UTC when the process timezone is %s",(timezone)=>{
    const value=execFileSync(process.execPath,["-e","console.log(new Date('2026-08-12T18:36:42.381Z').toISOString())"],{env:{...process.env,TZ:timezone}}).toString().trim();
    expect(value).toBe("2026-08-12T18:36:42.381Z");expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });
});
