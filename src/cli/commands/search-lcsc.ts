import { chromium } from "playwright";
import { die } from "../utils";
import * as readline from "readline";

interface JlcPart {
  lcscPartNumber: string;
  manufacturer: string;
  manufacturerPartNumber: string;
  description: string;
  package: string;
  stock: number;
  pricing: { qty: number; unitPrice: number; totalPrice: number }[];
  basic: boolean;
  link: string;
}

export async function cmdLcsc(args: string[]): Promise<void> {
  let footprint: string | undefined;
  let value: string | undefined;
  let jsonOutput = false;
  let debug = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--footprint" && args[i + 1]) {
      footprint = args[++i];
    } else if (args[i] === "--value" && args[i + 1]) {
      value = args[++i];
    } else if (args[i] === "--json") {
      jsonOutput = true;
    } else if (args[i] === "--debug") {
      debug = true;
    }
  }

  // Interactive mode if no value or footprint
  if (!value && !footprint) {
    await interactiveLoop(debug);
    return;
  }

  const query = [value, footprint].filter(Boolean).join(" ");
  if (!query) {
    die("Please provide --value and/or --footprint.");
  }

  await performSearch(query, footprint, jsonOutput, debug);
}

async function interactiveLoop(debug: boolean) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const ask = (q: string): Promise<string> => {
    return new Promise(resolve => rl.question(q, resolve));
  };

  while (true) {
    const query = await ask("\nSearch JLC Parts (or 'q' to quit): ");
    if (query.toLowerCase() === 'q') break;
    if (!query.trim()) continue;

    // In interactive mode, footprint filtering is tricky if we don't ask for it separately.
    // For simplicity, we assume the user types everything in the query.
    // However, the requirement says "if neither --value or --footprint is provided, open an interactive search... If a footprint is provided, make sure to only show parts matching that footprint".
    // This implies that interactive mode might not have a separate footprint filter unless we parse the query or ask for it.
    // But typically interactive search means just typing keywords.
    // Let's assume interactive search is just search text, no strict footprint filtering unless provided in args (which puts us in non-interactive mode).
    // Wait, "if neither... provided... If a footprint is provided..." implies two different execution paths.
    // If I am in interactive mode, I don't have a footprint provided via args.
    // I will just search with the query string.

    await performSearch(query, undefined, false, debug);
  }
  rl.close();
}

async function performSearch(query: string, footprintFilter: string | undefined, jsonOutput: boolean, debug: boolean) {
  if (!jsonOutput) {
    console.log(`\n🔍  Searching JLC for "${query}"...`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  try {
    const url = `https://jlcpcb.com/parts/componentSearch?searchTxt=${encodeURIComponent(query)}`;
    if (debug) console.log(`DEBUG: Navigating to ${url}`);

    await page.goto(url);
    await page.waitForLoadState('domcontentloaded');

    // Wait for table to load
    try {
      if (debug) console.log(`DEBUG: Waiting for table rows...`);
      // JLC uses el-table. Rows have class el-table__row
      await page.waitForSelector('.el-table__row', { timeout: 15000 });
    } catch (e) {
      if (jsonOutput) {
        console.log(JSON.stringify([]));
      } else {
        console.log("No results found.");
      }
      return;
    }

    if (debug) console.log(`DEBUG: Table found. Parsing rows...`);

    // We need to identify columns. JLC table headers are in the same table usually.
    // .el-table__header-wrapper th .cell
    const headerCells = await page.locator('.el-table__header-wrapper th').all();

    let mfrPartIdx = -1; // Contains Image, MfrPart, LCSC Part, Basic/Extended
    let mfrIdx = -1;
    let descIdx = -1;
    let priceIdx = -1;
    let stockIdx = -1;

    for (let i = 0; i < headerCells.length; i++) {
        const text = (await headerCells[i].textContent())?.trim() || "";
        if (debug) console.log(`DEBUG: Header ${i}: ${text}`);

        if (text.includes("MFR Part")) mfrPartIdx = i;
        if (text.includes("Manufacturer")) mfrIdx = i;
        if (text.includes("Description")) descIdx = i;
        if (text.includes("Price")) priceIdx = i;
        if (text.includes("Stock")) stockIdx = i;
    }

    const rows = await page.locator('.el-table__body-wrapper .el-table__row').all();
    const results: JlcPart[] = [];

    for (const row of rows) {
      const cells = await row.locator('td').all();

      // Mfr Part Column (Index 1 usually, assuming index 0 is expander/checkbox)
      // Actually index depends on header analysis.
      // But typically: [expander, checkbox, MFR Part #, ..., Desc, ..., Mfr, ..., Stock, ..., Price, ...]

      if (mfrPartIdx === -1) {
          // Fallback based on visual inspection of dump
          // col 3 (index 2) had the part info
          mfrPartIdx = 2;
      }

      const partCell = cells[mfrPartIdx];

      // LCSC Part #
      // Found in: .text-12.text-666666 span (the text usually starts with C)
      // Or explicitly: href="/partdetail/..."
      // In dump: <span data-v-cbf62884="">C73806</span>
      // And link: <a href="/partdetail/74921-RS03K104JT/C73806" ...>RS-03K104JT</a>

      const linkElem = partCell.locator('a[href*="/partdetail/"]');
      const linkUrl = await linkElem.getAttribute('href').catch(() => "") || "";
      const fullLink = linkUrl.startsWith('http') ? linkUrl : `https://jlcpcb.com${linkUrl}`;

      const manufacturerPartNumber = (await linkElem.textContent())?.trim() || "";

      // LCSC Part Number is often near the link or in the link URL
      let lcscPartNumber = "";
      const match = fullLink.match(/\/C(\d+)$/);
      if (match) {
          lcscPartNumber = "C" + match[1];
      } else {
          // Try finding text starting with C followed by digits
          const text = await partCell.textContent();
          const cMatch = text?.match(/C\d+/);
          if (cMatch) lcscPartNumber = cMatch[0];
      }

      // Basic/Extended
      // <span class="text-12 text-666666 ml-4">Extended</span>
      const basicText = (await partCell.textContent()) || "";
      const isBasic = basicText.includes("Basic");
      const isExtended = basicText.includes("Extended");
      const basic = isBasic; // default false if extended or neither?

      // Description
      let description = "";
      if (descIdx !== -1 && descIdx < cells.length) {
          description = (await cells[descIdx].textContent())?.trim() || "";
      }

      // Try to extract Package from description
      // Common packages: 0201, 0402, 0603, 0805, 1206, 1210, 2010, 2512
      // SOT-23, SOT-89, SOD-123, SOIC-8, TSSOP, QFN, etc.
      let pkg = "";
      const pkgMatch = description.match(/\b(0201|0402|0603|0805|1206|1210|2010|2512|SOT-\d+|SOD-\d+|SOIC-\d+|TSSOP-\d+|QFN-\d+|QFP-\d+|DIP-\d+|SMA|SMB|SMC)\b/i);
      if (pkgMatch) {
          pkg = pkgMatch[0];
      }

      // Mfr
      let manufacturer = "";
      if (mfrIdx !== -1 && mfrIdx < cells.length) {
          manufacturer = (await cells[mfrIdx].textContent())?.trim() || "";
      }

      // Stock
      let stock = 0;
      if (stockIdx !== -1 && stockIdx < cells.length) {
          const stockText = (await cells[stockIdx].textContent())?.trim() || "0";
          stock = parseInt(stockText.replace(/,/g, ''), 10);
      } else {
          // fallback search for number in cell 9 (from dump inspection)
          // col 9 had "8518770"
          if (9 < cells.length) {
               const stockText = (await cells[9].textContent())?.trim() || "0";
               if (/^\d+$/.test(stockText.replace(/,/g, ''))) {
                   stock = parseInt(stockText.replace(/,/g, ''), 10);
               }
          }
      }

      // Skip if not in stock
      if (stock <= 0) continue;

      // Filter footprint if requested
      if (footprintFilter) {
          // Check description or mfr part or package if we have it.
          // JLC description often contains footprint like "0603".
          // In dump: "... 0603 Chip Resistor ..."
          const regex = new RegExp(footprintFilter, 'i');
          if (!regex.test(description) && !regex.test(manufacturerPartNumber)) {
              continue;
          }
      }

      // Pricing
      // In dump: cell 11.
      // <div class="leading-[20px] ..."><span>1+</span> <span>$0.0011</span></div>
      const pricing: { qty: number; unitPrice: number; totalPrice: number }[] = [];
      let priceCell = null;
      if (priceIdx !== -1 && priceIdx < cells.length) {
          priceCell = cells[priceIdx];
      } else if (11 < cells.length) {
          priceCell = cells[11];
      }

      if (priceCell) {
          // Select all price rows
          // They look like: 1+ $0.0012
          // Structure might be multiple divs
          const text = await priceCell.innerText(); // innerText preserves newlines
          if (debug) console.log(`DEBUG: Price cell text: ${JSON.stringify(text)}`);
          const lines = text.split('\n').map(l => l.trim()).filter(l => l);

          for (let i = 0; i < lines.length; i++) {
              const line = lines[i];

              // Case: "1+ $0.0012" (on same line)
              const parts = line.split(/\s+/);
              if (parts.length >= 2 && parts[0].match(/^\d+\+$/) && parts[parts.length-1].startsWith('$')) {
                  const qtyStr = parts[0].replace('+', '').replace(/,/g, '');
                  const priceStr = parts[parts.length - 1].replace('$', '');
                  const qty = parseInt(qtyStr, 10);
                  const price = parseFloat(priceStr);
                  if (!isNaN(qty) && !isNaN(price)) {
                      pricing.push({ qty, unitPrice: price, totalPrice: qty * price });
                  }
                  continue;
              }

              // Case: "1+" on one line, "$0.0012" on next
              if (line.match(/^\d+\+$/)) {
                  // check next line for price
                  if (i + 1 < lines.length && lines[i+1].startsWith('$')) {
                      const qtyStr = line.replace('+', '').replace(/,/g, '');
                      const priceStr = lines[i+1].replace('$', '');
                      const qty = parseInt(qtyStr, 10);
                      const price = parseFloat(priceStr);
                      if (!isNaN(qty) && !isNaN(price)) {
                          pricing.push({ qty, unitPrice: price, totalPrice: qty * price });
                          i++; // skip next line
                      }
                  }
              }

              // Case: "Est. unit price:" then "$0.0013"
              if (line.includes("Est. unit price") && i + 1 < lines.length && lines[i+1].startsWith('$')) {
                  const priceStr = lines[i+1].replace('$', '');
                  const price = parseFloat(priceStr);
                   if (!isNaN(price)) {
                      pricing.push({ qty: 1, unitPrice: price, totalPrice: price });
                      i++;
                  }
              }
          }
      }

      results.push({
          lcscPartNumber,
          manufacturer,
          manufacturerPartNumber,
          description,
          package: pkg,
          stock,
          pricing,
          basic,
          link: fullLink
      });
    }

    if (jsonOutput) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      printTable(results);
    }

  } catch (error) {
    if (jsonOutput) {
       console.log(JSON.stringify({ error: String(error) }));
    } else {
       console.error("Error:", error);
    }
  } finally {
    await browser.close();
  }
}

function printTable(results: JlcPart[]) {
    const headers = ["LCSC Part#", "Type", "Package", "Mfr Part #", "Manufacturer", "Description", "Stock", "Price (1+)"];

    // Formatting helper
    const getPriceStr = (r: JlcPart) => {
        if (r.pricing.length === 0) return "N/A";
        // Find 1+ price
        const p = r.pricing.find(x => x.qty === 1) || r.pricing[0];
        return `$${p.unitPrice.toFixed(4)}`;
    };

    const widths = headers.map(h => h.length);

    // Prepare data for printing to calc widths
    const rows = results.map(r => {
        let desc = r.description.replace(/\s+/g, ' ').trim();
        if (desc.length > 40) desc = desc.substring(0, 37) + "...";

        let mfr = r.manufacturer;
        if (mfr.length > 20) mfr = mfr.substring(0, 17) + "...";

        return [
            r.lcscPartNumber,
            r.basic ? "Basic" : "Extended",
            r.package,
            r.manufacturerPartNumber,
            mfr,
            desc,
            r.stock.toLocaleString(),
            getPriceStr(r)
        ];
    });

    // Calc max widths
    rows.forEach(r => {
        r.forEach((c, i) => {
            widths[i] = Math.max(widths[i], c.length);
        });
    });

    const rowFormat = (r: string[]) => {
        return r.map((c, i) => c.padEnd(widths[i])).join("  ");
    };

    console.log(rowFormat(headers));
    console.log(widths.map(w => "-".repeat(w)).join("  "));

    rows.forEach(r => {
        console.log(rowFormat(r));
    });
}
