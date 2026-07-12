/**
 * Minimal, dependency-free glob → RegExp for file-path matchers.
 * Supports:  **  (any path segments)   *  (anything but /)   {a,b}  (alternation)
 * Enough for cartridge `file` matchers; not a full picomatch.
 */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // ** — match across path separators (optionally the trailing slash too)
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) {
        re += "\\{";
      } else {
        const alts = glob
          .slice(i + 1, end)
          .split(",")
          .map(escapeRegExp)
          .join("|");
        re += `(?:${alts})`;
        i = end;
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += escapeRegExp(c);
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
