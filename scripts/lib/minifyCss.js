function shouldKeepSpace(before, after) {
  if (!before || !after) return false;
  if ("{}:;,>+~([".includes(before)) return false;
  if ("{}:;,>+~)]".includes(after)) return false;
  return true;
}

function currentFunctionName(output) {
  const match = output.match(/([a-z-]+)$/i);
  return match ? match[1].toLowerCase() : "";
}

export function minifyCss(source) {
  let output = "";
  let quote = null;
  let pendingSpace = false;
  const functionStack = [];

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (quote) {
      output += char;
      if (char === "\\" && index + 1 < source.length) {
        index += 1;
        output += source[index];
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      if (pendingSpace && shouldKeepSpace(output.at(-1), char)) output += " ";
      pendingSpace = false;
      quote = char;
      output += char;
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index += 1;
      }
      index += 1;
      continue;
    }

    if (/\s/.test(char)) {
      if (output.endsWith(" ")) {
        pendingSpace = false;
        continue;
      }
      pendingSpace = true;
      continue;
    }

    if (char === "+" && functionStack.includes("calc")) {
      output = output.trimEnd();
      output += " + ";
      pendingSpace = false;
      continue;
    }

    if ("{}:;,>+~()[]=".includes(char)) {
      if (char === ":" && pendingSpace && !["{", "}"].includes(output.at(-1))) {
        output += " ";
      } else {
        output = output.trimEnd();
      }
      output += char;
      if (char === "(") functionStack.push(currentFunctionName(output.slice(0, -1)));
      if (char === ")") functionStack.pop();
      pendingSpace = false;
      continue;
    }

    if (pendingSpace && shouldKeepSpace(output.at(-1), char)) output += " ";
    pendingSpace = false;
    output += char;
  }

  return `${output.replace(/;}/g, "}").replace(/}/g, "}\n").trim()}\n`;
}
