import { chromium } from "playwright";
import { die } from "../utils";

interface LcscPart {
  lcscPartNumber: string;
  manufacturer: string;
  manufacturerPartNumber: string;
  description: string;
  package: string;
  stock: number;
  pricing: { qty: number; unitPrice: number; totalPrice: number }[];
}

export async function cmdLcsc(args: string[]): Promise<void> {
  let footprint: string | undefined;
  let value: string | undefined;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--footprint" && args[i + 1]) {
      footprint = args[++i];
    } else if (args[i] === "--value" && args[i + 1]) {
      value = args[++i];
    } else if (args[i] === "--json") {
      jsonOutput = true;
    }
  }

  const query = [value, footprint].filter(Boolean).join(" ");
  if (!query) {
    die("Please provide --value and/or --footprint.");
  }

  if (!jsonOutput) {
    console.log(`\n🔍  Searching LCSC for "${query}"...`);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();

  try {
    const url = `https://www.lcsc.com/search?q=${encodeURIComponent(query)}`;
    await page.goto(url);
    await page.waitForLoadState('domcontentloaded');

    // Wait for the table rows to appear
    try {
      await page.waitForSelector('tr[id^="productId"]', { timeout: 10000 });
    } catch (e) {
      if (jsonOutput) {
        console.log(JSON.stringify([]));
      } else {
        console.log("No results found.");
      }
      return;
    }

    // Scope to the product table
    const table = page.locator('table').filter({ has: page.locator('tr[id^="productId"]') }).first();
    const headers = await table.locator('thead tr th').all();
    // if (!jsonOutput) console.log(`Found ${headers.length} headers.`);

    let descIdx = -1;
    let pkgIdx = -1;
    let stockIdx = -1;

    for (let i = 0; i < headers.length; i++) {
      const text = (await headers[i].textContent())?.trim() || "";
      const title = (await headers[i].getAttribute('title') || "").trim();
      // Sometimes title is on a child div
      const childTitle = (await headers[i].locator('div[title]').getAttribute('title').catch(() => "")) || "";

      if (text.includes("Description") || title.includes("Description") || childTitle.includes("Description")) descIdx = i;
      if (text.includes("Package") || title.includes("Package") || childTitle.includes("Package")) pkgIdx = i;
      if (text.includes("Stock") || text.includes("Inventory") || childTitle.includes("Stock")) stockIdx = i;
    }

    const rows = await table.locator('tbody tr[id^="productId"]').all();
    if (rows.length === 0) {
        if (!jsonOutput) console.log("No product rows found.");
        return;
    }

    const results: LcscPart[] = [];

    for (const row of rows) {
      // Use direct children TDs only
      const cells = row.locator('xpath=./td');
      const cellCount = await cells.count();

      // Stock check: "In Stock" text
      const stockCell = cells.filter({ hasText: /Stock|Inventory/ }).first();
      let stock = 0;

      let stockText = "";
      if (await stockCell.count() > 0) {
          stockText = await stockCell.textContent() || "";
      } else if (stockIdx !== -1 && stockIdx < cellCount) {
          stockText = await cells.nth(stockIdx).textContent() || "";
      } else {
          // Fallback: look for cell with "In Stock" text specifically
          const inStockDiv = row.locator('div:has-text("In Stock")');
          if (await inStockDiv.count() > 0) {
             stockText = await inStockDiv.textContent() || "";
          }
      }

      if (stockText) {
         const match = stockText.replace(/,/g, '').match(/(\d+)/);
         if (match) stock = parseInt(match[1], 10);
      }

      if (stock <= 0) continue; // Only "in stock" parts

      // LCSC Part #
      // lcscPartElem is a descendant of the row
      const lcscPartElem = row.locator('a[href*="product-detail"].major--text');
      if (await lcscPartElem.count() === 0) continue;

      const lcscPartNumber = (await lcscPartElem.getAttribute('title'))?.trim() || "";

      // Manufacturer
      // Find cell containing brand detail link
      const mfrCell = row.locator('xpath=./td[.//a[contains(@href, "brand-detail")]]');
      let manufacturer = "";
      if (await mfrCell.count() > 0) {
          manufacturer = (await mfrCell.locator('a[href*="brand-detail"]').first().textContent())?.trim() || "";
      }

      // Manufacturer Part #
      // Find the cell containing the LCSC part link
      // Use xpath to find ancestor td
      const partInfoCell = lcscPartElem.locator('xpath=ancestor::td[1]');

      const links = await partInfoCell.locator('a').all();
      let manufacturerPartNumber = "";
      for (const link of links) {
        let title = (await link.getAttribute('title')) || "";
        const cls = (await link.getAttribute('class')) || "";
        // Skip LCSC part link (has major--text) and Image links
        if (title && !cls.includes('major--text') && !title.includes('Image') && !title.toLowerCase().includes('datasheet')) {
             if (manufacturer && title.toUpperCase().startsWith(manufacturer.toUpperCase())) {
                 title = title.substring(manufacturer.length).trim();
             }
             manufacturerPartNumber = title;
             break;
        }
      }

      // Description
      let description = "";
      if (descIdx !== -1 && descIdx < cellCount) {
          description = (await cells.nth(descIdx).textContent())?.trim() || "";
      } else {
          // Heuristic: usually index 4
          if (4 < cellCount)
             description = (await cells.nth(4).textContent())?.trim() || "";
      }

      // Package
      let pkg = "";
      if (pkgIdx !== -1 && pkgIdx < cellCount) {
          pkg = (await cells.nth(pkgIdx).textContent())?.trim() || "";
      } else {
          // Heuristic: usually index 5
          if (5 < cellCount)
             pkg = (await cells.nth(5).textContent())?.trim() || "";
      }

      // Pricing
      const priceTable = row.locator('table.major--text');
      const pricing: { qty: number; unitPrice: number; totalPrice: number }[] = [];

      if (await priceTable.count() > 0) {
          const priceRows = await priceTable.locator('tr').all();
          for (const pr of priceRows) {
              const prCells = pr.locator('td');
              if (await prCells.count() < 2) continue;

              const qtyText = (await prCells.first().textContent())?.trim() || "0";
              const priceText = (await prCells.nth(1).textContent())?.trim() || "0";

              const qty = parseInt(qtyText.replace(/[+,]/g, ''), 10);
              const unitPrice = parseFloat(priceText.replace('$', ''));

              if (!isNaN(qty) && !isNaN(unitPrice)) {
                  pricing.push({ qty, unitPrice, totalPrice: qty * unitPrice });
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
        pricing
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

function printTable(results: LcscPart[]) {
    const headers = ["LCSC Part#", "Package", "Manufacturer + Part Number", "Description", "Pricing (MOQ)"];

    // Formatting helper
    const getPriceStr = (r: LcscPart) => {
        if (r.pricing.length === 0) return "N/A";
        const p = r.pricing[0]; // Lowest quantity break
        return `${p.qty}+: $${p.unitPrice.toFixed(4)} (Tot: $${p.totalPrice.toFixed(2)})`;
    };

    const widths = headers.map(h => h.length);

    // Prepare data for printing to calc widths
    const rows = results.map(r => {
        const mfrPart = `${r.manufacturer} ${r.manufacturerPartNumber}`.replace(/Datasheet/gi, '').replace(/\s+/g, ' ').trim();
        const priceStr = getPriceStr(r);

        // Clean description
        let desc = r.description.replace(/\s+/g, ' ').trim();
        if (desc.length > 50) desc = desc.substring(0, 47) + "...";

        return [
            r.lcscPartNumber,
            r.package,
            mfrPart,
            desc,
            priceStr
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
