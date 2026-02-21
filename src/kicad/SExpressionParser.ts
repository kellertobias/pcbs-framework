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
