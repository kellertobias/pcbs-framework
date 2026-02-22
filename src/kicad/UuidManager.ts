import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export class UuidManager {
  private uuids: Record<string, string> = {};
  private filePath: string = "";

  constructor() {}

  /**
   * Load UUID mapping from a JSON file.
   * If the file doesn't exist, starts with an empty map.
   */
  load(filePath: string) {
    this.filePath = filePath;
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        this.uuids = JSON.parse(content);
      } catch (e) {
        console.warn(`Failed to parse UUID file ${filePath}:`, e);
        this.uuids = {};
      }
    } else {
      this.uuids = {};
    }
  }

  /**
   * Get an existing UUID or generate a new one for the given key.
   * @param key Unique identifier for the element (e.g. component ref)
   */
  getOrGenerate(key: string): string {
    if (!this.uuids[key]) {
      this.uuids[key] = crypto.randomUUID();
    }
    return this.uuids[key];
  }

  /**
   * Set a specific UUID for a key (useful for root UUID if extracted from existing file).
   */
  set(key: string, uuid: string) {
    this.uuids[key] = uuid;
  }

  /**
   * Save the UUID mapping back to the JSON file.
   */
  save() {
    if (!this.filePath) return;
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify(this.uuids, null, 2), "utf-8");
  }
}
