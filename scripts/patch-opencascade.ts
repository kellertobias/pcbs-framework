const fs = require("fs");
const path = require("path");

try {
    const pkgPath = require.resolve("opencascade.js/package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

    if (pkg.type !== "module") {
        pkg.type = "module";
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
        console.log("✅ Patched opencascade.js package.json with type: module");
    } else {
        console.log("ℹ️ opencascade.js already has type: module");
    }
} catch (e) {
    console.error("❌ Failed to patch opencascade.js:", e);
    process.exit(1);
}
