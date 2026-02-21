export type SExpr = string | SExpr[];

/**
 * Simple S-expression parser for KiCad files.
 * Handles:
 * - Nested lists: (a b)
 * - Quoted strings: "string with spaces" and escaped quotes
 * - Atoms: unquoted tokens
 */
export class SExpressionParser {
  /**
   * Parse an S-expression string into a structured array.
   */
  static parse(input: string): SExpr[] {
    const tokens = this.tokenize(input);
    const [ast] = this.parseTokens(tokens);
    return ast;
  }

  /**
   * Serialize an S-expression structure into a string.
   * Uses simple pretty-printing rules:
   * - Lists starting with keywords like 'at', 'size', 'stroke', 'fill', 'uuid', 'id', 'offset' are kept inline.
   * - Other lists are expanded with newlines and indentation.
   */
  static serialize(expr: SExpr, indentLevel: number = 0): string {
    if (typeof expr === "string") {
      return expr;
    }

    if (expr.length === 0) {
      return "()";
    }

    const first = expr[0];
    const isInline =
      typeof first === "string" &&
      [
        "at", "size", "stroke", "fill", "uuid", "id", "offset", "effects", "font",
        "hide", "justify", "mirror", "pin_names", "pin_numbers", "exclude_from_sim",
        "in_bom", "on_board", "tstamps", "sheetpath", "version", "generator", "paper",
        "title_block", "date", "rev", "company", "comment", "pts", "xy", "start", "end",
        "rect", "circle", "arc", "polyline", "text", "no_connect"
      ].includes(first);

    // Also check if all children are atoms/strings (no nested lists)
    const isSimple = expr.every(e => typeof e === "string");

    if (isInline || isSimple) {
      return "(" + expr.map(e => this.serialize(e, 0)).join(" ") + ")";
    }

    const indent = "  ".repeat(indentLevel);
    const childIndent = "  ".repeat(indentLevel + 1);

    // First element (keyword) on same line
    let result = "(" + this.serialize(expr[0], 0);

    for (let i = 1; i < expr.length; i++) {
      const child = expr[i];
      // Check if child should be inline (e.g. property value) or new line

      if (typeof child === "string") {
         result += " " + child;
      } else {
         result += "\n" + childIndent + this.serialize(child, indentLevel + 1);
      }
    }

    result += ")";
    return result;
  }

  /**
   * Helper to strip quotes from a string if present.
   */
  static unquote(s: string): string {
    if (s.startsWith('"') && s.endsWith('"')) {
      return s.slice(1, -1).replace(/\\"/g, '"');
    }
    return s;
  }

  private static tokenize(input: string): string[] {
    const tokens: string[] = [];
    let current = "";
    let inString = false;
    let escaped = false;

    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      if (inString) {
        if (escaped) {
          current += char;
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
          // Include the closing quote
          current += '"';
          tokens.push(current);
          current = "";
        } else {
          current += char;
        }
      } else {
        if (char === "(" || char === ")") {
          if (current.trim().length > 0) {
            tokens.push(current.trim());
          }
          current = "";
          tokens.push(char);
        } else if (char === '"') {
          if (current.trim().length > 0) {
            tokens.push(current.trim());
            current = "";
          }
          inString = true;
          current += '"';
        } else if (/\s/.test(char)) {
          if (current.trim().length > 0) {
            tokens.push(current.trim());
          }
          current = "";
        } else {
          current += char;
        }
      }
    }

    if (current.trim().length > 0) {
      tokens.push(current.trim());
    }

    return tokens;
  }

  private static parseTokens(tokens: string[], startIndex = 0): [SExpr[], number] {
    const result: SExpr[] = [];
    let i = startIndex;

    while (i < tokens.length) {
      const token = tokens[i];

      if (token === "(") {
        const [subList, nextIndex] = this.parseTokens(tokens, i + 1);
        result.push(subList);
        i = nextIndex;
      } else if (token === ")") {
        return [result, i + 1];
      } else {
        // Just push the token as is (atom or quoted string)
        result.push(token);
        i++;
      }
    }

    return [result, i];
  }
}
