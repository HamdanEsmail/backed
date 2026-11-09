// A D1 database on which statements matching a pattern cannot be prepared. It stands in for a
// write that fails, so a test can see what a failed write leaves behind.
export function failingOn(db: D1Database, pattern: RegExp): D1Database {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") {
        return (sql: string) => {
          if (pattern.test(sql)) throw new Error("D1 write failed (test)");
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}
