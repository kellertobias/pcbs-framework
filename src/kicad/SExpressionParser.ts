export type SExpr = string | SExpr[];

const indentation = "\t";

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
   * Formatting rules:
   * - Simple expressions (only atoms/strings, no nested lists) are kept on a single line.
   * - Expressions with sub-expressions (nested arrays) are expanded:
   *   - Every sub-expression starts on a new line with indentation.
   *   - The closing parenthesis is on its own line (matching the opening indentation).
   */
  static serialize(expr: SExpr, indentLevel: number = 0, forceInline: boolean = false): string {
    if (typeof expr === "string") {
      // KiCad crashes on excessively long IEEE 754 floats. Truncate matching long decimals.
      const match = expr.match(/^("?)(-?\d+\.\d{5,})("?)$/);
      if (match) {
        const val = parseFloat(match[2]);
        if (!isNaN(val)) {
          const fixed = val.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
          return `${match[1]}${fixed}${match[3]}`;
        }
      }
      return expr;
    }

    if (expr.length === 0) {
      return "()";
    }

    // Deepest level (inline): No sub-expressions (nested arrays)
    const isSimple = expr.every(e => typeof e === "string");
    if (isSimple || forceInline) {
      return "(" + expr.map(e => this.serialize(e, 0, true)).join(" ") + ")";
    }

    const keyword = typeof expr[0] === "string" ? expr[0] : "";

    const forceInlineKeywords = ["libsource", "sheetpath", "property", "field", "node", "pin", "comment"];
    if (forceInlineKeywords.includes(keyword) || forceInline) {
      return "(" + expr.map(e => this.serialize(e, 0, true)).join(" ") + ")";
    }

    const nodeIndent = indentation.repeat(indentLevel);
    const childIndent = indentation.repeat(indentLevel + 1);

    const inlineChildrenRules: Record<string, string[]> = {
      "export": ["version"],
      "library": ["logical"],
      "libpart": ["lib", "part"],
      "net": ["code", "name", "class"]
    };

    // Standard multiline expansion
    let result = "(" + (typeof expr[0] === "string" ? expr[0] : this.serialize(expr[0], 0));

    let inlineNext = true;
    const rule = inlineChildrenRules[keyword] || [];
    let isMultiline = false;

    for (let i = 1; i < expr.length; i++) {
      const child = expr[i];
      if (typeof child === "string") {
        result += " " + child;
      } else {
        const childKeyword = Array.isArray(child) && child.length > 0 && typeof child[0] === "string" ? child[0] : "";
        if (inlineNext && rule.includes(childKeyword)) {
          // Serialize inline without newline
          result += " " + this.serialize(child, 0, false);
        } else {
          inlineNext = false; // Once a child drops to a new line, all subsequent children wrap
          isMultiline = true;
          result += "\n" + childIndent + this.serialize(child, indentLevel + 1);
        }
      }
    }

    if (isMultiline) {
      result += "\n" + nodeIndent + ")";
    } else {
      result += ")";
    }
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
          current += "\\" + char;
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
